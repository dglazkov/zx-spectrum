//! `zx.wasm`: the machine (`spectrum::Machine`) behind a C interface, for the page (web/src/emulator/wasm.ts).
//!
//! Numbers go in and out; anything larger goes through the module's memory. A machine is a handle (`zx_new`), and
//! every call takes it. Bytes are handed in through a buffer the page asks for (`zx_alloc`, filled, passed with its
//! length, `zx_dealloc` after); what a call hands back that is not a number (a file, a JSON answer, an error's
//! message) is left in the handle's out-buffer, `zx_out_ptr` / `zx_out_len`, valid until the next call that fills
//! it. The picture and the sound are read in place (`zx_frame_ptr`, `zx_audio_ptr`): views into the machine,
//! valid until the next call. Nothing panics across the boundary in practice: a bad handle, a model out of range,
//! a damaged file or state, all come back as negative return codes (`ZX_E_*`) with a message in the out-buffer.
//!
//! docs/web.md lists every export and what the page does with it; `examples/digest.rs` runs this same interface
//! natively, so that the wasm build can be held to the native one (web/tests/wasm.mjs).

use spectrum::{AyStereo, Joystick, LoadError, LoadedKind, Machine, Model, Options, Stop};

/// Done.
pub const ZX_OK: i32 = 0;
/// A null handle, a model or a format out of range.
pub const ZX_E_ARGUMENT: i32 = -1;
/// Not a file the Spectrum knows.
pub const ZX_E_UNRECOGNISED: i32 = -2;
/// A kind of file it knows but cannot load (disk images).
pub const ZX_E_UNSUPPORTED: i32 = -3;
/// A file of a known kind, damaged.
pub const ZX_E_DAMAGED: i32 = -4;
/// A saved state that is not one, of another version, or damaged.
pub const ZX_E_STATE: i32 = -5;
/// A snapshot format that cannot hold this machine (.sna of a +2A, say).
pub const ZX_E_FORMAT: i32 = -6;

/// The option bits of `zx_options` / `zx_set_options`.
pub const OPT_ISSUE2: u32 = 1 << 0;
pub const OPT_LATE_TIMINGS: u32 = 1 << 1;
pub const OPT_INSTANT_LOAD: u32 = 1 << 2;
pub const OPT_AUTO_TAPE: u32 = 1 << 3;
pub const OPT_TAPE_SOUND: u32 = 1 << 4;
pub const OPT_SNOW: u32 = 1 << 5;
pub const OPT_AY_ON_48K: u32 = 1 << 6;
pub const OPT_GHOSTING: u32 = 1 << 7;
pub const OPT_SOUND: u32 = 1 << 8;
/// The AY's stereo in bits 12–13: 0 mono (the machine's own), 1 ABC, 2 ACB.
pub const OPT_STEREO_SHIFT: u32 = 12;

/// The largest file `zx_load` takes: 16 MB. The largest Spectrum files (a CSW of a whole side, a zip of a
/// compilation) are a few megabytes; past this a file is something else, and its parts would only fill the
/// module's memory, which never shrinks.
pub const MAX_FILE: u32 = 16 << 20;

/// A machine and what the interface keeps for it.
pub struct Zx {
    machine: Machine,
    out: Vec<u8>,
    tape: [f64; 5],
    regs: [u32; 20],
}

impl Zx {
    fn new(model: Model) -> Zx {
        Zx {
            machine: Machine::new(model),
            out: Vec::new(),
            tape: [0.0; 5],
            regs: [0; 20],
        }
    }

    fn put(&mut self, bytes: Vec<u8>) -> i32 {
        self.out = bytes;
        self.out.len() as i32
    }

    fn fail(&mut self, code: i32, message: String) -> i32 {
        self.out = message.into_bytes();
        code
    }
}

fn model_at(index: u32) -> Option<Model> {
    Model::ALL.get(index as usize).copied()
}

fn model_index(model: Model) -> u32 {
    Model::ALL.iter().position(|&m| m == model).unwrap_or(1) as u32
}

/// The handle, or None for a null one.
///
/// # Safety
/// `h` is null or a handle from `zx_new` not yet freed.
unsafe fn zx<'a>(h: *mut Zx) -> Option<&'a mut Zx> {
    unsafe { h.as_mut() }
}

/// # Safety
/// `ptr` is null with `len` 0, or points at `len` readable bytes.
unsafe fn bytes<'a>(ptr: *const u8, len: u32) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, len as usize) }
    }
}

// --- Memory ---------------------------------------------------------------------------------------------------------

/// `len` bytes for the page to fill (a file, a state, a name); give them back with `zx_dealloc`.
#[unsafe(no_mangle)]
pub extern "C" fn zx_alloc(len: u32) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1) as usize);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` and `len` are what `zx_alloc` gave and was asked for.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_dealloc(ptr: *mut u8, len: u32) {
    if !ptr.is_null() {
        drop(unsafe { Vec::from_raw_parts(ptr, 0, len.max(1) as usize) });
    }
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_out_ptr(h: *mut Zx) -> *const u8 {
    unsafe { zx(h) }.map_or(std::ptr::null(), |z| z.out.as_ptr())
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_out_len(h: *mut Zx) -> u32 {
    unsafe { zx(h) }.map_or(0, |z| z.out.len() as u32)
}

// --- The machine ----------------------------------------------------------------------------------------------------

/// A machine of model `model` (0 16K, 1 48K, 2 128K, 3 +2, 4 +2A, 5 +3, 6 Pentagon), switched on; null for a model
/// out of range.
#[unsafe(no_mangle)]
pub extern "C" fn zx_new(model: u32) -> *mut Zx {
    match model_at(model) {
        Some(m) => Box::into_raw(Box::new(Zx::new(m))),
        None => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` is null or a live handle, not used after.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_free(h: *mut Zx) {
    if !h.is_null() {
        drop(unsafe { Box::from_raw(h) });
    }
}

/// Off and on again as `model` (the tape stays in the deck).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_power_on(h: *mut Zx, model: u32) -> i32 {
    let (Some(z), Some(m)) = (unsafe { zx(h) }, model_at(model)) else {
        return ZX_E_ARGUMENT;
    };
    z.machine.power_on(m);
    ZX_OK
}

/// The RESET button.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_reset(h: *mut Zx) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.reset();
    }
}

/// An NMI, taken at the next instruction boundary.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_nmi(h: *mut Zx) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.nmi();
    }
}

/// The model, as `zx_new` numbers them.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_model(h: *mut Zx) -> u32 {
    unsafe { zx(h) }.map_or(1, |z| model_index(z.machine.model()))
}

/// Runs to the end of the frame: 0, or 1 when a breakpoint stopped it first (PC is at the breakpoint).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_run_frame(h: *mut Zx) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    match z.machine.run_frame() {
        Stop::Breakpoint(_) => 1,
        _ => 0,
    }
}

/// Runs `n` frames, stopping early at a breakpoint: the frames run (a breakpoint's partial frame not counted).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_run_frames(h: *mut Zx, n: u32) -> u32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return 0;
    };
    for i in 0..n {
        if let Stop::Breakpoint(_) = z.machine.run_frame() {
            return i;
        }
    }
    n
}

/// One instruction (with its prefixes): 0, or 1 at a breakpoint, 2 if it ended the frame.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_step(h: *mut Zx) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    match z.machine.step_instruction() {
        Stop::Breakpoint(_) => 1,
        Stop::FrameEnd => 2,
        Stop::Steps => 0,
    }
}

/// Frames run since the machine was made (not put back by `zx_load_state`).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_frame_count(h: *mut Zx) -> f64 {
    unsafe { zx(h) }.map_or(0.0, |z| z.machine.frame_count() as f64)
}

/// The T-state in the frame.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tstate(h: *mut Zx) -> u32 {
    unsafe { zx(h) }.map_or(0, |z| z.machine.tstate())
}

/// Puts the CPU at T-state `t` of the frame (the debugger, timing tests).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_set_tstate(h: *mut Zx, t: u32) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.set_tstate(t);
    }
}

/// The last frame's picture: 352 × 296 bytes, a colour 0–15 each (8–15 bright).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_frame_ptr(h: *mut Zx) -> *const u8 {
    unsafe { zx(h) }.map_or(std::ptr::null(), |z| z.machine.frame().as_ptr())
}

/// The picture's bytes: 104,192.
#[unsafe(no_mangle)]
pub extern "C" fn zx_frame_len() -> u32 {
    (spectrum::FRAME_WIDTH * spectrum::FRAME_HEIGHT) as u32
}

/// The last frame's sound: interleaved stereo f32 at the sample rate (`zx_audio_len` of them).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_audio_ptr(h: *mut Zx) -> *const f32 {
    unsafe { zx(h) }.map_or(std::ptr::null(), |z| z.machine.audio().as_ptr())
}

/// How many f32 the last frame's sound is (twice its sample frames).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_audio_len(h: *mut Zx) -> u32 {
    unsafe { zx(h) }.map_or(0, |z| z.machine.audio().len() as u32)
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_set_sample_rate(h: *mut Zx, hz: u32) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.set_sample_rate(hz);
    }
}

// --- Input ----------------------------------------------------------------------------------------------------------

/// A key down (1) or up (0): code = half-row × 5 + bit, 0–39.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_key(h: *mut Zx, code: u32, down: u32) {
    if let Some(z) = unsafe { zx(h) }
        && code < 40
    {
        z.machine.key(code as u8, down != 0);
    }
}

/// Whether key `code` is down.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_key_down(h: *mut Zx, code: u32) -> u32 {
    unsafe { zx(h) }.map_or(0, |z| (code < 40 && z.machine.key_down(code as u8)) as u32)
}

/// Every key up, and anything still to be typed dropped.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_release_keys(h: *mut Zx) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.release_keys();
    }
}

/// The joystick: kind 0 none, 1 Kempston, 2 Sinclair 1, 3 Sinclair 2, 4 cursor; bits right 1, left 2, down 4,
/// up 8, fire 16.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_joystick(h: *mut Zx, kind: u32, bits: u32) {
    if let Some(z) = unsafe { zx(h) } {
        let kind = match kind {
            1 => Joystick::Kempston,
            2 => Joystick::Sinclair1,
            3 => Joystick::Sinclair2,
            4 => Joystick::Cursor,
            _ => Joystick::None,
        };
        z.machine.joystick(kind, (bits & 0x1F) as u8);
    }
}

/// Text typed from the next frame at the ROM's pace (UTF-8; `\n` is ENTER): the frame it will have been typed by.
///
/// # Safety
/// `h` is null or a live handle; `ptr` points at `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_type_text(h: *mut Zx, ptr: *const u8, len: u32) -> f64 {
    let Some(z) = (unsafe { zx(h) }) else {
        return 0.0;
    };
    let text = String::from_utf8_lossy(unsafe { bytes(ptr, len) }).into_owned();
    z.machine.type_text(&text) as f64
}

// --- Files and the tape ---------------------------------------------------------------------------------------------

/// Loads a file (TAP TZX CSW PZX, Z80 SNA SZX SLT, SCR, or a .zip of one; `name` for its extension): 0, with
/// `{"kind":"tape"|"snapshot"|"screen","name":…,"model":"48k"|null,"others":[…]}` in the out-buffer; or
/// ZX_E_UNRECOGNISED, ZX_E_UNSUPPORTED (a disk image, a file over 16 MB) or ZX_E_DAMAGED (a tape with nothing
/// on it to play among them) with the reason there.
///
/// # Safety
/// `h` is null or a live handle; the pointers point at their lengths of bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_load(
    h: *mut Zx,
    ptr: *const u8,
    len: u32,
    name_ptr: *const u8,
    name_len: u32,
) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    if len > MAX_FILE {
        return z.fail(
            ZX_E_UNSUPPORTED,
            format!(
                "a file of {} MB, larger than any Spectrum file (16 MB at most)",
                len >> 20
            ),
        );
    }
    let data = unsafe { bytes(ptr, len) };
    let name = String::from_utf8_lossy(unsafe { bytes(name_ptr, name_len) }).into_owned();
    match z.machine.load(data, &name) {
        Ok(loaded) => {
            let mut j = Json::new();
            j.raw("{\"kind\":");
            j.str(match loaded.kind {
                LoadedKind::Tape => "tape",
                LoadedKind::Snapshot => "snapshot",
                LoadedKind::Screen => "screen",
            });
            j.raw(",\"name\":");
            j.str(&loaded.name);
            j.raw(",\"model\":");
            match loaded.model {
                Some(m) => j.str(m.id()),
                None => j.raw("null"),
            }
            j.raw(",\"others\":[");
            for (i, o) in loaded.others.iter().enumerate() {
                if i > 0 {
                    j.raw(",");
                }
                j.str(o);
            }
            j.raw("]}");
            z.put(j.0.into_bytes());
            ZX_OK
        }
        Err(e) => {
            let code = match e {
                LoadError::Unrecognised(_) => ZX_E_UNRECOGNISED,
                LoadError::Unsupported(_) => ZX_E_UNSUPPORTED,
                LoadError::Damaged(_) => ZX_E_DAMAGED,
            };
            z.fail(code, e.to_string())
        }
    }
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_play(h: *mut Zx) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.tape_play();
    }
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_stop(h: *mut Zx) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.tape_stop();
    }
}

/// Back to the start (the motor as it was).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_rewind(h: *mut Zx) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.tape_rewind();
    }
}

/// The head to the start of block `block`.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_seek(h: *mut Zx, block: u32) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.tape_seek(block as usize);
    }
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_eject(h: *mut Zx) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.eject_tape();
    }
}

/// Where the tape is, cheaply (read every frame): a pointer to five f64, loaded (0/1), playing (0/1), the block
/// under the head (the block count at the end), seconds of tape played, and seconds the tape lasts.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_state(h: *mut Zx) -> *const f64 {
    let Some(z) = (unsafe { zx(h) }) else {
        return std::ptr::null();
    };
    let s = z.machine.tape_state();
    z.tape[0] = s.loaded as u8 as f64;
    z.tape[1] = s.playing as u8 as f64;
    z.tape[2] = s.block as f64;
    z.tape[3] = s.position;
    z.tape[4] = s.length;
    z.tape.as_ptr()
}

/// Whether the tape is playing (the page runs flat out while it does, loading accelerated).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_active(h: *mut Zx) -> u32 {
    unsafe { zx(h) }.map_or(0, |z| z.machine.tape_active() as u32)
}

/// The tape's blocks as JSON, `[{"kind":"header","label":"Program: SABOTEUR","bytes":17,"seconds":5.09},…]`, in
/// the out-buffer: its length.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_blocks(h: *mut Zx) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let mut j = Json::new();
    j.raw("[");
    for (i, b) in z.machine.tape_blocks().iter().enumerate() {
        if i > 0 {
            j.raw(",");
        }
        j.raw("{\"kind\":");
        j.str(b.kind);
        j.raw(",\"label\":");
        j.str(&b.label);
        if let Some(n) = b.bytes {
            j.raw(&format!(",\"bytes\":{n}"));
        }
        j.raw(",\"seconds\":");
        j.num(b.seconds);
        j.raw("}");
    }
    j.raw("]");
    z.put(j.0.into_bytes())
}

/// The tape's name, as it went in, in the out-buffer (empty with no tape): its length.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_tape_name(h: *mut Zx) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let name = z.machine.tape_name().unwrap_or("").to_string();
    z.put(name.into_bytes())
}

/// What a SAVE has recorded, as a TAP file, in the out-buffer: its length (0 if nothing has been saved).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_saved_tap(h: *mut Zx) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let tap = z.machine.saved_tap();
    z.put(tap)
}

// --- Options --------------------------------------------------------------------------------------------------------

/// The options as bits (`OPT_*`), the AY's stereo in bits 12–13.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_options(h: *mut Zx) -> u32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return 0;
    };
    let o = z.machine.options();
    let mut bits = 0;
    for (on, bit) in [
        (o.issue2, OPT_ISSUE2),
        (o.late_timings, OPT_LATE_TIMINGS),
        (o.instant_load, OPT_INSTANT_LOAD),
        (o.auto_tape, OPT_AUTO_TAPE),
        (o.tape_sound, OPT_TAPE_SOUND),
        (o.snow, OPT_SNOW),
        (o.ay_on_48k, OPT_AY_ON_48K),
        (o.ghosting, OPT_GHOSTING),
        (o.sound, OPT_SOUND),
    ] {
        if on {
            bits |= bit;
        }
    }
    let stereo = match o.ay_stereo {
        AyStereo::Mono => 0,
        AyStereo::Abc => 1,
        AyStereo::Acb => 2,
    };
    bits | (stereo << OPT_STEREO_SHIFT)
}

/// Sets every option at once from bits as `zx_options` gives them.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_set_options(h: *mut Zx, bits: u32) {
    let Some(z) = (unsafe { zx(h) }) else {
        return;
    };
    let old = z.machine.options();
    let on = |bit: u32| bits & bit != 0;
    let options = Options {
        issue2: on(OPT_ISSUE2),
        late_timings: on(OPT_LATE_TIMINGS),
        instant_load: on(OPT_INSTANT_LOAD),
        auto_tape: on(OPT_AUTO_TAPE),
        tape_sound: on(OPT_TAPE_SOUND),
        snow: on(OPT_SNOW),
        ay_on_48k: on(OPT_AY_ON_48K),
        ghosting: on(OPT_GHOSTING),
        sound: on(OPT_SOUND),
        ay_stereo: match (bits >> OPT_STEREO_SHIFT) & 3 {
            1 => AyStereo::Abc,
            2 => AyStereo::Acb,
            _ => AyStereo::Mono,
        },
        ..old
    };
    if options != old {
        z.machine.set_options(options);
    }
}

/// The output's volume, 0 to 1.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_set_volume(h: *mut Zx, volume: f32) {
    if let Some(z) = unsafe { zx(h) } {
        let mut o = z.machine.options();
        let v = if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            1.0
        };
        if o.volume != v {
            o.volume = v;
            z.machine.set_options(o);
        }
    }
}

// --- State ----------------------------------------------------------------------------------------------------------

/// The whole machine (`Machine::save_state`), in the out-buffer: its length.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_save_state(h: *mut Zx) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let state = z.machine.save_state();
    z.put(state)
}

/// Puts the machine back as a saved state had it: 0, or ZX_E_STATE with the reason in the out-buffer (the machine
/// then as it was).
///
/// # Safety
/// `h` is null or a live handle; `ptr` points at `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_load_state(h: *mut Zx, ptr: *const u8, len: u32) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let state = unsafe { bytes(ptr, len) };
    // load_state builds the machine afresh and swaps it in only once the whole state has been read, but a state
    // can be refused after the deck has been taken out for the new one; a copy keeps the machine whole.
    let before = z.machine.clone();
    match z.machine.load_state(state) {
        Ok(()) => ZX_OK,
        Err(e) => {
            z.machine = before;
            z.fail(ZX_E_STATE, e.to_string())
        }
    }
}

/// The picture a saved state holds, 352 × 296 colours, in the out-buffer (`Machine::state_picture`: read without
/// loading the state, so this machine is untouched and no tape is replayed): its length, or ZX_E_STATE with the
/// reason.
///
/// # Safety
/// `h` is null or a live handle; `ptr` points at `len` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_state_picture(h: *mut Zx, ptr: *const u8, len: u32) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    match Machine::state_picture(unsafe { bytes(ptr, len) }) {
        Ok(picture) => z.put(picture),
        Err(e) => z.fail(ZX_E_STATE, e.to_string()),
    }
}

/// The machine as a snapshot file (0 .z80, 1 .szx, 2 .sna) in the out-buffer: its length, or ZX_E_FORMAT with the
/// reason (a .sna cannot hold a +2A or +3).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_save_snapshot(h: *mut Zx, format: u32) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let snap = z.machine.snapshot();
    match format {
        0 => z.put(snapshot::save_z80(&snap)),
        1 => z.put(snapshot::save_szx(&snap)),
        2 => match snapshot::save_sna(&snap) {
            Ok(b) => z.put(b),
            Err(e) => z.fail(ZX_E_FORMAT, e.to_string()),
        },
        _ => ZX_E_ARGUMENT,
    }
}

// --- The debugger ---------------------------------------------------------------------------------------------------

/// The registers: a pointer to twenty u32, AF BC DE HL AF' BC' DE' HL' IX IY SP PC I R IM IFF1 IFF2 HALTED MEMPTR,
/// and the T-state in the frame.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_registers(h: *mut Zx) -> *const u32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return std::ptr::null();
    };
    let r = z.machine.registers();
    z.regs = [
        r.af as u32,
        r.bc as u32,
        r.de as u32,
        r.hl as u32,
        r.af_ as u32,
        r.bc_ as u32,
        r.de_ as u32,
        r.hl_ as u32,
        r.ix as u32,
        r.iy as u32,
        r.sp as u32,
        r.pc as u32,
        r.i as u32,
        r.r as u32,
        r.im as u32,
        r.iff1 as u32,
        r.iff2 as u32,
        r.halted as u32,
        r.memptr as u32,
        r.t,
    ];
    z.regs.as_ptr()
}

/// Sets a register by its place in `zx_registers` (0 AF … 13 R, 14 IM, 15 IFF1, 16 IFF2), for the debugger.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_set_register(h: *mut Zx, index: u32, value: u32) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let r = z.machine.cpu_mut();
    let w = value as u16;
    let b = value as u8;
    match index {
        0 => r.set_af(w),
        1 => r.set_bc(w),
        2 => r.set_de(w),
        3 => r.set_hl(w),
        4 => r.af_ = w,
        5 => r.bc_ = w,
        6 => r.de_ = w,
        7 => r.hl_ = w,
        8 => r.ix = w,
        9 => r.iy = w,
        10 => r.sp = w,
        11 => {
            r.pc = w;
            r.prefix = 0;
            r.halted = false;
        }
        12 => r.i = b,
        13 => r.r = b,
        14 => r.im = b.min(2),
        15 => r.iff1 = value != 0,
        16 => r.iff2 = value != 0,
        _ => return ZX_E_ARGUMENT,
    }
    ZX_OK
}

/// Memory as the CPU sees it now.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_peek(h: *mut Zx, addr: u32) -> u32 {
    unsafe { zx(h) }.map_or(0xFF, |z| z.machine.peek(addr as u16) as u32)
}

/// Writes memory as the CPU would (ROM is not written).
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_poke(h: *mut Zx, addr: u32, value: u32) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.poke(addr as u16, value as u8);
    }
}

/// `count` instructions from `addr`, as JSON `[{"addr":32768,"len":3,"text":"LD HL,#4000"},…]`, in the
/// out-buffer: its length.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_disassemble(h: *mut Zx, addr: u32, count: u32) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let mut j = Json::new();
    j.raw("[");
    let mut a = addr as u16;
    for i in 0..count.min(256) {
        let (text, len) = z.machine.disassemble(a);
        if i > 0 {
            j.raw(",");
        }
        j.raw(&format!("{{\"addr\":{a},\"len\":{len},\"text\":"));
        j.str(&text);
        j.raw("}");
        a = a.wrapping_add(len.max(1) as u16);
    }
    j.raw("]");
    z.put(j.0.into_bytes())
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_add_breakpoint(h: *mut Zx, pc: u32) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.add_breakpoint(pc as u16);
    }
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_remove_breakpoint(h: *mut Zx, pc: u32) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.remove_breakpoint(pc as u16);
    }
}

/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_clear_breakpoints(h: *mut Zx) {
    if let Some(z) = unsafe { zx(h) } {
        z.machine.clear_breakpoints();
    }
}

/// The screen read as text against the ROM's font (`Machine::screen_text`): 24 rows of 32 characters, UTF-8,
/// joined by `\n`, in the out-buffer: its length. A cell no character matches reads as ▒.
///
/// # Safety
/// `h` is null or a live handle.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn zx_screen_text(h: *mut Zx) -> i32 {
    let Some(z) = (unsafe { zx(h) }) else {
        return ZX_E_ARGUMENT;
    };
    let text = z.machine.screen_text().text();
    z.put(text.into_bytes())
}

// --- JSON, by hand (no serde in the module) -------------------------------------------------------------------------

struct Json(String);

impl Json {
    fn new() -> Json {
        Json(String::new())
    }

    fn raw(&mut self, s: &str) {
        self.0.push_str(s);
    }

    fn str(&mut self, s: &str) {
        self.0.push('"');
        for c in s.chars() {
            match c {
                '"' => self.0.push_str("\\\""),
                '\\' => self.0.push_str("\\\\"),
                '\n' => self.0.push_str("\\n"),
                '\r' => self.0.push_str("\\r"),
                '\t' => self.0.push_str("\\t"),
                c if (c as u32) < 0x20 || c == '\u{7f}' => {
                    self.0.push_str(&format!("\\u{:04x}", c as u32))
                }
                c => self.0.push(c),
            }
        }
        self.0.push('"');
    }

    fn num(&mut self, v: f64) {
        if v.is_finite() {
            self.0
                .push_str(&format!("{}", (v * 1000.0).round() / 1000.0));
        } else {
            self.0.push('0');
        }
    }
}

#[cfg(test)]
mod tests;
