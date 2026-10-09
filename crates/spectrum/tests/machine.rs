//! The machine's own tests: what each part does, built up from small programs put straight into memory, with
//! the ROMs alone (no fixture). Time is T-states and frames counted: nothing here reads the clock.

use spectrum::{Joystick, Machine, Model, Options, Stop, joy, keys};

/// A machine of `model` switched on and booted (its ROM's system variables and stack set up), sound off.
fn booted(model: Model) -> Machine {
    static CACHE: std::sync::Mutex<Vec<(Model, Machine)>> = std::sync::Mutex::new(Vec::new());
    let mut cache = CACHE.lock().unwrap();
    if let Some((_, m)) = cache.iter().find(|(m, _)| *m == model) {
        return m.clone();
    }
    let mut zx = Machine::with_options(
        model,
        Options {
            sound: false,
            ..Options::default()
        },
    );
    for _ in 0..300 {
        zx.run_frame();
    }
    cache.push((model, zx.clone()));
    zx
}

/// A machine with `code` at `at`, the CPU about to run it at T-state `t`, interrupts off.
fn at_tstate(model: Model, at: u16, code: &[u8], t: u32) -> Machine {
    let mut zx = booted(model);
    for (i, &b) in code.iter().enumerate() {
        zx.poke(at.wrapping_add(i as u16), b);
    }
    let r = zx.cpu_mut();
    r.pc = at;
    r.iff1 = false;
    r.iff2 = false;
    r.halted = false;
    r.prefix = 0;
    zx.set_tstate(t);
    zx
}

/// T-states one step (an instruction) takes from T-state `t` there.
fn step_time(model: Model, at: u16, code: &[u8], t: u32, setup: impl Fn(&mut Machine)) -> u32 {
    let mut zx = at_tstate(model, at, code, t);
    setup(&mut zx);
    zx.run(1);
    zx.tstate() - t
}

#[test]
fn every_model_boots_to_its_rom() {
    for (model, frames, want) in [
        (Model::Spectrum16, 150, "© 1982 Sinclair Research Ltd"),
        (Model::Spectrum48, 150, "© 1982 Sinclair Research Ltd"),
        (Model::Spectrum128, 300, "Tape Loader"),
        (Model::Plus2, 300, "©1986, ©1982 Amstrad Consumer"),
        (Model::Plus2A, 300, "128 +2A"),
        (Model::Plus3, 300, "128 +3"),
        (Model::Pentagon, 300, "Tape Tester"),
    ] {
        let mut zx = Machine::with_options(
            model,
            Options {
                sound: false,
                ..Options::default()
            },
        );
        for _ in 0..frames {
            assert_eq!(zx.run_frame(), Stop::FrameEnd);
        }
        let text = zx.screen_text();
        assert!(text.contains(want), "{model:?}:\n{}", text.text());
    }
}

#[test]
fn frames_are_the_models_length_and_the_sound_follows_the_clock() {
    for (model, len, samples) in [
        (Model::Spectrum48, 69_888u32, 958.5f64),
        (Model::Spectrum128, 70_908, 959.6),
        (Model::Pentagon, 71_680, 983.0),
    ] {
        let mut zx = Machine::new(model);
        let mut total = 0;
        for _ in 0..100 {
            zx.run_frame();
            total += zx.audio().len() / 2;
        }
        assert_eq!(model.frame_tstates(), len);
        let expected = 100.0 * len as f64 * 48_000.0 / model.clock_hz() as f64;
        assert!(
            (total as f64 - expected).abs() <= 1.0,
            "{model:?}: {total} samples for {expected}"
        );
        let _ = samples;
    }
}

#[test]
fn contended_memory_is_the_ulas_pattern_on_the_48k() {
    // A NOP in contended memory (6000h) from each T-state of the first 8 of a line: 6,5,4,3,2,1,0,0 more.
    let delays: Vec<u32> = (14335..14343)
        .map(|t| step_time(Model::Spectrum48, 0x6000, &[0x00], t, |_| {}) - 4)
        .collect();
    assert_eq!(delays, [6, 5, 4, 3, 2, 1, 0, 0]);
    assert_eq!(
        step_time(Model::Spectrum48, 0x6000, &[0x00], 14334, |_| {}),
        4
    );
    assert_eq!(
        step_time(Model::Spectrum48, 0x6000, &[0x00], 14335 + 128, |_| {}),
        4,
        "the right border"
    );
    assert_eq!(
        step_time(Model::Spectrum48, 0x6000, &[0x00], 14335 + 224, |_| {}),
        10,
        "the next line"
    );
    // Uncontended memory never is.
    assert_eq!(
        step_time(Model::Spectrum48, 0x8000, &[0x00], 14335, |_| {}),
        4
    );
    // Late timings: a T-state later.
    let mut zx = at_tstate(Model::Spectrum48, 0x6000, &[0x00], 14336);
    zx.set_options(Options {
        late_timings: true,
        ..zx.options()
    });
    zx.run(1);
    assert_eq!(zx.tstate() - 14336, 10);
}

#[test]
fn the_128ks_banks_and_the_plus3s_pattern() {
    // 128K: bank 1 at C000h is contended, bank 0 is not; the pattern from 14361. The bank is paged by a little
    // program (LD BC,7FFDh; LD A,bank; OUT (C),A), as the CPU pages it.
    let nop_in_bank = |model: Model, bank: u8, t: u32| {
        let mut zx = at_tstate(
            model,
            0x8000,
            &[0x01, 0xFD, 0x7F, 0x3E, bank, 0xED, 0x79, 0x00],
            1000,
        );
        // LD BC,7FFDh; LD A,bank; OUT (C),A
        zx.run(3);
        zx.poke(0xC000, 0x00);
        zx.cpu_mut().pc = 0xC000;
        zx.set_tstate(t);
        zx.run(1);
        zx.tstate() - t
    };
    assert_eq!(nop_in_bank(Model::Spectrum128, 1, 14361), 10);
    assert_eq!(nop_in_bank(Model::Spectrum128, 0, 14361), 4);
    assert_eq!(nop_in_bank(Model::Spectrum128, 7, 14362), 9);
    // +3: banks 4-7 contended, the pattern 1,0,7,6,5,4,3,2 from 14361, 129 T-states a line.
    let plus3: Vec<u32> = (14361..14369)
        .map(|t| nop_in_bank(Model::Plus3, 4, t) - 4)
        .collect();
    assert_eq!(plus3, [1, 0, 7, 6, 5, 4, 3, 2]);
    assert_eq!(nop_in_bank(Model::Plus3, 3, 14363), 4);
    assert_eq!(nop_in_bank(Model::Plus3, 4, 14361 + 128), 5);
    assert_eq!(nop_in_bank(Model::Plus3, 4, 14361 + 129), 4);
    // The Pentagon contends nothing.
    assert_eq!(nop_in_bank(Model::Pentagon, 5, 17000), 4);
}

#[test]
fn internal_t_states_are_contended_by_address_on_the_ula_not_the_gate_array() {
    // INC HL (6 T: 4 + 2 internal at IR) with I pointing at contended memory (IR contention).
    let with_i =
        |model: Model, i: u8, t: u32| step_time(model, 0x8000, &[0x23], t, |zx| zx.cpu_mut().i = i);
    // The M1 at 14333 runs 14333-14336; the two internal T-states at 14337 (4 more) and 14342 (0).
    assert_eq!(with_i(Model::Spectrum48, 0x40, 14333), 6 + 4);
    assert_eq!(with_i(Model::Spectrum48, 0x3F, 14333), 6);
    let mut zx = at_tstate(Model::Plus3, 0x8000, &[0x23], 14361);
    zx.cpu_mut().i = 0x40;
    zx.run(1);
    assert_eq!(
        zx.tstate() - 14361,
        6,
        "the gate array contends MREQ cycles only"
    );
}

#[test]
fn io_contention_follows_the_ports_address() {
    // IN A,(n) with A the port's high byte: the I/O cycle starts at T-state t + 7 (M1 4, the operand 3).
    let in_time = |a: u8, n: u8, t: u32| {
        step_time(Model::Spectrum48, 0x8000, &[0xDB, n], t, |zx| {
            zx.cpu_mut().a = a
        })
    };
    // Uncontended high byte, odd port: N:4 (11 T in all, whenever).
    assert_eq!(in_time(0x00, 0xFF, 14335 - 7), 11);
    // ULA port, uncontended high byte: N:1, C:3. The cycle at 14334: its contended T-state at 14335 (6).
    assert_eq!(in_time(0x00, 0xFE, 14334 - 7), 11 + 6);
    // ULA port, contended high byte: C:1, C:3. At 14335: 6, then at 14342: 0.
    assert_eq!(in_time(0x40, 0xFE, 14335 - 7), 11 + 6);
    // Odd port, contended high byte: C:1 x 4. At 14335: 6, 14342: 0, 14343: 6, 14350: 0.
    assert_eq!(in_time(0x40, 0xFF, 14335 - 7), 11 + 12);
    // The +3 contends no I/O.
    let mut zx = at_tstate(Model::Plus3, 0x8000, &[0xDB, 0xFE], 14361 - 7);
    zx.cpu_mut().a = 0x40;
    zx.run(1);
    assert_eq!(zx.tstate() - (14361 - 7), 11);
}

#[test]
fn the_floating_bus_is_the_byte_the_ula_fetches() {
    // IN A,(FFh) sampled 3 T-states into its I/O cycle: the cycle from t + 7.
    let read_at = |model: Model, sample: u32| {
        let mut zx = at_tstate(model, 0x8000, &[0xDB, 0xFF], sample - 10);
        zx.cpu_mut().a = 0x00;
        // A screen of known bytes: bitmap of line 0 columns 0 and 1 = 11h, 22h; attributes 33h, 44h.
        zx.poke(0x4000, 0x11);
        zx.poke(0x4001, 0x22);
        zx.poke(0x5800, 0x33);
        zx.poke(0x5801, 0x44);
        zx.run(1);
        zx.cpu().a
    };
    let got: Vec<u8> = (14337..14347)
        .map(|t| read_at(Model::Spectrum48, t))
        .collect();
    assert_eq!(
        got,
        [
            0xFF,
            0x11,
            0x33,
            0x22,
            0x44,
            0xFF,
            0xFF,
            0xFF,
            0xFF,
            read_at(Model::Spectrum48, 14346)
        ]
    );
    assert_eq!(read_at(Model::Spectrum48, 1000), 0xFF, "the top border");
    assert_eq!(read_at(Model::Spectrum128, 14364), 0x11);
    assert_eq!(read_at(Model::Pentagon, 17990), 0xFF, "no floating bus");
    // The +2A/+3 on 0FFDh-style ports: the last byte over the bus, bit 0 set.
    let mut zx = at_tstate(
        Model::Plus3,
        0x8000,
        &[0x01, 0xFD, 0x0F, 0xED, 0x78],
        30_000,
    );
    zx.poke(0x4000, 0x10);
    zx.run(2);
    assert_eq!(zx.cpu().a & 1, 1);
}

#[test]
fn the_border_lands_on_its_group_of_8_pixels() {
    // OUT (FEh),A whose write lands at T-state w: the 48K shows it from the group drawn from g when w <= g + 3.
    let row0 = |model: Model, t: u32| {
        let mut zx = at_tstate(model, 0x8000, &[0xD3, 0xFE, 0x76], t);
        zx.cpu_mut().a = 2;
        zx.set_border_now(1);
        zx.run(1);
        while zx.run_frame() != Stop::FrameEnd {}
        zx.frame()[..352].to_vec()
    };
    // The write is the I/O cycle's second T-state: the OUT from t writes at t + 8. Pixel (48, 0) is drawn at
    // 14336 - 48 * 224 = 3584 on the 48K.
    let first_red = |model: Model, t: u32| row0(model, t).iter().position(|&c| c == 2);
    assert_eq!(first_red(Model::Spectrum48, 3587 - 8), Some(48));
    assert_eq!(first_red(Model::Spectrum48, 3588 - 8), Some(56));
    // The 128K a T-state earlier against its own picture (pixel (48, 0) at 14362 - 48 * 228 = 3418).
    assert_eq!(first_red(Model::Spectrum128, 3420 - 8), Some(48));
    assert_eq!(first_red(Model::Spectrum128, 3421 - 8), Some(56));
    // The Pentagon at every T-state: two pixels.
    // (A write at w shows from the 2-pixel unit drawn at w - 3, as on the others.)
    let p = 17988 - 48 * 224;
    assert_eq!(first_red(Model::Pentagon, p - 8), Some(42));
    assert_eq!(first_red(Model::Pentagon, p + 1 - 8), Some(44));
    assert_eq!(first_red(Model::Pentagon, p + 2 - 8), Some(46));
}

#[test]
fn port_fe_reads_keys_and_the_ear_bit_by_issue() {
    let read = |issue2: bool, out: u8, key: Option<u8>| {
        let mut zx = at_tstate(
            Model::Spectrum48,
            0x8000,
            &[0xD3, 0xFE, 0x3E, 0x00, 0xDB, 0xFE],
            1000,
        );
        zx.set_options(Options {
            issue2,
            ..zx.options()
        });
        if let Some(k) = key {
            zx.key(k, true);
        }
        zx.cpu_mut().a = out;
        zx.run(3);
        zx.cpu().a
    };
    assert_eq!(read(false, 0x00, None), 0xBF);
    assert_eq!(read(false, 0x10, None), 0xFF);
    assert_eq!(
        read(false, 0x08, None),
        0xBF,
        "Issue 3: MIC alone leaves bit 6 low"
    );
    assert_eq!(read(true, 0x08, None), 0xFF, "Issue 2: MIC alone sets it");
    assert_eq!(read(false, 0x00, Some(keys::A)), 0xBE);
    assert_eq!(read(false, 0x00, Some(keys::SPACE)), 0xBE);
    // The Kempston interface on port 1Fh.
    let mut zx = at_tstate(Model::Spectrum48, 0x8000, &[0xDB, 0x1F], 1000);
    zx.joystick(Joystick::Kempston, joy::FIRE | joy::LEFT);
    zx.run(1);
    assert_eq!(zx.cpu().a, 0x12);
    // A Sinclair joystick is keys.
    let mut zx = Machine::new(Model::Spectrum48);
    zx.joystick(Joystick::Sinclair1, joy::FIRE);
    assert!(!zx.key_down(keys::K0), "joystick keys are not the person's");
}

#[test]
fn the_128ks_paging_lock_and_the_shadow_screen() {
    let mut zx = at_tstate(
        Model::Spectrum128,
        0x8000,
        &[
            0x01, 0xFD, 0x7F, 0x3E, 0x3F, 0xED, 0x79, 0x3E, 0x10, 0xED, 0x79,
        ],
        1000,
    );
    zx.run(3); // bank 7, shadow screen, ROM 1, locked
    assert_eq!(zx.paging(), (0x3F, 0, true));
    assert_eq!(zx.screen_text().rows.len(), 24);
    zx.run(2); // ignored
    assert_eq!(zx.paging(), (0x3F, 0, true));
    zx.reset();
    assert_eq!(zx.paging(), (0, 0, false));
}

#[test]
fn instant_loading_and_loading_from_the_edges_load_the_same() {
    // LD-BYTES called as LOAD does: A = flag, IX = where, DE = how many, carry set; return to a HALT.
    let data: Vec<u8> = (0..300u32).map(|i| (i * 7 + 3) as u8).collect();
    let tap = tape::tap::write(&[tape::tap::block(0xFF, &data)]);
    let load = |instant: bool| {
        let mut zx = at_tstate(
            Model::Spectrum48,
            0x8000,
            &[
                0x37, 0x3E, 0xFF, 0xDD, 0x21, 0x00, 0xA0, 0x11, 0x2C, 0x01, 0xCD, 0x56, 0x05, 0x76,
            ],
            0,
        );
        zx.set_options(Options {
            instant_load: instant,
            ..zx.options()
        });
        zx.load(&tap, "x.tap").unwrap();
        let start = zx.frames();
        while zx.cpu().pc != 0x800E && zx.frames() - start < 1000 {
            zx.run(1);
        }
        let frames = zx.frames() - start;
        let loaded: Vec<u8> = (0..300).map(|i| zx.peek(0xA000 + i)).collect();
        (loaded, zx.cpu().f & 1, frames)
    };
    let (edges, carry_e, frames_e) = load(false);
    let (trap, carry_t, frames_t) = load(true);
    assert_eq!(edges, data);
    assert_eq!(trap, data);
    assert_eq!((carry_e, carry_t), (1, 1));
    assert!(
        frames_e > 100 && frames_t < 2,
        "{frames_e} frames from the edges, {frames_t} trapped"
    );
}

#[test]
fn save_is_recorded_as_a_tap() {
    // SA-BYTES: A = flag, IX = from, DE = how many; the MIC line recorded.
    let mut zx = at_tstate(
        Model::Spectrum48,
        0x8000,
        &[
            0x3E, 0xFF, 0xDD, 0x21, 0x00, 0xA0, 0x11, 0x40, 0x00, 0xCD, 0xC2, 0x04, 0x76,
        ],
        0,
    );
    let data: Vec<u8> = (0..64u8).map(|i| i ^ 0x5A).collect();
    for (i, &b) in data.iter().enumerate() {
        zx.poke(0xA000 + i as u16, b);
    }
    for _ in 0..300 {
        zx.run_frame();
    }
    assert_eq!(
        zx.saved_tap(),
        tape::tap::write(&[tape::tap::block(0xFF, &data)])
    );
}

#[test]
fn typing_reaches_the_rom() {
    let mut zx = Machine::with_options(
        Model::Spectrum48,
        Options {
            sound: false,
            ..Options::default()
        },
    );
    for _ in 0..150 {
        zx.run_frame();
    }
    zx.type_chords(&[
        vec![keys::J],
        vec![keys::SYMBOL_SHIFT, keys::P],
        vec![keys::SYMBOL_SHIFT, keys::P],
    ]);
    zx.type_text("10");
    for _ in 0..60 {
        zx.run_frame();
    }
    assert!(
        zx.screen_text().rows[23].starts_with("LOAD \"\"10"),
        "{:?}",
        zx.screen_text().rows[23]
    );
}

#[test]
fn the_state_goes_on_bit_for_bit() {
    let mut zx = Machine::new(Model::Spectrum128);
    for _ in 0..200 {
        zx.run_frame();
    }
    // Some sound: the 128's menu beeps on a key.
    zx.press(&[keys::ENTER], 3);
    for _ in 0..3 {
        zx.run_frame();
    }
    let state = zx.save_state();
    let run = |zx: &mut Machine| {
        let mut out = Vec::new();
        for _ in 0..60 {
            zx.run_frame();
            out.extend_from_slice(zx.frame());
            out.extend(zx.audio().iter().flat_map(|s| s.to_le_bytes()));
        }
        (out, zx.save_state())
    };
    let a = run(&mut zx);
    zx.load_state(&state).unwrap();
    let b = run(&mut zx);
    let mut fresh = Machine::new(Model::Spectrum48);
    fresh.load_state(&state).unwrap();
    let c = run(&mut fresh);
    assert!(a == b, "the same machine");
    assert!(a == c, "a fresh machine");
    assert_eq!(fresh.model(), Model::Spectrum128);
    assert!(zx.load_state(b"nope").is_err());
}

#[test]
fn a_snapshot_round_trip_goes_on_the_same() {
    for model in [
        Model::Spectrum48,
        Model::Spectrum128,
        Model::Plus3,
        Model::Pentagon,
    ] {
        let mut zx = Machine::new(model);
        for _ in 0..120 {
            zx.run_frame();
        }
        while zx.cpu().halted || zx.cpu().prefix != 0 {
            zx.run(1);
        }
        let szx = snapshot::save_szx(&zx.snapshot());
        let mut other = Machine::new(Model::Spectrum48);
        other.load(&szx, "x.szx").unwrap();
        assert_eq!(other.model(), model);
        assert_eq!(other.cpu(), zx.cpu(), "{model:?}");
        for _ in 0..30 {
            zx.run_frame();
            other.run_frame();
        }
        assert_eq!(other.cpu(), zx.cpu(), "{model:?}");
        // (Not the picture: FLASH's phase counts frames since power-on, which no format keeps.)
        for &b in model.banks() {
            assert!(other.ram_bank(b) == zx.ram_bank(b), "{model:?} bank {b}");
        }
    }
}

#[test]
fn breakpoints_nmi_and_the_debugger() {
    let mut zx = Machine::new(Model::Spectrum48);
    for _ in 0..100 {
        zx.run_frame();
    }
    zx.add_breakpoint(0x0038);
    assert_eq!(zx.run_frame(), Stop::Breakpoint(0x0038));
    assert_eq!(zx.registers().pc, 0x0038);
    assert!(
        zx.registers().t < 32 + 13,
        "the interrupt taken at the frame's start"
    );
    // Running on passes the breakpoint it stands at.
    assert_eq!(zx.run_frame(), Stop::FrameEnd);
    zx.clear_breakpoints();
    zx.nmi();
    zx.add_breakpoint(0x0066);
    assert_eq!(zx.run_frame(), Stop::Breakpoint(0x0066));
    let (text, len) = zx.disassemble(0x0066);
    assert_eq!((text.as_str(), len), ("PUSH AF", 1));
    assert_eq!(zx.step_instruction(), Stop::Steps);
    assert_eq!(zx.registers().pc, 0x0067);
}

#[test]
fn the_ay_is_heard_and_read_back() {
    // R0 = 123, R8 = 15 (volume), mixer tone A on: written and read through the ports, and heard.
    let code = [
        0x01, 0xFD, 0xFF, 0x3E, 0x00, 0xED, 0x79, // select R0
        0x01, 0xFD, 0xBF, 0x3E, 0x7B, 0xED, 0x79, // R0 = 123
        0x01, 0xFD, 0xFF, 0x3E, 0x07, 0xED, 0x79, 0x01, 0xFD, 0xBF, 0x3E, 0x3E, 0xED,
        0x79, // R7: tone A
        0x01, 0xFD, 0xFF, 0x3E, 0x08, 0xED, 0x79, 0x01, 0xFD, 0xBF, 0x3E, 0x0F, 0xED,
        0x79, // R8 = 15
        0x01, 0xFD, 0xFF, 0x3E, 0x00, 0xED, 0x79, 0xED, 0x78, // read R0 into A
        0x18, 0xFE,
    ];
    let mut zx = at_tstate(Model::Spectrum128, 0x8000, &code, 1000);
    zx.set_options(Options {
        sound: true,
        ..zx.options()
    });
    zx.run(22);
    assert_eq!(zx.cpu().a, 123);
    for _ in 0..10 {
        zx.run_frame();
    }
    let peak = zx.audio().iter().fold(0f32, |m, &s| m.max(s.abs()));
    assert!(peak > 0.05, "the tone is heard ({peak})");
    assert_eq!(zx.ay_registers().unwrap()[8], 15);
}

#[test]
fn snow_disturbs_the_picture_only_where_i_is_contended() {
    // NOPs in uncontended memory with I = 40h: the ULA's fetches are disturbed (16K/48K, 128K); not on the +3.
    let picture = |model: Model, snow: bool, i: u8| {
        // NOPs, an odd-length LD A,(nn) (13 T: so that the refresh falls at every phase), and a JP back.
        let mut code = vec![0x00; 100];
        code.extend_from_slice(&[0x3A, 0x00, 0x80, 0xC3, 0x00, 0x80]);
        let mut zx = at_tstate(model, 0x8000, &code, 0);
        zx.set_options(Options {
            snow,
            ..zx.options()
        });
        // A screen of stripes, so that a wrong fetch shows.
        for a in 0x4000..0x5800u16 {
            zx.poke(a, (a & 0xFF) as u8);
        }
        zx.cpu_mut().i = i;
        zx.run_frame();
        zx.run_frame();
        zx.frame().to_vec()
    };
    assert_ne!(
        picture(Model::Spectrum48, true, 0x40),
        picture(Model::Spectrum48, false, 0x40)
    );
    assert_eq!(
        picture(Model::Spectrum48, true, 0x3F),
        picture(Model::Spectrum48, false, 0x3F)
    );
    assert_eq!(
        picture(Model::Plus3, true, 0x40),
        picture(Model::Plus3, false, 0x40)
    );
}

#[test]
fn the_super_level_loaders_trap_loads_a_level() {
    // LD A,2; LD HL,9000h; ED FB (the trap: level A to HL); HALT, from a snapshot that carries the levels.
    let mut snap = snapshot::Snapshot::new(snapshot::Model::Spectrum48);
    let code = [0x3E, 0x02, 0x21, 0x00, 0x90, 0xED, 0xFB, 0x76];
    for (i, &b) in code.iter().enumerate() {
        snap.poke(0x8000 + i as u16, b);
    }
    snap.regs.pc = 0x8000;
    snap.regs.sp = 0xFF00;
    let mut levels = std::collections::BTreeMap::new();
    levels.insert(1u8, vec![9, 9]);
    levels.insert(2u8, vec![1, 2, 3, 4, 5]);
    snap.slt = Some(snapshot::Slt {
        levels,
        screen: None,
    });
    let mut zx = Machine::new(Model::Spectrum48);
    zx.restore(&snap);
    zx.run(4);
    assert_eq!(
        (0..6).map(|i| zx.peek(0x9000 + i)).collect::<Vec<_>>(),
        [1, 2, 3, 4, 5, 0]
    );
    assert_eq!(zx.cpu().pc, 0x8008, "past the HALT");
}

#[test]
fn a_damaged_state_is_refused_not_a_panic() {
    let mut zx = Machine::new(Model::Plus3);
    for _ in 0..50 {
        zx.run_frame();
    }
    let good = zx.save_state();
    let mut x: u32 = 0x1234_5678;
    let mut next = || {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        x
    };
    for i in 0..600 {
        let mut bad = good.clone();
        if i % 2 == 0 {
            bad.truncate(next() as usize % good.len());
        } else {
            let at = 6 + next() as usize % (good.len() - 6);
            bad[at] ^= 1 << (next() % 8);
        }
        let mut m = zx.clone();
        let _ = m.load_state(&bad);
        // Whatever it took, it runs.
        m.run_frame();
    }
    // And the good state still loads.
    zx.load_state(&good).unwrap();
}
