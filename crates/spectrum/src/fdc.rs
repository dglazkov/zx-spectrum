//! The +3's disk controller (a NEC µPD765A) with no drive attached: enough of it that the ROM finds the
//! controller (its main status register reads 80h, not FFh: +3DOS's check at 1F28h of ROM 2 takes FFh for no
//! controller, a +2A, and titles the menu "128 +2A"), and that every command it is given comes back as the
//! chip answers when no drive is ready: reads, writes and READ ID end abnormally with Not Ready, SEEK and
//! RECALIBRATE raise an interrupt that SENSE INTERRUPT STATUS reports with Seek End and Not Ready, SENSE DRIVE
//! STATUS says the drive is not ready. So the ROM boots as a +3 and its Loader, finding no disk, loads from
//! tape. Commands and their phases from NEC's µPD765A/µPD7265 data sheet; no timing is modelled (each command
//! completes at once).

/// Main status register bits.
const RQM: u8 = 0x80;
const DIO: u8 = 0x40;
const CB: u8 = 0x10;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Fdc {
    /// The command bytes received so far.
    command: Vec<u8>,
    /// The result bytes still to be read.
    result: Vec<u8>,
    /// An interrupt from SEEK or RECALIBRATE waiting for SENSE INTERRUPT STATUS: ST0 and the present
    /// cylinder.
    interrupt: Option<(u8, u8)>,
}

/// How many bytes a command has (with its first), by its low five bits.
fn command_length(op: u8) -> usize {
    match op & 0x1F {
        0x02 | 0x05 | 0x06 | 0x09 | 0x0C | 0x11 | 0x19 | 0x1D => 9,
        0x03 => 3,
        0x04 | 0x07 | 0x0A => 2,
        0x08 => 1,
        0x0D => 6,
        0x0F => 3,
        _ => 1,
    }
}

impl Fdc {
    /// The controller's state as bytes (for a saved state): the command so far, the results to read, the
    /// pending interrupt.
    pub fn save(&self) -> Vec<u8> {
        let mut v = vec![self.command.len() as u8];
        v.extend_from_slice(&self.command);
        v.push(self.result.len() as u8);
        v.extend_from_slice(&self.result);
        match self.interrupt {
            Some((a, b)) => v.extend_from_slice(&[1, a, b]),
            None => v.extend_from_slice(&[0, 0, 0]),
        }
        v
    }

    /// Back from `save`'s bytes; None if they are not such.
    pub fn restore(b: &[u8]) -> Option<Fdc> {
        let n = *b.first()? as usize;
        let command = b.get(1..1 + n)?.to_vec();
        let m = *b.get(1 + n)? as usize;
        let result = b.get(2 + n..2 + n + m)?.to_vec();
        let i = b.get(2 + n + m..5 + n + m)?;
        if command.len() > 9 || result.len() > 7 {
            return None;
        }
        Some(Fdc {
            command,
            result,
            interrupt: (i[0] != 0).then_some((i[1], i[2])),
        })
    }

    /// Port 2FFDh: the main status register.
    pub fn status(&self) -> u8 {
        if self.result.is_empty() {
            RQM
        } else {
            RQM | DIO | CB
        }
    }

    /// Port 3FFDh read: the next result byte (FFh when there is none).
    pub fn read_data(&mut self) -> u8 {
        if self.result.is_empty() {
            0xFF
        } else {
            self.result.remove(0)
        }
    }

    /// Port 3FFDh write: the next command byte.
    pub fn write_data(&mut self, v: u8) {
        if !self.result.is_empty() {
            return;
        }
        self.command.push(v);
        if self.command.len() < command_length(self.command[0]) {
            return;
        }
        let c = std::mem::take(&mut self.command);
        let op = c[0] & 0x1F;
        // The drive and head a command names, in ST0's low bits.
        let us = c.get(1).copied().unwrap_or(0) & 0x07;
        // Abnormal termination, not ready.
        let not_ready = 0x48 | us;
        self.result = match op {
            0x03 => Vec::new(),
            0x04 => vec![us],
            0x07 | 0x0F => {
                self.interrupt = Some((0x68 | (us & 3), 0));
                Vec::new()
            }
            0x08 => match self.interrupt.take() {
                Some((st0, pcn)) => vec![st0, pcn],
                None => vec![0x80],
            },
            0x0A => vec![not_ready, 0, 0, 0, 0, 0, 0],
            0x0D => vec![not_ready, 0, 0, 0, 0, 0, c[2]],
            0x02 | 0x05 | 0x06 | 0x09 | 0x0C | 0x11 | 0x19 | 0x1D => {
                vec![not_ready, 0, 0, c[2], c[3], c[4], c[5]]
            }
            _ => vec![0x80],
        };
    }
}
