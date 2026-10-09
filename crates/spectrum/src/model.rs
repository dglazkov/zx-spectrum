//! The models, and the timings of each: clock, frame, interrupt, where the picture is, and the ULA's (or gate
//! array's) contention. docs/machine.md gives the source of every figure.

/// A Spectrum model.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Model {
    /// The 16K: the 48K's ROM and ULA with only the lower 16K of RAM (bank 5); 8000h–FFFFh read FFh.
    Spectrum16,
    /// The 48K (Issue 2 or 3 keyboard, early or late ULA timings: see `Options`).
    Spectrum48,
    /// The Spectrum 128 ("toastrack"): 128K of RAM in eight banks, two ROMs, the AY.
    Spectrum128,
    /// The grey +2: the 128 with Amstrad's ROMs (its menu has no Tape Tester).
    Plus2,
    /// The +2A: Amstrad's gate array, four ROMs, port 1FFDh's paging, no disk drive.
    Plus2A,
    /// The +3: the +2A with a disk interface. Its controller (a µPD765A) is there with no drive attached:
    /// the ROM finds the controller and titles itself "128 +3", finds no disk, and runs BASIC and loads from
    /// tape (a +2A, with no controller, reads FFh from its ports and titles itself "128 +2A").
    Plus3,
    /// The Pentagon 128: a Russian clone with the 128's ROMs, no contention, its own frame (71,680 T-states)
    /// and interrupt, and no floating bus.
    Pentagon,
}

impl Model {
    pub const ALL: [Model; 7] = [
        Model::Spectrum16,
        Model::Spectrum48,
        Model::Spectrum128,
        Model::Plus2,
        Model::Plus2A,
        Model::Plus3,
        Model::Pentagon,
    ];

    /// The model's short name, as the CLI and the page call it: `16k`, `48k`, `128k`, `plus2`, `plus2a`,
    /// `plus3`, `pentagon`.
    pub fn id(self) -> &'static str {
        match self {
            Model::Spectrum16 => "16k",
            Model::Spectrum48 => "48k",
            Model::Spectrum128 => "128k",
            Model::Plus2 => "plus2",
            Model::Plus2A => "plus2a",
            Model::Plus3 => "plus3",
            Model::Pentagon => "pentagon",
        }
    }

    /// The model's name for people.
    pub fn name(self) -> &'static str {
        match self {
            Model::Spectrum16 => "ZX Spectrum 16K",
            Model::Spectrum48 => "ZX Spectrum 48K",
            Model::Spectrum128 => "ZX Spectrum 128",
            Model::Plus2 => "ZX Spectrum +2",
            Model::Plus2A => "ZX Spectrum +2A",
            Model::Plus3 => "ZX Spectrum +3",
            Model::Pentagon => "Pentagon 128",
        }
    }

    /// The model from its short name (`48k`, `128`, `+2a`, ... in any case, with or without the `k`).
    pub fn from_id(name: &str) -> Option<Model> {
        let n = name
            .trim()
            .to_ascii_lowercase()
            .replace(['+', ' ', '_', '-'], "");
        Some(match n.as_str() {
            "16" | "16k" => Model::Spectrum16,
            "48" | "48k" => Model::Spectrum48,
            "128" | "128k" => Model::Spectrum128,
            "2" | "plus2" | "p2" => Model::Plus2,
            "2a" | "plus2a" | "p2a" => Model::Plus2A,
            "3" | "plus3" | "p3" => Model::Plus3,
            "pentagon" | "pentagon128" => Model::Pentagon,
            _ => return None,
        })
    }

    /// The CPU's clock, in T-states a second.
    pub fn clock_hz(self) -> u32 {
        timing_base(self).clock_hz
    }

    /// T-states in a frame: 69,888 on the 16K/48K, 70,908 on the 128K family, 71,680 on the Pentagon.
    pub fn frame_tstates(self) -> u32 {
        let t = timing_base(self);
        t.line * t.lines
    }

    /// Frames a second (50.08 on the 48K).
    pub fn frame_rate(self) -> f64 {
        self.clock_hz() as f64 / self.frame_tstates() as f64
    }

    /// Whether the model has the AY built in.
    pub fn has_ay(self) -> bool {
        !matches!(self, Model::Spectrum16 | Model::Spectrum48)
    }

    /// Whether the model pages memory through port 7FFDh (everything but the 16K and 48K).
    pub fn is_128k(self) -> bool {
        self.has_ay()
    }

    /// Whether the model is a +2A or +3 (Amstrad's gate array, port 1FFDh, four ROMs).
    pub fn is_plus3(self) -> bool {
        matches!(self, Model::Plus2A | Model::Plus3)
    }

    /// Whether the model boots to the 128's menu (rather than straight into 48 BASIC).
    pub fn has_menu(self) -> bool {
        self.is_128k()
    }

    /// Whether the model has both early and late ULA timings (the 16K, 48K, 128K and +2: "some machines use the
    /// timings given in this FAQ, while others are one T state later for all timings", WoS FAQ).
    pub fn has_late_timings(self) -> bool {
        matches!(
            self,
            Model::Spectrum16 | Model::Spectrum48 | Model::Spectrum128 | Model::Plus2
        )
    }

    /// Whether the model has an Issue 2 or Issue 3 keyboard choice (the 16K and 48K).
    pub fn has_issue(self) -> bool {
        matches!(self, Model::Spectrum16 | Model::Spectrum48)
    }

    /// The RAM banks the model has, by number: a 48K's 4000h, 8000h and C000h are banks 5, 2 and 0 (as
    /// `snapshot::Model::banks` numbers them), a 16K's bank 5 alone.
    pub fn banks(self) -> &'static [usize] {
        match self {
            Model::Spectrum16 => &[5],
            Model::Spectrum48 => &[5, 2, 0],
            _ => &[0, 1, 2, 3, 4, 5, 6, 7],
        }
    }

    /// The snapshot crate's name for the model.
    pub fn to_snapshot(self) -> snapshot::Model {
        match self {
            Model::Spectrum16 => snapshot::Model::Spectrum16,
            Model::Spectrum48 => snapshot::Model::Spectrum48,
            Model::Spectrum128 => snapshot::Model::Spectrum128,
            Model::Plus2 => snapshot::Model::Plus2,
            Model::Plus2A => snapshot::Model::Plus2A,
            Model::Plus3 => snapshot::Model::Plus3,
            Model::Pentagon => snapshot::Model::Pentagon128,
        }
    }

    pub fn from_snapshot(m: snapshot::Model) -> Model {
        match m {
            snapshot::Model::Spectrum16 => Model::Spectrum16,
            snapshot::Model::Spectrum48 => Model::Spectrum48,
            snapshot::Model::Spectrum128 => Model::Spectrum128,
            snapshot::Model::Plus2 => Model::Plus2,
            snapshot::Model::Plus2A => Model::Plus2A,
            snapshot::Model::Plus3 => Model::Plus3,
            snapshot::Model::Pentagon128 => Model::Pentagon,
        }
    }

    /// The model's ROMs, 16K each, in the order paging selects them.
    pub fn roms(self) -> &'static [&'static [u8; 0x4000]] {
        static R48: [&[u8; 0x4000]; 1] = [ROM_48];
        static R128: [&[u8; 0x4000]; 2] = [ROM_128_0, ROM_128_1];
        static RP2: [&[u8; 0x4000]; 2] = [ROM_PLUS2_0, ROM_PLUS2_1];
        static RP3: [&[u8; 0x4000]; 4] = [ROM_PLUS3_0, ROM_PLUS3_1, ROM_PLUS3_2, ROM_PLUS3_3];
        match self {
            Model::Spectrum16 | Model::Spectrum48 => &R48,
            Model::Spectrum128 | Model::Pentagon => &R128,
            Model::Plus2 => &RP2,
            Model::Plus2A | Model::Plus3 => &RP3,
        }
    }

    /// The ROM that holds 48 BASIC (and the tape routines at 0556h): ROM 0 on the 16K/48K, 1 on the 128K, +2
    /// and Pentagon, 3 on the +2A/+3.
    pub fn basic48_rom(self) -> usize {
        match self {
            Model::Spectrum16 | Model::Spectrum48 => 0,
            Model::Plus2A | Model::Plus3 => 3,
            _ => 1,
        }
    }
}

pub static ROM_48: &[u8; 0x4000] = include_bytes!("../../../roms/48.rom");
pub static ROM_128_0: &[u8; 0x4000] = include_bytes!("../../../roms/128-0.rom");
pub static ROM_128_1: &[u8; 0x4000] = include_bytes!("../../../roms/128-1.rom");
pub static ROM_PLUS2_0: &[u8; 0x4000] = include_bytes!("../../../roms/plus2-0.rom");
pub static ROM_PLUS2_1: &[u8; 0x4000] = include_bytes!("../../../roms/plus2-1.rom");
pub static ROM_PLUS3_0: &[u8; 0x4000] = include_bytes!("../../../roms/plus3-0.rom");
pub static ROM_PLUS3_1: &[u8; 0x4000] = include_bytes!("../../../roms/plus3-1.rom");
pub static ROM_PLUS3_2: &[u8; 0x4000] = include_bytes!("../../../roms/plus3-2.rom");
pub static ROM_PLUS3_3: &[u8; 0x4000] = include_bytes!("../../../roms/plus3-3.rom");

/// How the ULA (or the gate array) holds the CPU off memory while it fetches the screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContentionKind {
    /// None: the Pentagon.
    None,
    /// The Ferranti ULAs of the 16K/48K and 128K/+2: 6,5,4,3,2,1,0,0 from the first contended T-state of each
    /// screen line, on memory cycles, on the T-states the CPU leaves an address on the bus with neither MREQ
    /// nor IORQ, and on I/O by the port's address.
    Ula,
    /// Amstrad's gate array (+2A/+3): 1,0,7,6,5,4,3,2, on MREQ cycles only; no I/O contention.
    GateArray,
}

/// How a read of a port nothing answers is answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FloatingBus {
    /// The byte the ULA is fetching at that T-state, or FFh when it fetches nothing (16K, 48K, 128K, +2).
    Ula,
    /// The +2A/+3: on ports 0000xxxx xxxxxx0x while paging is not locked, the last byte that went over the
    /// gate array's bus (a screen fetch, or the CPU's read or write of contended memory) with bit 0 set;
    /// elsewhere FFh.
    Plus3,
    /// FFh (the Pentagon).
    None,
}

/// A model's timings, as figures.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TimingBase {
    pub clock_hz: u32,
    /// T-states a line, and lines a frame.
    pub line: u32,
    pub lines: u32,
    /// How long INT is held from the frame's start, in T-states.
    pub int_len: u32,
    /// The T-state at which the first pixel of the paper (its top-left corner) is drawn, early timings.
    pub paper: u32,
    /// The first contended T-state (early timings), and the pattern from it.
    pub contention_start: u32,
    pub contention: ContentionKind,
    pub floating: FloatingBus,
    /// T-states between the drawing of a paper column's first pixel and the ULA's fetch of its bitmap byte
    /// (for an even column; the odd one's is fetched two T-states after the even one's).
    pub fetch_offset: u32,
    /// The border's granularity in T-states: 4 (8 pixels) on Sinclair's ULAs and Amstrad's gate array, 1 (2
    /// pixels) on the Pentagon.
    pub border_step: u32,
    /// How late in its group a border write still lands in it: a write at T-state `w` shows from the group
    /// drawn from `g` when `w <= g + border_latch`.
    pub border_latch: u32,
    /// Whether the ULA's refresh can disturb its screen fetches ("snow", when I points at contended memory).
    pub snow: bool,
}

pub(crate) fn timing_base(model: Model) -> TimingBase {
    match model {
        // WoS FAQ 48K reference: 224 T a line, 312 lines; the paper at 14336; contention 6,5,4,3,2,1,0,0 from
        // 14335; libspectrum: INT 32 T.
        Model::Spectrum16 | Model::Spectrum48 => TimingBase {
            clock_hz: 3_500_000,
            line: 224,
            lines: 312,
            int_len: 32,
            paper: 14336,
            contention_start: 14335,
            contention: ContentionKind::Ula,
            floating: FloatingBus::Ula,
            fetch_offset: 2,
            border_step: 4,
            // The FAQ: an OUT ending at 14339-14342 (its write at 14336-14339) recolours the border from the
            // paper's corner (14336). Woodmass's IR contention test agrees to the pixel; 2 does not.
            border_latch: 3,
            snow: true,
        },
        // WoS FAQ 128K reference: 3.5469 MHz, 228 T a line, 311 lines, the pattern from 14361, the border at
        // the paper's corner for an OUT ending at 14365-14368 (so the paper at 14362); INT 36 T (libspectrum,
        // MiSTer's ULA).
        Model::Spectrum128 | Model::Plus2 => TimingBase {
            clock_hz: 3_546_900,
            line: 228,
            lines: 311,
            int_len: 36,
            paper: 14362,
            contention_start: 14361,
            contention: ContentionKind::Ula,
            floating: FloatingBus::Ula,
            fetch_offset: 2,
            border_step: 4,
            // One earlier than the 48K's: azesmbog's ULA 128 timing test, whose capture the redcode wiki checked
            // against a +2, differs from 3 in one group and matches 2 to the pixel.
            border_latch: 2,
            snow: true,
        },
        // The pattern 1,0,7,6,5,4,3,2 (WoS FAQ 128K reference, +2A/+3) from 14361, not the FAQ's 14365: Patrik
        // Rak's timing test on a +3 (the redcode wiki's capture, checked against hardware) and Fuse put it
        // there. libspectrum: the paper at 14365, INT 32 T; Hikaru: the gate array fetches the first bitmap
        // byte at 14367.
        Model::Plus2A | Model::Plus3 => TimingBase {
            clock_hz: 3_546_900,
            line: 228,
            lines: 311,
            int_len: 32,
            paper: 14365,
            contention_start: 14361,
            contention: ContentionKind::GateArray,
            floating: FloatingBus::Plus3,
            fetch_offset: 2,
            border_step: 4,
            // As the 128's (azesmbog's ULA 128E test matches 2 and 3 alike; the FAQ puts the +3's top-left
            // pixel at 14364, a T-state before libspectrum's 14365, which is the same picture).
            border_latch: 2,
            snow: false,
        },
        // libspectrum: 224 T a line, 320 lines, the paper at 17988, INT 36 T; no contention; the border at
        // every T-state (MiSTer's and the Next's ULAs).
        Model::Pentagon => TimingBase {
            clock_hz: 3_500_000,
            line: 224,
            lines: 320,
            int_len: 36,
            paper: 17988,
            contention_start: 0,
            contention: ContentionKind::None,
            floating: FloatingBus::None,
            fetch_offset: 2,
            border_step: 1,
            border_latch: 3,
            snow: false,
        },
    }
}

/// The timings of a machine as it runs: the figures, with late timings applied, and the contention tables.
#[derive(Clone, Debug)]
pub(crate) struct Timing {
    pub base: TimingBase,
    pub frame: u32,
    /// The T-state of the frame's top-left pixel: 48 lines and 24 T-states before the paper's.
    pub first_pixel: u32,
    /// The ULA's fetch of the first bitmap byte of the paper.
    pub fetch: u32,
    /// The delay a contended memory access starting at each T-state is held for (frame + a margin, the margin
    /// all zeros: an instruction running over the frame's end runs in the next frame's top border).
    pub delay: Vec<u8>,
    /// Whether the T-states with no MREQ (the CPU's internal T-states, with an address on the bus) and I/O are
    /// contended as memory is (the Ferranti ULAs; not the gate array).
    pub contend_no_mreq: bool,
}

/// How far past the frame's end the tables reach: more than any instruction can run over it.
pub(crate) const TABLE_MARGIN: usize = 512;

impl Timing {
    pub fn new(model: Model, late: bool) -> Timing {
        let base = timing_base(model);
        let late = (late && model.has_late_timings()) as u32;
        let frame = base.line * base.lines;
        let paper = base.paper + late;
        let mut delay = vec![0u8; frame as usize + TABLE_MARGIN];
        let pattern: [u8; 8] = match base.contention {
            ContentionKind::None => [0; 8],
            ContentionKind::Ula => [6, 5, 4, 3, 2, 1, 0, 0],
            ContentionKind::GateArray => [1, 0, 7, 6, 5, 4, 3, 2],
        };
        if base.contention != ContentionKind::None {
            let start = base.contention_start + late;
            // The gate array holds the CPU one T-state more a line: its pattern's next 1 (Rak's timing test on a
            // +3: a NOP at 14489 takes 5 T-states; the FAQ's 14365 to "cycle 14494" is 129 too).
            let span = if base.contention == ContentionKind::GateArray {
                129
            } else {
                128
            };
            // Filled from an iterator over the pattern, not by indexing it with `(i % 8) as usize` from a u32
            // count: rustc 1.98.1's optimiser has been seen to compile that indexing (in this function, after an
            // unrelated change to `timing_base`) into reads of 16 bytes from the 8-byte pattern, putting stack
            // garbage into every other 8 T-states of the table, in release builds only. The corpus's
            // `contention tables` part checks the tables a release build makes.
            for line in 0..192 {
                let from = (start + line * base.line) as usize;
                for (d, &p) in delay[from..from + span as usize]
                    .iter_mut()
                    .zip(pattern.iter().cycle())
                {
                    *d = p;
                }
            }
        }
        Timing {
            base,
            frame,
            first_pixel: paper - 48 * base.line - 24,
            fetch: paper + base.fetch_offset,
            delay,
            contend_no_mreq: base.contention == ContentionKind::Ula,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_the_architectures() {
        assert_eq!(Model::Spectrum48.frame_tstates(), 69_888);
        assert_eq!(Model::Spectrum128.frame_tstates(), 70_908);
        assert_eq!(Model::Plus3.frame_tstates(), 70_908);
        assert_eq!(Model::Pentagon.frame_tstates(), 71_680);
        for m in Model::ALL {
            assert_eq!(Model::from_id(m.id()), Some(m));
        }
    }

    #[test]
    fn the_48ks_contention_is_the_faqs() {
        let t = Timing::new(Model::Spectrum48, false);
        let d = |x: usize| t.delay[x];
        assert_eq!(d(14334), 0);
        assert_eq!(
            (14335..14343).map(d).collect::<Vec<_>>(),
            [6, 5, 4, 3, 2, 1, 0, 0]
        );
        assert_eq!(d(14462), 0); // 14335 + 127: the last of the line's pattern is a 0
        assert_eq!(d(14460), 1);
        assert_eq!(d(14463), 0);
        assert_eq!(d(14335 + 224), 6);
        assert_eq!(d(14335 + 191 * 224), 6);
        assert_eq!(d(14335 + 192 * 224), 0);
        let late = Timing::new(Model::Spectrum48, true);
        assert_eq!(late.delay[14335], 0);
        assert_eq!(late.delay[14336], 6);
    }

    #[test]
    fn the_plus3s_contention_is_rak_and_fuses() {
        let t = Timing::new(Model::Plus3, false);
        assert_eq!(
            (14361..14372).map(|x| t.delay[x]).collect::<Vec<_>>(),
            [1, 0, 7, 6, 5, 4, 3, 2, 1, 0, 7]
        );
        assert_eq!(t.delay[14360], 0);
        assert_eq!(t.delay[14361 + 127], 2);
        assert_eq!(t.delay[14361 + 128], 1);
        assert_eq!(t.delay[14361 + 129], 0);
        assert!(!t.contend_no_mreq);
        let p = Timing::new(Model::Pentagon, false);
        assert!(p.delay.iter().all(|&d| d == 0));
    }
}
