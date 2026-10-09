//! Memory and paging: eight 16K RAM banks, the model's ROMs, and what each quarter of the address space shows.
//!
//! Everything lives in one flat array (RAM banks 0–7, then the ROMs, then a 16K of FFh for the 16K model's
//! missing upper RAM), and each of the four 16K slots of the address space is an offset into it, whether it can
//! be written, whether it is contended, and whether it holds the bank the ULA is showing.

use crate::model::Model;

pub(crate) const BANK: usize = 0x4000;
/// Where the ROMs start in the flat array, and the empty (FFh) area after the four ROM places.
pub(crate) const ROM_BASE: usize = 8 * BANK;
pub(crate) const EMPTY: usize = ROM_BASE + 4 * BANK;
const TOTAL: usize = EMPTY + BANK;

#[derive(Clone, Debug)]
pub(crate) struct Memory {
    pub mem: Vec<u8>,
    /// For each slot: its offset in `mem`, whether writes land, whether the ULA contends it, which RAM bank
    /// it is (None for ROM or nothing).
    pub offset: [usize; 4],
    pub writable: [bool; 4],
    pub contended: [bool; 4],
    pub bank: [Option<u8>; 4],
    /// Which slots hold the bank on screen (writes to its first 6,912 bytes must bring the picture up to date).
    pub screen_slot: [bool; 4],
    /// The bank the ULA shows: 5, or 7 when 7FFDh bit 3 is set.
    pub screen_bank: u8,
    /// The ROM paged at 0000h (when a ROM is), as the model numbers them.
    pub rom: Option<u8>,
    /// The paging ports as last written, and whether 7FFDh bit 5 has locked them.
    pub port_7ffd: u8,
    pub port_1ffd: u8,
    pub locked: bool,
    model: Model,
}

impl Memory {
    /// Memory as at power-on: the ROMs in place and the RAM as `ram_fill` leaves it.
    pub fn new(model: Model) -> Memory {
        let mut mem = vec![0u8; TOTAL];
        for (i, rom) in model.roms().iter().enumerate() {
            mem[ROM_BASE + i * BANK..ROM_BASE + (i + 1) * BANK].copy_from_slice(&rom[..]);
        }
        mem[EMPTY..].fill(0xFF);
        power_on_ram(&mut mem[..ROM_BASE]);
        let mut m = Memory {
            mem,
            offset: [0; 4],
            writable: [false; 4],
            contended: [false; 4],
            bank: [None; 4],
            screen_slot: [false; 4],
            screen_bank: 5,
            rom: Some(0),
            port_7ffd: 0,
            port_1ffd: 0,
            locked: false,
            model,
        };
        m.update();
        m
    }

    /// The paging ports as the RESET line leaves them (the RAM is kept).
    pub fn reset_paging(&mut self) {
        self.port_7ffd = 0;
        self.port_1ffd = 0;
        self.locked = false;
        self.update();
    }

    #[inline(always)]
    pub fn read(&self, addr: u16) -> u8 {
        self.mem[self.offset[(addr >> 14) as usize] + (addr & 0x3FFF) as usize]
    }

    /// Writes a byte as the CPU would: nothing happens to ROM, or to the 16K model's missing RAM.
    #[inline(always)]
    pub fn write(&mut self, addr: u16, value: u8) {
        let s = (addr >> 14) as usize;
        if self.writable[s] {
            self.mem[self.offset[s] + (addr & 0x3FFF) as usize] = value;
        }
    }

    /// A RAM bank's 16K.
    pub fn bank(&self, n: usize) -> &[u8] {
        &self.mem[n * BANK..(n + 1) * BANK]
    }

    pub fn bank_mut(&mut self, n: usize) -> &mut [u8] {
        &mut self.mem[n * BANK..(n + 1) * BANK]
    }

    /// The bank on screen, as the ULA reads it.
    #[inline(always)]
    pub fn screen(&self) -> &[u8] {
        let b = self.screen_bank as usize * BANK;
        &self.mem[b..b + BANK]
    }

    /// Whether the 48 BASIC ROM (where LD-BYTES is) is paged at 0000h.
    pub fn basic48_paged(&self) -> bool {
        self.rom == Some(self.model.basic48_rom() as u8)
    }

    /// A write to port 7FFDh (128K paging): ignored once bit 5 has locked it, until a reset.
    pub fn write_7ffd(&mut self, value: u8) {
        if self.locked {
            return;
        }
        self.port_7ffd = value;
        self.locked = value & 0x20 != 0;
        self.update();
    }

    /// A write to port 1FFDh (the +2A/+3's paging): ignored, as 7FFDh's are, once bit 5 of 7FFDh has locked
    /// the paging (Fuse's `specplus3_memoryport2_write`). Kept but not acted on, it would take effect at the
    /// next `update` (a state loaded, a snapshot restored) and page what the machine never paged.
    pub fn write_1ffd(&mut self, value: u8) {
        if self.locked {
            return;
        }
        self.port_1ffd = value;
        self.update();
    }

    /// Puts each slot where the paging ports say.
    pub fn update(&mut self) {
        let p = self.port_7ffd;
        let ram = |b: u8| Some(b);
        let (slots, rom): ([Option<u8>; 4], Option<u8>) = match self.model {
            Model::Spectrum16 => ([None, ram(5), None, None], Some(0)),
            Model::Spectrum48 => ([None, ram(5), ram(2), ram(0)], Some(0)),
            Model::Spectrum128 | Model::Plus2 | Model::Pentagon => {
                ([None, ram(5), ram(2), ram(p & 7)], Some((p >> 4) & 1))
            }
            Model::Plus2A | Model::Plus3 => {
                let x = self.port_1ffd;
                if x & 1 != 0 {
                    // The special (all-RAM) configurations, by bits 1 and 2 (WoS FAQ, +2A/+3 memory).
                    let banks: [u8; 4] = match (x >> 1) & 3 {
                        0 => [0, 1, 2, 3],
                        1 => [4, 5, 6, 7],
                        2 => [4, 5, 6, 3],
                        _ => [4, 7, 6, 3],
                    };
                    (banks.map(Some), None)
                } else {
                    (
                        [None, ram(5), ram(2), ram(p & 7)],
                        Some(((x >> 1) & 2) | ((p >> 4) & 1)),
                    )
                }
            }
        };
        self.rom = rom;
        self.screen_bank = if self.model.is_128k() && p & 0x08 != 0 {
            7
        } else {
            5
        };
        for (s, slot) in slots.iter().enumerate() {
            match *slot {
                Some(b) => {
                    self.offset[s] = b as usize * BANK;
                    self.writable[s] = true;
                    self.bank[s] = Some(b);
                    self.contended[s] = match self.model {
                        Model::Spectrum16 | Model::Spectrum48 => b == 5,
                        Model::Spectrum128 | Model::Plus2 => b & 1 == 1,
                        Model::Plus2A | Model::Plus3 => b >= 4,
                        Model::Pentagon => false,
                    };
                    self.screen_slot[s] = b == self.screen_bank;
                }
                None => {
                    self.offset[s] = if s == 0 {
                        ROM_BASE + rom.unwrap_or(0) as usize * BANK
                    } else {
                        EMPTY
                    };
                    self.writable[s] = false;
                    self.bank[s] = None;
                    self.contended[s] = false;
                    self.screen_slot[s] = false;
                }
            }
        }
    }
}

/// RAM as the machine leaves it at power-on. DRAM cells come up in no defined state, and a real machine shows
/// noise for the moment before its ROM clears the screen; this fills RAM with a fixed pseudo-random pattern
/// (a 32-bit xorshift from a constant seed), so that power-on is the same every time.
fn power_on_ram(ram: &mut [u8]) {
    let mut x: u32 = 0x2468_ACE1;
    for b in ram.iter_mut() {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        *b = (x >> 24) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paging_follows_the_ports() {
        let mut m = Memory::new(Model::Spectrum128);
        assert_eq!(m.bank, [None, Some(5), Some(2), Some(0)]);
        assert_eq!(m.contended, [false, true, false, false]);
        m.write_7ffd(0x1F); // bank 7, the shadow screen, ROM 1
        assert_eq!(m.bank[3], Some(7));
        assert!(m.contended[3] && m.screen_slot[3] && !m.screen_slot[1]);
        assert_eq!((m.rom, m.screen_bank), (Some(1), 7));
        m.write_7ffd(0x24); // locks
        assert_eq!(m.bank[3], Some(4));
        m.write_7ffd(0x00);
        assert_eq!(m.bank[3], Some(4), "locked until reset");
        m.reset_paging();
        assert_eq!(m.bank[3], Some(0));

        let mut p = Memory::new(Model::Plus3);
        p.write_1ffd(0x04);
        p.write_7ffd(0x10);
        assert_eq!(p.rom, Some(3));
        assert!(p.basic48_paged());
        p.write_1ffd(0x07); // special: 4, 7, 6, 3
        assert_eq!(p.bank, [Some(4), Some(7), Some(6), Some(3)]);
        assert_eq!(p.contended, [true, true, true, false]);
        assert!(p.writable[0]);
    }

    #[test]
    fn the_lock_holds_1ffd_too() {
        // Locked in 48 BASIC (ROM 3), a write to 1FFDh changes nothing, now or when paging is worked out again.
        let mut p = Memory::new(Model::Plus3);
        p.write_1ffd(0x04);
        p.write_7ffd(0x30);
        assert_eq!((p.rom, p.locked), (Some(3), true));
        p.write_1ffd(0x01);
        assert_eq!(p.port_1ffd, 0x04);
        p.update();
        assert_eq!(p.rom, Some(3), "still 48 BASIC, not the all-RAM 0-1-2-3");
        assert_eq!(p.bank[0], None);
    }

    #[test]
    fn the_16k_reads_ffh_above_its_ram() {
        let mut m = Memory::new(Model::Spectrum16);
        m.write(0x9000, 0x12);
        assert_eq!(m.read(0x9000), 0xFF);
        m.write(0x4000, 0x12);
        assert_eq!(m.read(0x4000), 0x12);
        m.write(0x0000, 0x12);
        assert_eq!(m.read(0x0000), 0xF3, "the ROM's DI");
    }
}
