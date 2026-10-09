//! The machine: the CPU on the hardware's bus, frame by frame.

use z80::{Bus, Cpu, Regs};

use crate::deck::Deck;
use crate::input::{Input, Joystick, Typist};
use crate::memory::Memory;
use crate::model::{FloatingBus, Model, Timing};
use crate::sound::{AyStereo, Sound, default_tone};
use crate::video::{SnowEvent, SnowKind, Video};

/// What can be changed about the machine without changing what it is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Options {
    /// An Issue 2 keyboard (16K/48K): port FEh's bit 6 reads high after an OUT with MIC (bit 3) or EAR (bit 4)
    /// set, where an Issue 3 needs EAR. Abu Simbel Profanation and Rasputin need it.
    pub issue2: bool,
    /// Late ULA timings (16K, 48K, 128K, +2): everything one T-state later against the interrupt.
    pub late_timings: bool,
    /// Load standard ROM blocks at once by trapping LD-BYTES (0556h) when the 48 BASIC ROM is paged; anything
    /// else plays.
    pub instant_load: bool,
    /// Start the tape when the ROM's LD-BYTES is entered or a loader polls port FEh, stop it when the program
    /// stops reading it.
    pub auto_tape: bool,
    /// Hear the tape through the beeper while it plays.
    pub tape_sound: bool,
    /// The ULA's snow when I points at contended memory (16K/48K, 128K, +2).
    pub snow: bool,
    /// An AY (a Melodik-style interface on ports FFFDh/BFFDh) on a 16K or 48K.
    pub ay_on_48k: bool,
    pub ay_stereo: AyStereo,
    /// The output tone; None for the model's own (the 48K's speaker, a television for the others).
    pub tone: Option<audio::Tone>,
    /// 0.0 to 1.0.
    pub volume: f32,
    /// The keyboard matrix's ghosting (three keys at a rectangle's corners read as the fourth too).
    pub ghosting: bool,
    /// Make sound. Off, `audio()` is empty and the output stage costs nothing (for running flat out); the
    /// sources keep their levels, so sound turned on again goes on from them without a thump.
    pub sound: bool,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            issue2: false,
            late_timings: false,
            instant_load: false,
            auto_tape: true,
            tape_sound: true,
            snow: true,
            ay_on_48k: false,
            ay_stereo: AyStereo::Mono,
            tone: None,
            volume: 1.0,
            ghosting: true,
            sound: true,
        }
    }
}

/// Why `run_frame` (or `run`) returned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stop {
    /// The frame is complete: `frame()` and `audio()` hold it.
    FrameEnd,
    /// The CPU is at a breakpoint (before the instruction there); running again goes on from it.
    Breakpoint(u16),
    /// The steps asked for have been run.
    Steps,
}

/// The CPU's registers, as plain values (for the debugger and the page).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Registers {
    pub af: u16,
    pub bc: u16,
    pub de: u16,
    pub hl: u16,
    pub af_: u16,
    pub bc_: u16,
    pub de_: u16,
    pub hl_: u16,
    pub ix: u16,
    pub iy: u16,
    pub sp: u16,
    pub pc: u16,
    pub i: u8,
    pub r: u8,
    pub im: u8,
    pub iff1: bool,
    pub iff2: bool,
    pub halted: bool,
    pub memptr: u16,
    /// The T-state in the frame.
    pub t: u32,
}

/// Everything on the CPU's bus.
#[derive(Clone)]
pub(crate) struct Hw {
    pub model: Model,
    pub timing: Timing,
    pub mem: Memory,
    pub video: Video,
    pub input: Input,
    pub sound: Sound,
    pub ay: Option<ay::Ay>,
    pub deck: Option<Deck>,
    pub recorder: tape::Recorder,
    /// The +3's disk controller, with no drive attached.
    pub fdc: Option<crate::fdc::Fdc>,
    /// The last byte written to port FEh.
    pub port_fe: u8,
    pub options: Options,
    /// The CPU's B as the instruction began (for the automatic tape start's watch of loaders).
    pub cpu_b: u8,
    /// T-states since power-on at the start of this frame.
    pub frame_abs: u64,
    /// The +2A/+3's floating bus: the last byte the CPU read or wrote in contended memory, and when.
    pub last_bus: (i64, u8),
    /// Port FEh reads this frame, and whether the tape is being heard.
    pub fe_reads: u32,
    /// Interrupt length and whether the refresh can snow, with the options applied.
    pub snow_on: bool,
    /// When kept (`Machine::trace_ports`), every port write this frame: T-state, port, value.
    pub port_log: Option<Vec<(u32, u16, u8)>>,
}

#[inline(always)]
fn contended_slot(mem: &Memory, addr: u16) -> bool {
    mem.contended[(addr >> 14) as usize]
}

impl Hw {
    #[inline(always)]
    fn delay(&self, t: u32) -> u32 {
        self.timing.delay[t as usize] as u32
    }

    /// The video brought up to T-state `t` before something it shows changes.
    #[inline]
    pub fn render_to(&mut self, t: u32) {
        let screen = self.mem.screen();
        // Split borrow: the screen is in `mem`, the picture in `video`.
        let video = &mut self.video;
        video.render_to(t, screen);
    }

    /// A snowy refresh: the opcode fetch's fourth T-state at `t4` with I pointing at contended memory.
    #[cold]
    fn snow(&mut self, t4: u32, r: u8) {
        let tm = &self.timing;
        if t4 < tm.fetch {
            return;
        }
        let rel = t4 - tm.fetch;
        let (line, x) = (rel / tm.base.line, rel % tm.base.line);
        if line >= 192 || x >= 128 {
            return;
        }
        let kind = match x % 8 {
            0 => SnowKind::Snow(r),
            2 => SnowKind::Double,
            _ => return,
        };
        let col = (x / 8) * 2 + if kind == SnowKind::Double { 1 } else { 0 };
        self.video.snow.push(SnowEvent {
            line: line as u8,
            col: col as u8,
            kind,
        });
    }

    /// What the ULA puts on the bus at T-state `t` when nothing else does: the byte it is fetching for the
    /// screen, or FFh.
    pub fn ula_floating(&self, t: u32) -> u8 {
        let tm = &self.timing;
        if t < tm.fetch {
            return 0xFF;
        }
        let rel = t - tm.fetch;
        let (line, x) = (rel / tm.base.line, rel % tm.base.line);
        if line >= 192 || x >= 128 || x % 8 >= 4 {
            return 0xFF;
        }
        let col = (x / 8) * 2 + (x % 8) / 2;
        let (b, a) = crate::video::screen_addresses(line, col);
        self.mem.screen()[if x % 2 == 0 { b } else { a }]
    }

    /// The +2A/+3's floating bus at T-state `t`: the last byte over the gate array's bus (its own last screen
    /// fetch, or the CPU's last contended access, whichever came later), bit 0 set.
    fn plus3_floating(&self, t: u32) -> u8 {
        let tm = &self.timing;
        // The gate array's last fetch at or before t: the screen's bytes are fetched four at a time, bitmap
        // and attribute of two columns, every 8 T-states along each of the 192 paper lines.
        let mut fetch: Option<(i64, u8)> = None;
        if t >= tm.fetch {
            let rel = t - tm.fetch;
            let (mut line, mut x) = (rel / tm.base.line, rel % tm.base.line);
            if line >= 192 {
                line = 191;
                x = 127;
            } else if x >= 128 {
                x = 127;
            }
            if x % 8 >= 4 {
                x = (x & !7) + 3;
            }
            let at = tm.fetch + line * tm.base.line + x;
            let col = (x / 8) * 2 + (x % 8) / 2;
            let (b, a) = crate::video::screen_addresses(line, col);
            let v = self.mem.screen()[if x % 2 == 0 { b } else { a }];
            fetch = Some((at as i64, v));
        } else {
            // Before the first fetch of this frame: the last of the frame before.
            let (b, a) = crate::video::screen_addresses(191, 31);
            let _ = b;
            let at = tm.fetch as i64 + 191 * tm.base.line as i64 + 123 - tm.frame as i64;
            fetch = fetch.or(Some((at, self.mem.screen()[a])));
        }
        let (ft, fv) = fetch.unwrap();
        let v = if self.last_bus.0 > ft {
            self.last_bus.1
        } else {
            fv
        };
        v | 1
    }

    /// The I/O cycle's timing from T-state `s`: when a write lands and when a read is sampled (the ULA's
    /// contention by the port's address, WoS FAQ "Contended Input/Output"), and its end.
    #[inline]
    fn io_timing(&self, port: u16, s: u32) -> (u32, u32, u32) {
        if !self.timing.contend_no_mreq {
            return (s + 1, s + 3, s + 4);
        }
        let high = contended_slot(&self.mem, port);
        let ula = port & 1 == 0;
        match (high, ula) {
            // N:4
            (false, false) => (s + 1, s + 3, s + 4),
            // N:1, C:3
            (false, true) => {
                let w = s + 1;
                let r = w + self.delay(w) + 2;
                (w, r, r + 1)
            }
            // C:1, C:3
            (true, true) => {
                let w = s + self.delay(s) + 1;
                let r = w + self.delay(w) + 2;
                (w, r, r + 1)
            }
            // C:1, C:1, C:1, C:1
            (true, false) => {
                let mut x = s;
                x += self.delay(x);
                x += 1;
                let w = x;
                x += self.delay(x);
                x += 1;
                x += self.delay(x);
                x += 1;
                x += self.delay(x);
                (w, x, x + 1)
            }
        }
    }

    /// Port FEh's bit 6, the EAR line, at T-state `t`.
    fn ear_bit(&mut self, t: u32) -> bool {
        let shared_pin = !self.model.is_plus3();
        if let Some(deck) = &mut self.deck
            && deck.player.is_playing()
        {
            let level = if self.options.tape_sound {
                let sound = &mut self.sound;
                deck.level(t, |at, high| sound.tape_level(at, high))
            } else {
                deck.level(t, |_, _| {})
            };
            // The ULA's pin 28 carries the tape and the EAR output together: EAR driven high (3.5 V) holds
            // the input high whatever the tape does (FAQ: bit 6 is high over 0.70 V).
            return level || (shared_pin && self.port_fe & 0x10 != 0);
        }
        if !shared_pin {
            // The +2A/+3 read 0 with no signal, whatever was written (WoS FAQ, 128K reference).
            return false;
        }
        let issue2 = self.options.issue2 && self.model.has_issue();
        if issue2 {
            self.port_fe & 0x18 != 0
        } else {
            self.port_fe & 0x10 != 0
        }
    }

    fn read_port(&mut self, port: u16, t: u32) -> u8 {
        let mut value: Option<u8> = None;
        if port & 1 == 0 {
            // The ULA: keys in bits 0-4, EAR in bit 6, bits 5 and 7 high.
            let keys = self.input.read((port >> 8) as u8);
            let ear = self.ear_bit(t);
            value = Some(0xA0 | keys | if ear { 0x40 } else { 0 });
            self.fe_reads += 1;
            if self.options.auto_tape
                && let Some(deck) = &mut self.deck
            {
                match deck.watch_read(self.frame_abs + t as u64, self.cpu_b) {
                    Some(true) => {
                        deck.play(t);
                        deck.auto_started = true;
                    }
                    Some(false) => deck.stop(t),
                    None => {}
                }
            }
        }
        if self.input.joystick == Joystick::Kempston && port & 0x20 == 0 {
            // The Kempston interface (A5 low) takes priority over the keyboard (WoS FAQ, port FEh).
            value = Some(self.input.kempston());
        }
        if let Some(chip) = &self.ay {
            let reg_read =
                port & 0xC002 == 0xC000 || (self.model.is_plus3() && port & 0xC002 == 0x8000);
            if reg_read && let Some(v) = chip.read() {
                value = Some(v);
            }
        }
        if let Some(fdc) = &mut self.fdc {
            if port & 0xF002 == 0x2000 {
                value = Some(fdc.status());
            } else if port & 0xF002 == 0x3000 {
                value = Some(fdc.read_data());
            }
        }
        let v = match value {
            Some(v) => v,
            None => match self.timing.base.floating {
                FloatingBus::Ula => self.ula_floating(t),
                FloatingBus::Plus3 => {
                    if port & 0xF002 == 0 && !self.mem.locked {
                        self.plus3_floating(t)
                    } else {
                        0xFF
                    }
                }
                FloatingBus::None => 0xFF,
            },
        };
        // On the 128K and +2 a read of port 7FFDh writes what was read into the paging latch (FloatFFD).
        if matches!(self.model, Model::Spectrum128 | Model::Plus2) && port & 0x8002 == 0 {
            self.write_7ffd(t, v);
        }
        v
    }

    fn write_7ffd(&mut self, t: u32, value: u8) {
        if self.mem.locked {
            return;
        }
        if (value ^ self.mem.port_7ffd) & 0x08 != 0 {
            self.render_to(t);
        }
        self.mem.write_7ffd(value);
    }

    fn write_port(&mut self, port: u16, value: u8, t: u32) {
        if let Some(log) = &mut self.port_log {
            log.push((t, port, value));
        }
        if port & 1 == 0 {
            let screen = self.mem.screen();
            self.video.set_border(t, value & 7, screen);
            if (value ^ self.port_fe) & 0x18 != 0 {
                self.sound.beeper_out(t, value);
            }
            if (value ^ self.port_fe) & 0x08 != 0 {
                self.recorder.mic(t, value & 0x08 != 0);
            }
            self.port_fe = value;
        }
        match self.model {
            Model::Spectrum128 | Model::Plus2 | Model::Pentagon => {
                if port & 0x8002 == 0 {
                    self.write_7ffd(t, value);
                }
            }
            Model::Plus2A | Model::Plus3 => {
                if port & 0xC002 == 0x4000 {
                    self.write_7ffd(t, value);
                } else if port & 0xF002 == 0x3000 {
                    if let Some(fdc) = &mut self.fdc {
                        fdc.write_data(value);
                    }
                } else if port & 0xF002 == 0x1000 {
                    // (1FFDh never changes the bank on screen: that is 7FFDh's bit 3, in every mode.)
                    self.mem.write_1ffd(value);
                }
            }
            _ => {}
        }
        if let Some(chip) = &mut self.ay {
            if port & 0xC002 == 0xC000 {
                chip.select(value);
            } else if port & 0xC002 == 0x8000 {
                chip.write(t, value, &mut self.sound.ay_sink());
            }
        }
    }
}

impl Bus for Hw {
    #[inline(always)]
    fn fetch(&mut self, addr: u16, ir: u16, t: &mut u32) -> u8 {
        let s = (addr >> 14) as usize;
        if self.mem.contended[s] {
            *t += self.delay(*t);
        }
        let v = self.mem.mem[self.mem.offset[s] + (addr & 0x3FFF) as usize];
        if self.snow_on && self.mem.contended[(ir >> 14) as usize] {
            // The refresh in T4 carries R as this fetch has counted it.
            let r = ir as u8;
            let r = (r & 0x80) | (r.wrapping_add(1) & 0x7F);
            self.snow(*t + 3, r);
        }
        if self.timing.base.floating == FloatingBus::Plus3 && self.mem.contended[s] {
            self.last_bus = (*t as i64 + 2, v);
        }
        *t += 4;
        v
    }

    #[inline(always)]
    fn read(&mut self, addr: u16, t: &mut u32) -> u8 {
        let s = (addr >> 14) as usize;
        if self.mem.contended[s] {
            *t += self.delay(*t);
            if self.timing.base.floating == FloatingBus::Plus3 {
                let v = self.mem.mem[self.mem.offset[s] + (addr & 0x3FFF) as usize];
                self.last_bus = (*t as i64 + 2, v);
            }
        }
        let v = self.mem.mem[self.mem.offset[s] + (addr & 0x3FFF) as usize];
        *t += 3;
        v
    }

    #[inline(always)]
    fn write(&mut self, addr: u16, value: u8, t: &mut u32) {
        let s = (addr >> 14) as usize;
        if self.mem.contended[s] {
            *t += self.delay(*t);
            if self.timing.base.floating == FloatingBus::Plus3 {
                self.last_bus = (*t as i64 + 2, value);
            }
        }
        if self.mem.writable[s] {
            let off = (addr & 0x3FFF) as usize;
            if self.mem.screen_slot[s] && off < 0x1B00 {
                // The write lands in the T-state after the cycle begins; what the ULA fetched before is drawn.
                self.render_to(*t + 1);
            }
            self.mem.mem[self.mem.offset[s] + off] = value;
        }
        *t += 3;
    }

    #[inline(always)]
    fn internal(&mut self, addr: u16, n: u32, t: &mut u32) {
        if self.timing.contend_no_mreq && contended_slot(&self.mem, addr) {
            for _ in 0..n {
                *t += self.delay(*t) + 1;
            }
        } else {
            *t += n;
        }
    }

    fn port_in(&mut self, port: u16, t: &mut u32) -> u8 {
        let (_, r, end) = self.io_timing(port, *t);
        let v = self.read_port(port, r);
        *t = end;
        v
    }

    fn port_out(&mut self, port: u16, value: u8, t: &mut u32) {
        let (w, _, end) = self.io_timing(port, *t);
        self.write_port(port, value, w);
        *t = end;
    }

    fn int_ack(&mut self, t: &mut u32) -> u8 {
        // Nothing drives the data bus: what floats there (FFh at the frame's start, in the top border).
        let v = match self.timing.base.floating {
            FloatingBus::Ula => self.ula_floating(*t + 3),
            _ => 0xFF,
        };
        *t += 6;
        v
    }
}

/// A ZX Spectrum.
#[derive(Clone)]
pub struct Machine {
    pub(crate) cpu: Cpu,
    pub(crate) hw: Hw,
    /// The T-state in the frame.
    pub(crate) t: u32,
    pub(crate) frames: u64,
    pub(crate) nmi_pending: bool,
    pub(crate) breakpoints: Vec<u16>,
    /// The breakpoint the machine stopped at, passed over when it runs on.
    pub(crate) at_breakpoint: Option<u16>,
    pub(crate) slt: Option<snapshot::Slt>,
    pub(crate) typist: Typist,
    pub(crate) sample_rate: u32,
    /// Whether the 48K's ROM tape routines are paged in, and any hook needs looking at, at each boundary.
    pub(crate) hooks: bool,
    /// The frame counter the page sees (never restored by `load_state`).
    pub(crate) frame_count: u64,
    /// A frame is about to begin: the typist's keys for it go in first.
    pub(crate) frame_start: bool,
}

const CF: u8 = 0x01;

/// Frames with no read of port FEh after which a tape the deck started itself is stopped.
pub(crate) const IDLE_STOP_FRAMES: u32 = 250;

/// The flags of a logical operation's result (S, Z, Y, X, P; H, N and C clear).
fn sz53p(v: u8) -> u8 {
    let mut f = v & 0xA8;
    if v == 0 {
        f |= 0x40;
    }
    if v.count_ones().is_multiple_of(2) {
        f |= 0x04;
    }
    f
}

/// CP 1 on A: the flags it leaves, and whether carry is set (A was 0: the parity checked out).
fn cp1(r: &mut Regs) -> bool {
    let a = r.a;
    let res = a.wrapping_sub(1);
    // N set; S from the result; Y and X from the operand (1: neither).
    let mut f = 0x02 | (res & 0x80);
    if res == 0 {
        f |= 0x40;
    }
    if a & 0x0F == 0 {
        f |= 0x10;
    }
    if a == 0x80 {
        f |= 0x04;
    }
    if a < 1 {
        f |= CF;
    }
    r.f = f;
    a == 0
}

/// The sample rate the sound is made at until `set_sample_rate` says otherwise.
pub const DEFAULT_SAMPLE_RATE: u32 = 48_000;

impl Machine {
    /// A machine of `model`, switched on.
    pub fn new(model: Model) -> Machine {
        Machine::with_options(model, Options::default())
    }

    /// A machine of `model` with `options`, switched on.
    pub fn with_options(model: Model, options: Options) -> Machine {
        Machine::build(model, options, DEFAULT_SAMPLE_RATE)
    }

    fn build(model: Model, options: Options, rate: u32) -> Machine {
        let timing = Timing::new(model, options.late_timings);
        let mem = Memory::new(model);
        let video = Video::new(
            timing.first_pixel,
            timing.base.line,
            timing.base.fetch_offset,
            timing.base.border_step,
            timing.base.border_latch,
        );
        let has_ay = model.has_ay() || options.ay_on_48k;
        let tone = options.tone.unwrap_or_else(|| default_tone(model));
        let sound = Sound::new(
            model,
            timing.base.clock_hz,
            rate,
            has_ay,
            tone,
            options.volume,
        );
        let ay = has_ay.then(|| {
            // The 128K family's AY runs at half the CPU's clock; the Pentagon's at 1.75 MHz; one added to a 48K
            // (a Melodik) at 1.7734 MHz, the 128's.
            let ay_clock = if model.has_ay() {
                timing.base.clock_hz / 2
            } else {
                1_773_400
            };
            ay::Ay::new(ay::Chip::Ay8912, ay_clock, timing.base.clock_hz)
        });
        let snow_on = options.snow && timing.base.snow;
        let mut m = Machine {
            cpu: Cpu::new(),
            hw: Hw {
                model,
                timing,
                mem,
                video,
                input: Input::new(),
                sound,
                ay,
                deck: None,
                recorder: tape::Recorder::new(),
                fdc: (model == Model::Plus3).then(crate::fdc::Fdc::default),
                port_fe: 0,
                options,
                cpu_b: 0,
                frame_abs: 0,
                last_bus: (i64::MIN / 2, 0xFF),
                fe_reads: 0,
                snow_on,
                port_log: None,
            },
            t: 0,
            frames: 0,
            nmi_pending: false,
            breakpoints: Vec::new(),
            at_breakpoint: None,
            slt: None,
            typist: Typist::new(),
            sample_rate: rate,
            hooks: false,
            frame_count: 0,
            frame_start: true,
        };
        m.apply_mix();
        m.hw.input.set_ghosting(options.ghosting);
        m.update_hooks();
        m
    }

    fn apply_mix(&mut self) {
        let share = self.hw.sound.shares.ay;
        let model = self.hw.model;
        if let Some(chip) = &mut self.hw.ay {
            let stereo = match (self.hw.options.ay_stereo, model) {
                (AyStereo::Mono, _) => ay::Stereo::Joined,
                (AyStereo::Abc, _) => ay::Stereo::Abc,
                (AyStereo::Acb, _) => ay::Stereo::Acb,
            };
            chip.set_mix(ay::Mix {
                stereo,
                separation: 1.0,
                gain: share,
            });
        }
    }

    pub(crate) fn update_hooks(&mut self) {
        let o = &self.hw.options;
        self.hooks = !self.breakpoints.is_empty()
            || self.slt.is_some()
            || (self.hw.deck.is_some() && (o.instant_load || o.auto_tape));
    }

    pub fn model(&self) -> Model {
        self.hw.model
    }

    pub fn options(&self) -> Options {
        self.hw.options
    }

    /// Changes the options. Those that change the machine's timing (late timings) or what it has (an AY on a
    /// 48K) take effect from the next frame.
    pub fn set_options(&mut self, options: Options) {
        let old = self.hw.options;
        self.hw.options = options;
        if old.late_timings != options.late_timings {
            let timing = Timing::new(self.hw.model, options.late_timings);
            // The picture drawn so far is kept, and drawing goes on from where it had got to (a new Video
            // would start the frame again from its top, redrawing what was already drawn from memory as it
            // is now).
            let pixels = std::mem::take(&mut self.hw.video.pixels);
            let flash = self.hw.video.flash_frames;
            let border = self.hw.video.border;
            let (row, unit) = self.hw.video.position();
            self.hw.video = Video::new(
                timing.first_pixel,
                timing.base.line,
                timing.base.fetch_offset,
                timing.base.border_step,
                timing.base.border_latch,
            );
            self.hw.video.pixels = pixels;
            self.hw.video.flash_frames = flash;
            self.hw.video.border = border;
            self.hw.video.set_position(row, unit);
            self.hw.timing = timing;
        }
        if old.ay_on_48k != options.ay_on_48k && !self.hw.model.has_ay() {
            let has_ay = options.ay_on_48k;
            self.hw.sound.shares = crate::sound::shares(self.hw.model, has_ay);
            self.hw.ay = has_ay
                .then(|| ay::Ay::new(ay::Chip::Ay8912, 1_773_400, self.hw.timing.base.clock_hz));
            self.hw.sound.ay_raw = (0, 0);
            self.hw.sound.ay_total = (0, 0);
            self.hw.sound.ay_offset = (0, 0);
        }
        if old.ay_stereo != options.ay_stereo || old.ay_on_48k != options.ay_on_48k {
            self.apply_mix();
        }
        if old.tone != options.tone || old.volume != options.volume {
            let tone = options.tone.unwrap_or_else(|| default_tone(self.hw.model));
            self.hw.sound.buffer.set_output(audio::Output {
                tone,
                dc_block: true,
                volume: options.volume,
            });
        }
        self.hw.snow_on = options.snow && self.hw.timing.base.snow;
        if old.ghosting != options.ghosting {
            self.hw.input.set_ghosting(options.ghosting);
        }
        self.update_hooks();
    }

    /// The RESET button: the CPU's RESET line and the paging latches (and the AY's and the +3 disk
    /// controller's RESET, which are on the same line); RAM, the tape and the options are kept.
    pub fn reset(&mut self) {
        self.cpu.reset();
        self.hw.mem.reset_paging();
        if let Some(chip) = &mut self.hw.ay {
            chip.reset();
        }
        if let Some(fdc) = &mut self.hw.fdc {
            *fdc = crate::fdc::Fdc::default();
        }
        self.nmi_pending = false;
    }

    /// Switches the machine off and on again as `model` (the same model or another): RAM as at power-on, the
    /// tape kept in the deck (rewound to where it stood, stopped), the options and the sample rate kept.
    pub fn power_on(&mut self, model: Model) {
        let deck = self.hw.deck.take();
        let options = self.hw.options;
        let breakpoints = std::mem::take(&mut self.breakpoints);
        let frame_count = self.frame_count;
        *self = Machine::build(model, options, self.sample_rate);
        self.breakpoints = breakpoints;
        self.frame_count = frame_count;
        if let Some(d) = deck {
            // The tape stays in the deck, stopped at the block it stood at.
            let block = d.status().block;
            self.insert_tape(d.tape().clone(), d.hash, d.name.clone());
            if block > 0 {
                self.tape_seek(block);
            }
        }
        self.update_hooks();
    }

    /// Sends an NMI (a Multiface-style button): taken at the next instruction boundary.
    pub fn nmi(&mut self) {
        self.nmi_pending = true;
    }

    /// Runs to the end of the frame (or to a breakpoint). After a whole frame, `frame()` is its picture and
    /// `audio()` its sound.
    pub fn run_frame(&mut self) -> Stop {
        self.run(u64::MAX)
    }

    /// Runs at most `steps` CPU steps (an instruction, a HALT cycle, or a DD/FD prefix), ending the frame if
    /// it is reached, and stopping at breakpoints.
    pub fn run(&mut self, mut steps: u64) -> Stop {
        if self.frame_start {
            self.frame_start = false;
            self.feed_keys();
        }
        let frame_len = self.hw.timing.frame;
        let int_len = self.hw.timing.base.int_len;
        let mut t = self.t;
        while t < frame_len {
            if steps == 0 {
                self.t = t;
                return Stop::Steps;
            }
            steps -= 1;
            if self.hooks {
                self.t = t;
                if let Some(stop) = self.hook() {
                    return stop;
                }
                t = self.t;
            }
            self.hw.cpu_b = self.cpu.regs.b;
            // An interrupt or NMI taken puts the CPU at its handler: the boundary is looked at again (a
            // breakpoint there), then the handler's first instruction runs.
            if self.nmi_pending && self.cpu.nmi(&mut self.hw, &mut t) {
                self.nmi_pending = false;
                continue;
            } else if t < int_len && self.cpu.interrupt(&mut self.hw, &mut t) {
                continue;
            }
            let slt_trap = self.slt.is_some() && self.at_slt_trap();
            self.cpu.step(&mut self.hw, &mut t);
            if slt_trap {
                self.slt_load();
            }
        }
        self.t = t;
        self.end_frame();
        Stop::FrameEnd
    }

    /// One instruction (with its prefixes), or one HALT cycle; interrupts as they come.
    pub fn step_instruction(&mut self) -> Stop {
        self.at_breakpoint = Some(self.cpu.regs.pc);
        loop {
            let r = self.run(1);
            if r != Stop::Steps || self.cpu.regs.prefix == 0 {
                return r;
            }
        }
    }

    /// What the boundary needs: breakpoints, the tape traps.
    fn hook(&mut self) -> Option<Stop> {
        let pc = self.cpu.regs.pc;
        if !self.breakpoints.is_empty() && self.cpu.regs.prefix == 0 {
            if self.at_breakpoint == Some(pc) {
                self.at_breakpoint = None;
            } else if self.breakpoints.contains(&pc) {
                self.at_breakpoint = Some(pc);
                return Some(Stop::Breakpoint(pc));
            }
        }
        if (pc == 0x0556 || pc == 0x056C)
            && self.cpu.regs.prefix == 0
            && self.hw.deck.is_some()
            && self.hw.mem.basic48_paged()
        {
            self.tape_hook(pc);
        }
        None
    }

    /// At 0556h (LD-BYTES) the tape starts by itself; at 056Ch (LD-START, once LD-BYTES has set the border
    /// and pushed SA/LD-RET) the instant load takes the block, as Fuse's trap does at the RET NZ before it.
    fn tape_hook(&mut self, pc: u16) {
        let o = self.hw.options;
        let t = self.t;
        let deck = self.hw.deck.as_mut().unwrap();
        if pc == 0x0556 {
            if o.auto_tape && !o.instant_load && !deck.player.is_playing() {
                deck.play(t);
                deck.auto_started = true;
            }
            return;
        }
        // A block longer than LD-BYTES reads (the flag, DE bytes and the parity byte; the flag alone when DE is
        // 0) plays from the edges, as Fuse's trap leaves it: the rest of the block plays on under whatever
        // reads the tape next, which a block taken whole would not give it.
        let de = self.cpu.regs.de() as usize;
        let reads = if de == 0 { 1 } else { de + 2 };
        if o.instant_load
            && let Some(block) = deck.take_rom_block_if(t, |b| b.bytes.len() <= reads)
        {
            self.ld_bytes(block);
            return;
        }
        let deck = self.hw.deck.as_mut().unwrap();
        if o.auto_tape && !deck.player.is_playing() && !deck.player.at_end() {
            deck.play(t);
            deck.auto_started = true;
        }
    }

    /// LD-BYTES done at once with a block from the tape, leaving every register as the ROM's own routine
    /// leaves it, and returning through the RET at 05E2h to SA/LD-RET, which restores the border and
    /// enables interrupts as after a real load. It follows the ROM's loop (48.rom 05A9h-05E2h) a byte at a
    /// time, as the routine runs on the edges, so that a load that fails fails as the ROM's does:
    ///
    /// - each byte read leaves it in L and B at B0h; H is the XOR of every byte read, the flag included;
    /// - the flag byte against the one asked for (A'): XOR, so a mismatch returns its difference in A with
    ///   the XOR's flags, B0h in B, and, swapped into AF' by LD-LOOP's EX AF,AF', D OR E with its flags;
    /// - loading stores each byte at IX; verifying XORs it with (IX), and a difference returns as the flag
    ///   mismatch does; a byte verified leaves 0 and its flags (0044h) in AF';
    /// - after DE bytes, one more is read as the parity byte (so L is the last byte read, the parity byte
    ///   of a whole block), and `LD A,H : CP 1` sets the carry if all of them XORed to 0;
    /// - a block that ends first fails reading the next bit: LD-EDGE-1's counter in B comes round to 0
    ///   (INC B: Z and H set, carry clear from its AND A), A 0 from its delay loop, L 1 from LD-MARKER.
    ///
    /// C holds the border's colour bits and the EAR level as LD-SYNC left them, complemented at each edge of
    /// the pilot, so on a real tape it depends on where in the pilot the routine began: 01h is taken here
    /// (Fuse's trap does the same), and AF' and C are kept consistent with it (A' = C, F' from RRA on it).
    /// Tested against the routine run from the edges: tests/ld_bytes.rs.
    fn ld_bytes(&mut self, block: tape::RomBlock) {
        let t = self.t;
        self.hw.render_to(t);
        let bytes = block.bytes;
        let mem = &mut self.hw.mem;
        let r = &mut self.cpu.regs;
        r.pc = 0x05E2;
        // LD-BYTES has done EX AF,AF': the flag asked for is in A', LOAD (carry set) or VERIFY in F'.
        let load = r.af_ & 1 != 0;
        let requested = (r.af_ >> 8) as u8;
        const C0: u8 = 0x01;
        r.c = C0;
        let Some(&flag) = bytes.first() else {
            // Nothing after the sync: the first bit's edges never come.
            r.a = 0;
            r.f = 0x50;
            r.b = 0;
            r.l = 1;
            r.h = 0;
            return;
        };
        let or_de = |de: u16| {
            let v = (de >> 8) as u8 | de as u8;
            ((v as u16) << 8) | sz53p(v) as u16
        };
        let mut de = r.de();
        let mut ix = r.ix;
        let mut h = flag;
        r.l = flag;
        r.b = 0xB0;
        if de == 0 {
            // The ROM's zero-length quirk: the flag byte read, compared with nothing, taken as the parity.
            r.a = h;
            cp1(r);
            r.h = h;
            return;
        }
        let diff = requested ^ flag;
        if diff != 0 {
            // RL C has taken the LOAD flag into C, and the RET NZ comes before RRA puts it back.
            r.a = diff;
            r.f = sz53p(diff);
            r.af_ = or_de(de);
            r.c = (C0 << 1) | load as u8;
            r.h = h;
            return;
        }
        // LD-FLAG's LD A,C : RRA (Z and P from the XOR), swapped out at LD-DEC.
        let mut af_ = ((C0 as u16) << 8) | (0x44 | (C0 & 0x28) | load as u8) as u16;
        let mut next = 1;
        loop {
            let Some(&byte) = bytes.get(next) else {
                r.a = 0;
                r.f = 0x50;
                r.b = 0;
                r.l = 1;
                break;
            };
            next += 1;
            r.l = byte;
            r.b = 0xB0;
            h ^= byte;
            if de == 0 {
                r.a = h;
                cp1(r);
                break;
            }
            if load {
                mem.write(ix, byte);
            } else {
                let v = mem.read(ix) ^ byte;
                if v != 0 {
                    r.a = v;
                    r.f = sz53p(v);
                    af_ = or_de(de);
                    break;
                }
                af_ = 0x0044;
            }
            ix = ix.wrapping_add(1);
            de = de.wrapping_sub(1);
        }
        r.h = h;
        r.set_de(de);
        r.ix = ix;
        r.af_ = af_;
    }

    fn at_slt_trap(&self) -> bool {
        let pc = self.cpu.regs.pc;
        self.cpu.regs.prefix == 0
            && self.hw.mem.read(pc) == 0xED
            && self.hw.mem.read(pc.wrapping_add(1)) == 0xFB
    }

    /// The super level loader's trap (ED FBh, Fuse's `slt_trap`): level A loaded to HL.
    fn slt_load(&mut self) {
        let level = self.cpu.regs.a;
        let mut at = self.cpu.regs.hl();
        if let Some(data) = self
            .slt
            .as_ref()
            .and_then(|s| s.levels.get(&level))
            .cloned()
        {
            for b in data {
                self.hw.mem.write(at, b);
                at = at.wrapping_add(1);
            }
        }
    }

    /// The typist's keys due this frame, put to the keyboard.
    fn feed_keys(&mut self) {
        for (code, down) in self.typist.due(self.frame_count) {
            self.hw.input.key(code, down);
        }
    }

    fn end_frame(&mut self) {
        let frame_len = self.hw.timing.frame;
        let hw = &mut self.hw;
        if let Some(deck) = &mut hw.deck {
            if deck.player.is_playing() {
                if hw.options.tape_sound {
                    let sound = &mut hw.sound;
                    deck.player
                        .edges_until(frame_len, |at, high| sound.tape_level(at, high));
                }
                // Nothing has read the tape for five seconds: a tape the deck started is stopped. (Not sooner:
                // the ROM's own LD-BYTES spends a second at LD-WAIT, 0574h, reading nothing; a loader may
                // decrypt for longer while a tone plays, and then reads on into the rest of the tone.)
                if hw.fe_reads == 0 {
                    deck.idle_frames += 1;
                    if deck.auto_started
                        && hw.options.auto_tape
                        && deck.idle_frames >= IDLE_STOP_FRAMES
                    {
                        deck.stop(frame_len);
                    }
                }
            }
            if !deck.player.is_playing() {
                hw.sound.tape_level(frame_len, false);
            }
            deck.end_frame();
        }
        if let Some(chip) = &mut hw.ay {
            chip.end_frame(frame_len, &mut hw.sound.ay_sink());
        }
        if hw.options.sound {
            hw.sound.end_frame(frame_len);
        } else {
            hw.sound.buffer.end_frame(frame_len);
            hw.sound.buffer.clear();
            hw.sound.samples.clear();
        }
        {
            let screen = hw.mem.screen();
            hw.video.end_frame(screen);
        }
        hw.recorder.end_frame(frame_len);
        hw.last_bus.0 -= frame_len as i64;
        hw.fe_reads = 0;
        hw.frame_abs += frame_len as u64;
        self.t -= frame_len;
        self.frames += 1;
        self.frame_count += 1;
        self.frame_start = true;
    }

    // --- What the page and the CLI read and do ---

    /// The last frame: `FRAME_WIDTH × FRAME_HEIGHT` colours 0–15.
    pub fn frame(&self) -> &[u8] {
        &self.hw.video.pixels
    }

    pub fn frame_width(&self) -> usize {
        crate::video::FRAME_WIDTH
    }

    pub fn frame_height(&self) -> usize {
        crate::video::FRAME_HEIGHT
    }

    /// The last frame's sound: interleaved stereo samples at the sample rate.
    pub fn audio(&self) -> &[f32] {
        &self.hw.sound.samples
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn set_sample_rate(&mut self, hz: u32) {
        if hz != self.sample_rate && hz > 0 {
            self.sample_rate = hz;
            self.hw.sound.buffer.set_sample_rate(hz);
        }
    }

    /// Frames run since the machine was made (not restored by `load_state`).
    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }

    /// The T-state in the current frame.
    pub fn tstate(&self) -> u32 {
        self.t
    }

    /// Puts the CPU at T-state `t` of the frame (for the debugger and timing tests). The picture goes on
    /// being drawn from where it had got to.
    pub fn set_tstate(&mut self, t: u32) {
        self.t = t.min(self.hw.timing.frame - 1);
    }

    /// Frames the machine has run since power-on (part of its state).
    pub fn frames(&self) -> u64 {
        self.frames
    }

    /// A key down or up: code = half-row × 5 + bit.
    pub fn key(&mut self, code: u8, down: bool) {
        self.hw.input.key(code, down);
    }

    pub fn key_down(&self, code: u8) -> bool {
        self.hw.input.is_down(code)
    }

    pub fn release_keys(&mut self) {
        self.hw.input.release_all();
        self.typist.clear();
    }

    /// The joystick's kind and its bits (right 1, left 2, down 4, up 8, fire 16).
    pub fn joystick(&mut self, kind: Joystick, bits: u8) {
        self.hw.input.set_joystick(kind, bits);
    }

    /// Text typed from the next frame at the ROM's pace (see `input::char_chords`).
    pub fn type_text(&mut self, text: &str) -> u64 {
        let now = self.frame_count;
        self.typist.type_text(text, now)
    }

    /// Chords (keys held together) typed one after another at the ROM's pace.
    pub fn type_chords(&mut self, chords: &[Vec<u8>]) -> u64 {
        let now = self.frame_count;
        self.typist.type_chords(chords, now)
    }

    /// A chord held for `frames` frames from the next frame (as a game sees a key).
    pub fn press(&mut self, chord: &[u8], frames: u64) {
        self.press_at(chord, 0, frames);
    }

    /// A chord held for `frames` frames from `delay` frames after the next.
    pub fn press_at(&mut self, chord: &[u8], delay: u64, frames: u64) {
        let now = self.frame_count + delay;
        self.typist.press(chord, now, frames);
    }

    /// Whether typed keys are still to go in.
    pub fn typing(&self) -> bool {
        self.typist.busy(self.frame_count)
    }

    /// The registers.
    pub fn registers(&self) -> Registers {
        let r = &self.cpu.regs;
        Registers {
            af: r.af(),
            bc: r.bc(),
            de: r.de(),
            hl: r.hl(),
            af_: r.af_,
            bc_: r.bc_,
            de_: r.de_,
            hl_: r.hl_,
            ix: r.ix,
            iy: r.iy,
            sp: r.sp,
            pc: r.pc,
            i: r.i,
            r: r.r,
            im: r.im,
            iff1: r.iff1,
            iff2: r.iff2,
            halted: r.halted,
            memptr: r.memptr,
            t: self.t,
        }
    }

    /// The CPU's whole state.
    pub fn cpu(&self) -> &Regs {
        &self.cpu.regs
    }

    pub fn cpu_mut(&mut self) -> &mut Regs {
        &mut self.cpu.regs
    }

    /// Memory as the CPU sees it now.
    pub fn peek(&self, addr: u16) -> u8 {
        self.hw.mem.read(addr)
    }

    /// Writes memory as the CPU would (ROM is not written).
    pub fn poke(&mut self, addr: u16, value: u8) {
        self.hw.mem.write(addr, value);
    }

    /// A RAM bank's 16K (0–7; a 48K's are 5, 2 and 0).
    pub fn ram_bank(&self, n: usize) -> &[u8] {
        self.hw.mem.bank(n & 7)
    }

    /// The paging ports as last written (7FFDh, 1FFDh) and whether 7FFDh is locked.
    pub fn paging(&self) -> (u8, u8, bool) {
        (
            self.hw.mem.port_7ffd,
            self.hw.mem.port_1ffd,
            self.hw.mem.locked,
        )
    }

    /// The last byte written to port FEh (the border in bits 0–2).
    pub fn port_fe(&self) -> u8 {
        self.hw.port_fe
    }

    /// The AY's registers, if the machine has one.
    pub fn ay_registers(&self) -> Option<[u8; 16]> {
        self.hw.ay.as_ref().map(|a| a.registers())
    }

    pub fn add_breakpoint(&mut self, pc: u16) {
        if !self.breakpoints.contains(&pc) {
            self.breakpoints.push(pc);
        }
        self.update_hooks();
    }

    pub fn remove_breakpoint(&mut self, pc: u16) {
        self.breakpoints.retain(|&b| b != pc);
        self.update_hooks();
    }

    pub fn clear_breakpoints(&mut self) {
        self.breakpoints.clear();
        self.update_hooks();
    }

    pub fn breakpoints(&self) -> &[u16] {
        &self.breakpoints
    }

    /// The instruction at `addr`, as the CPU sees memory now: its text and length.
    pub fn disassemble(&self, addr: u16) -> (String, u8) {
        let i = z80::disasm::disassemble(|a| self.hw.mem.read(a), addr);
        (i.text, i.len)
    }

    /// Draws the whole frame afresh from memory as it is now (the picture `frame()` gives), the border as it
    /// is; the frame in progress goes on from where it was.
    pub fn redraw(&mut self) {
        let (row, unit) = self.hw.video.position();
        self.hw.video.set_position(0, 0);
        self.hw.render_to(u32::MAX);
        self.hw.video.set_position(row, unit);
    }

    /// Sets the border colour at once, as for a screen shown with no program running.
    pub fn set_border_now(&mut self, colour: u8) {
        self.hw.video.border = colour & 7;
        self.hw.port_fe = (self.hw.port_fe & !7) | (colour & 7);
    }

    /// Keeps (or stops keeping) every port write: the T-state at which it lands (the I/O cycle's second
    /// T-state, after contention), the port and the value. `port_writes` gives them and starts afresh.
    pub fn trace_ports(&mut self, on: bool) {
        self.hw.port_log = on.then(Vec::new);
    }

    pub fn port_writes(&mut self) -> Vec<(u32, u16, u8)> {
        self.hw
            .port_log
            .as_mut()
            .map(std::mem::take)
            .unwrap_or_default()
    }

    /// What a SAVE has recorded on the MIC line, as a TAP file (empty if nothing was saved).
    pub fn saved_tap(&self) -> Vec<u8> {
        self.hw.recorder.tap()
    }
}
