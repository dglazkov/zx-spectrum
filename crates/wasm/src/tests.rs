//! The interface run natively: every call through its C signature, as the page makes them.

use super::*;

fn out(h: *mut Zx) -> Vec<u8> {
    unsafe { bytes(zx_out_ptr(h), zx_out_len(h)) }.to_vec()
}

fn out_text(h: *mut Zx) -> String {
    String::from_utf8(out(h)).unwrap()
}

fn load(h: *mut Zx, data: &[u8], name: &str) -> (i32, String) {
    let code = unsafe {
        zx_load(
            h,
            data.as_ptr(),
            data.len() as u32,
            name.as_ptr(),
            name.len() as u32,
        )
    };
    (code, out_text(h))
}

fn frames(h: *mut Zx, n: u32) {
    assert_eq!(unsafe { zx_run_frames(h, n) }, n);
}

fn screen(h: *mut Zx) -> String {
    let n = unsafe { zx_screen_text(h) };
    assert!(n > 0);
    out_text(h)
}

fn tap_block(flag: u8, data: &[u8]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(&((data.len() + 2) as u16).to_le_bytes());
    v.push(flag);
    v.extend_from_slice(data);
    v.push(data.iter().fold(flag, |x, b| x ^ b));
    v
}

/// A Bytes header and a SCREEN$ of 10101010 on white ink and bright blue paper.
fn screen_tape() -> Vec<u8> {
    let mut header = vec![3u8];
    header.extend_from_slice(b"PICTURE   ");
    header.extend_from_slice(&6912u16.to_le_bytes());
    header.extend_from_slice(&16384u16.to_le_bytes());
    header.extend_from_slice(&32768u16.to_le_bytes());
    let mut scr = vec![0xAAu8; 6144];
    scr.extend(std::iter::repeat_n(0x4F, 768));
    let mut tap = tap_block(0, &header);
    tap.extend(tap_block(0xFF, &scr));
    tap
}

#[test]
fn a_model_out_of_range_is_a_null_handle_and_a_null_handle_is_harmless() {
    assert!(zx_new(7).is_null());
    let h: *mut Zx = std::ptr::null_mut();
    unsafe {
        assert_eq!(zx_run_frame(h), ZX_E_ARGUMENT);
        assert_eq!(
            zx_load(h, std::ptr::null(), 0, std::ptr::null(), 0),
            ZX_E_ARGUMENT
        );
        assert_eq!(zx_save_state(h), ZX_E_ARGUMENT);
        assert!(zx_frame_ptr(h).is_null());
        assert_eq!(zx_out_len(h), 0);
        zx_key(h, 3, 1);
        zx_free(h);
    }
    let h = zx_new(1);
    assert_eq!(unsafe { zx_power_on(h, 9) }, ZX_E_ARGUMENT);
    unsafe { zx_free(h) };
}

#[test]
fn every_model_boots_to_its_rom() {
    for (i, want) in [
        "Sinclair Research",
        "Sinclair Research",
        "Tape Loader",
        "Tape Loader",
        "Loader",
        "Loader",
        "Tape Loader",
    ]
    .iter()
    .enumerate()
    {
        let h = zx_new(i as u32);
        assert_eq!(unsafe { zx_model(h) }, i as u32);
        frames(h, 160);
        let text = screen(h);
        assert!(text.contains(want), "model {i}: {text}");
        assert_eq!(text.lines().count(), 24);
        assert_eq!(unsafe { zx_frame_count(h) }, 160.0);
        let rate = 48_000.0 / Model::ALL[i].frame_rate();
        let samples = unsafe { zx_audio_len(h) } as f64 / 2.0;
        assert!(
            (samples - rate).abs() < 1.5,
            "model {i}: {samples} samples a frame"
        );
        unsafe { zx_free(h) };
    }
}

#[test]
fn a_tape_goes_in_lists_its_blocks_and_loads_at_once_with_the_trap() {
    let h = zx_new(1);
    frames(h, 100);
    let (code, json) = load(h, &screen_tape(), "picture.tap");
    assert_eq!(code, ZX_OK, "{json}");
    assert_eq!(
        json,
        r#"{"kind":"tape","name":"picture.tap","model":null,"others":[]}"#
    );
    let n = unsafe { zx_tape_blocks(h) };
    let blocks = out_text(h);
    assert_eq!(n as usize, blocks.len());
    assert!(blocks.starts_with(r#"[{"kind":"header","label":"Bytes: PICTURE CODE 16384,6912","bytes":19,"seconds":6.087}"#), "{blocks}");
    assert!(blocks.contains(r#"{"kind":"data","label":"#), "{blocks}");
    let state = unsafe { std::slice::from_raw_parts(zx_tape_state(h), 5) };
    assert_eq!(&state[..3], &[1.0, 0.0, 0.0]);
    assert!(state[4] > 10.0, "{state:?}");
    unsafe { zx_set_options(h, zx_options(h) | OPT_INSTANT_LOAD) };
    // LOAD ""CODE: J (LOAD in K mode), the quotes, extended mode (both shifts) and I (CODE), ENTER.
    let typed = "j\"\"";
    unsafe { zx_type_text(h, typed.as_ptr(), typed.len() as u32) };
    frames(h, 40);
    for chord in [&[0u32, 36][..], &[27], &[30]] {
        chord.iter().for_each(|&k| unsafe { zx_key(h, k, 1) });
        frames(h, 3);
        chord.iter().for_each(|&k| unsafe { zx_key(h, k, 0) });
        frames(h, 6);
    }
    frames(h, 150);
    assert_eq!(unsafe { zx_peek(h, 0x4000) }, 0xAA, "{}", screen(h));
    assert_eq!(unsafe { zx_peek(h, 0x5800) }, 0x4F);
    let state = unsafe { std::slice::from_raw_parts(zx_tape_state(h), 5) };
    // Both blocks taken: the head in the data block's trailing pause.
    assert!(state[2] == 1.0 && state[3] > 48.0, "{state:?}");
    unsafe { zx_tape_rewind(h) };
    let state = unsafe { std::slice::from_raw_parts(zx_tape_state(h), 5) };
    assert_eq!(state[2], 0.0);
    unsafe { zx_tape_eject(h) };
    let state = unsafe { std::slice::from_raw_parts(zx_tape_state(h), 5) };
    assert_eq!(state[0], 0.0);
    assert_eq!(unsafe { zx_tape_blocks(h) }, 2, "[]");
    unsafe { zx_free(h) };
}

#[test]
fn files_it_cannot_load_say_why() {
    let h = zx_new(1);
    let (code, why) = load(h, b"hello, world", "notes.txt");
    assert_eq!(code, ZX_E_UNRECOGNISED);
    assert!(why.contains("notes.txt"), "{why}");
    let (code, why) = load(h, b"MV - CPCEMU Disk-File\r\nDisk-Info\r\n", "game.dsk");
    assert_eq!(code, ZX_E_UNSUPPORTED, "{why}");
    // A tape with nothing on it to play (its one block cut short): refused, and the deck left empty.
    let (code, why) = load(h, b"ZXTape!\x1a\x01\x14\x10\x00\x00\xff\xff", "cut.tzx");
    assert_eq!(code, ZX_E_DAMAGED, "{why}");
    assert!(why.contains("no block that plays"), "{why}");
    let mut text_only = b"ZXTape!\x1a\x01\x14\x30\x05hello".to_vec();
    text_only.extend_from_slice(b"\x20\x10\x00");
    let (code, why) = load(h, &text_only, "words.tzx");
    assert_eq!(code, ZX_E_DAMAGED, "{why}");
    assert_eq!(unsafe { zx_tape_blocks(h) }, 2, "{}", out_text(h));
    // A file of zeros is no TAP, however well its lengths add up; one larger than any Spectrum file is not read.
    let (code, why) = load(h, &vec![0u8; 1 << 20], "zeros.tap");
    assert_eq!(code, ZX_E_DAMAGED, "{why}");
    let (code, why) = load(h, &vec![0u8; (MAX_FILE + 1) as usize], "huge.tap");
    assert_eq!(code, ZX_E_UNSUPPORTED, "{why}");
    assert!(why.contains("16 MB"), "{why}");
    // The machine runs on as it was.
    frames(h, 100);
    assert!(screen(h).contains("Sinclair Research"));
    unsafe { zx_free(h) };
}

#[test]
fn a_state_puts_the_machine_back_to_the_bit_and_a_damaged_one_is_refused() {
    let h = zx_new(2);
    frames(h, 120);
    let n = unsafe { zx_save_state(h) };
    let state = out(h);
    assert_eq!(n as usize, state.len());
    frames(h, 50);
    let later =
        unsafe { std::slice::from_raw_parts(zx_frame_ptr(h), zx_frame_len() as usize) }.to_vec();
    assert_eq!(
        unsafe { zx_load_state(h, state.as_ptr(), state.len() as u32) },
        ZX_OK
    );
    frames(h, 50);
    let again =
        unsafe { std::slice::from_raw_parts(zx_frame_ptr(h), zx_frame_len() as usize) }.to_vec();
    assert_eq!(later, again);
    // The frame count goes on.
    assert_eq!(unsafe { zx_frame_count(h) }, 220.0);
    let mut bad = state.clone();
    bad.truncate(bad.len() / 2);
    assert_eq!(
        unsafe { zx_load_state(h, bad.as_ptr(), bad.len() as u32) },
        ZX_E_STATE
    );
    assert!(out_text(h).contains("state"), "{}", out_text(h));
    assert_eq!(unsafe { zx_load_state(h, b"nope".as_ptr(), 4) }, ZX_E_STATE);
    frames(h, 1);
    assert!(screen(h).contains("Tape Loader"));
    unsafe { zx_free(h) };
}

#[test]
fn a_state_carries_its_picture_to_a_machine_of_another_model() {
    let h = zx_new(1);
    frames(h, 100);
    unsafe { zx_save_state(h) };
    let state = out(h);
    let picture =
        unsafe { std::slice::from_raw_parts(zx_frame_ptr(h), zx_frame_len() as usize) }.to_vec();
    let scratch = zx_new(6);
    assert_eq!(
        unsafe { zx_load_state(scratch, state.as_ptr(), state.len() as u32) },
        ZX_OK
    );
    assert_eq!(unsafe { zx_model(scratch) }, 1);
    let shown =
        unsafe { std::slice::from_raw_parts(zx_frame_ptr(scratch), zx_frame_len() as usize) };
    assert_eq!(shown, &picture[..]);
    unsafe {
        zx_free(scratch);
        zx_free(h);
    }
}

#[test]
fn snapshots_in_each_format_come_back_as_the_machine() {
    // (A .sna of a +3 is written as a 128K's, which is all the format knows.)
    for model in [1u32, 2, 5] {
        let h = zx_new(model);
        frames(h, 160);
        unsafe { zx_poke(h, 0x8000, 0x5A) };
        for (format, name) in [(0u32, "a.z80"), (1, "a.szx"), (2, "a.sna")] {
            let n = unsafe { zx_save_snapshot(h, format) };
            if format == 2 && model == 5 {
                continue;
            }
            assert!(n > 0, "model {model} format {format}: {}", out_text(h));
            let file = out(h);
            let other = zx_new(0);
            let (code, json) = load(other, &file, name);
            assert_eq!(code, ZX_OK, "{json}");
            assert!(
                json.contains(&format!(
                    "\"model\":\"{}\"",
                    Model::ALL[model as usize].id()
                )),
                "{json}"
            );
            assert_eq!(unsafe { zx_peek(other, 0x8000) }, 0x5A);
            frames(other, 2);
            unsafe { zx_free(other) };
        }
        unsafe { zx_free(h) };
    }
    assert_eq!(unsafe { zx_save_snapshot(zx_new(1), 7) }, ZX_E_ARGUMENT);
}

#[test]
fn options_go_in_and_come_out_as_bits() {
    let h = zx_new(2);
    let bits = OPT_ISSUE2
        | OPT_INSTANT_LOAD
        | OPT_SNOW
        | OPT_GHOSTING
        | OPT_SOUND
        | (2 << OPT_STEREO_SHIFT);
    unsafe { zx_set_options(h, bits) };
    assert_eq!(unsafe { zx_options(h) }, bits);
    unsafe { zx_set_options(h, bits & !OPT_SOUND) };
    frames(h, 1);
    assert_eq!(
        unsafe { zx_audio_len(h) },
        0,
        "no sound made with sound off"
    );
    unsafe { zx_set_volume(h, f32::NAN) };
    unsafe { zx_free(h) };
}

#[test]
fn the_debugger_reads_and_sets_registers_steps_and_stops_at_breakpoints() {
    let h = zx_new(1);
    frames(h, 100);
    let regs = unsafe { std::slice::from_raw_parts(zx_registers(h), 20) };
    assert_eq!(regs[19], unsafe { zx_tstate(h) });
    // NOP, NOP, JR -4 at 8000h: the CPU goes round it.
    for (i, b) in [0x00u32, 0x00, 0x18, 0xFC].iter().enumerate() {
        unsafe { zx_poke(h, 0x8000 + i as u32, *b) };
    }
    assert_eq!(unsafe { zx_set_register(h, 11, 0x8000) }, ZX_OK);
    assert_eq!(unsafe { zx_set_register(h, 15, 0) }, ZX_OK);
    assert_eq!(unsafe { zx_set_register(h, 30, 0) }, ZX_E_ARGUMENT);
    assert_eq!(unsafe { zx_step(h) }, 0);
    assert_eq!(unsafe { *zx_registers(h).add(11) }, 0x8001);
    unsafe { zx_add_breakpoint(h, 0x8002) };
    assert_eq!(unsafe { zx_run_frame(h) }, 1);
    assert_eq!(unsafe { *zx_registers(h).add(11) }, 0x8002);
    unsafe { zx_clear_breakpoints(h) };
    assert_eq!(unsafe { zx_run_frame(h) }, 0);
    let n = unsafe { zx_disassemble(h, 0x8000, 3) };
    assert_eq!(n as usize, out(h).len());
    let text = out_text(h);
    assert!(text.starts_with(r#"[{"addr":32768,"len":1,"text":"NOP"},{"addr":32769,"len":1,"text":"NOP"},{"addr":32770,"len":2,"text":"JR "#), "{text}");
    unsafe { zx_free(h) };
}

#[test]
fn a_save_from_basic_comes_out_as_a_tap() {
    let h = zx_new(1);
    frames(h, 100);
    assert_eq!(unsafe { zx_saved_tap(h) }, 0);
    // Keys as they are pressed: in K mode E is REM and S is SAVE.
    let typed = "10 ehello\ns\"hello\"\n";
    unsafe { zx_type_text(h, typed.as_ptr(), typed.len() as u32) };
    frames(h, 300);
    // "Start tape, then press any key."
    unsafe { zx_key(h, 30, 1) };
    frames(h, 5);
    unsafe { zx_key(h, 30, 0) };
    frames(h, 600);
    let n = unsafe { zx_saved_tap(h) };
    let tap = out(h);
    assert_eq!(n as usize, tap.len());
    // A header (19 bytes: a program called "hello"), then the program's line.
    assert_eq!(
        &tap[..4],
        &[19, 0, 0x00, 0x00],
        "a header block, of a program: {tap:?}"
    );
    assert_eq!(&tap[4..14], b"hello     ");
    let data = &tap[21..];
    assert_eq!(
        data.len(),
        u16::from_le_bytes([data[0], data[1]]) as usize + 2,
        "{tap:?}"
    );
    assert_eq!(data[2], 0xFF);
    unsafe { zx_free(h) };
}

#[test]
fn json_strings_are_escaped() {
    let mut j = Json::new();
    j.str("a \"b\" \\ \n\u{1}©");
    assert_eq!(j.0, "\"a \\\"b\\\" \\\\ \\n\\u0001©\"");
    let mut n = Json::new();
    n.num(f64::NAN);
    n.raw(",");
    n.num(1.23456);
    assert_eq!(n.0, "0,1.235");
}

#[test]
fn memory_handed_out_comes_back() {
    let p = zx_alloc(1000);
    assert!(!p.is_null());
    unsafe {
        std::ptr::write_bytes(p, 7, 1000);
        zx_dealloc(p, 1000);
        zx_dealloc(zx_alloc(0), 0);
    }
}

#[test]
fn a_states_picture_is_read_without_loading_it() {
    let h = zx_new(1);
    frames(h, 100);
    let tape = screen_tape();
    assert_eq!(load(h, &tape, "screen.tap").0, ZX_OK);
    unsafe { zx_tape_play(h) };
    frames(h, 200);
    unsafe { zx_save_state(h) };
    let state = out(h);
    let picture =
        unsafe { std::slice::from_raw_parts(zx_frame_ptr(h), zx_frame_len() as usize) }.to_vec();
    let at = unsafe { zx_frame_count(h) };
    for model in [1u32, 2, 6] {
        let other = zx_new(model);
        let n = unsafe { zx_state_picture(other, state.as_ptr(), state.len() as u32) };
        assert_eq!(n as u32, zx_frame_len());
        assert_eq!(out(other), picture, "read by a {model}");
        unsafe { zx_free(other) };
    }
    // The machine asked is as it was.
    let n = unsafe { zx_state_picture(h, state.as_ptr(), state.len() as u32) };
    assert_eq!(n as u32, zx_frame_len());
    assert_eq!(unsafe { zx_frame_count(h) }, at);
    assert_eq!(unsafe { zx_tape_state(h).add(1).read() }, 1.0);
    // Of every model, the same picture as loading the state gives.
    for model in 0..7u32 {
        let m = zx_new(model);
        frames(m, 80);
        unsafe { zx_save_state(m) };
        let s = out(m);
        let scratch = zx_new(1);
        assert_eq!(
            unsafe { zx_state_picture(scratch, s.as_ptr(), s.len() as u32) } as u32,
            zx_frame_len()
        );
        let read = out(scratch);
        assert_eq!(
            unsafe { zx_load_state(scratch, s.as_ptr(), s.len() as u32) },
            ZX_OK
        );
        let loaded =
            unsafe { std::slice::from_raw_parts(zx_frame_ptr(scratch), zx_frame_len() as usize) };
        assert_eq!(read, loaded, "model {model}");
        unsafe {
            zx_free(scratch);
            zx_free(m);
        }
    }
    let mut cut = state.clone();
    cut.truncate(40);
    assert_eq!(
        unsafe { zx_state_picture(h, cut.as_ptr(), cut.len() as u32) },
        ZX_E_STATE
    );
    assert_eq!(
        unsafe { zx_state_picture(h, b"nope".as_ptr(), 4) },
        ZX_E_STATE
    );
    unsafe { zx_free(h) };
}
