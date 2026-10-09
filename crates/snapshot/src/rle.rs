//! The .z80 format's compression, as Gerton Lunter's documentation of it has it (the .z80 page on World of
//! Spectrum): a run of five or more equal bytes becomes ED ED nn bb, "byte bb repeated nn times"; a run of EDs
//! is so coded from two, so that a literal ED ED never appears; and the byte after a single ED is never the start
//! of a run, so that ED is never followed by a code (ED 00 00 00 00 00 00 is ED 00 ED ED 05 00, not ED ED ED 06 00).
//! Runs are at most 255 long. Version 1 files end the 48K block with the marker 00 ED ED 00; versions 2 and 3
//! give each 16K page's compressed length instead.

use crate::Error;

/// The longest run a code can give.
const MAX_RUN: usize = 255;

/// `src`, compressed.
pub fn compress(src: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(src.len() / 2);
    let mut i = 0;
    while i < src.len() {
        let b = src[i];
        let mut run = 1;
        while i + run < src.len() && src[i + run] == b && run < MAX_RUN {
            run += 1;
        }
        if run >= 5 || (b == 0xED && run >= 2) {
            out.extend_from_slice(&[0xED, 0xED, run as u8, b]);
            i += run;
        } else if b == 0xED {
            // A single ED: it, and the byte after it, as they are.
            out.push(0xED);
            i += 1;
            if i < src.len() {
                out.push(src[i]);
                i += 1;
            }
        } else {
            out.extend(std::iter::repeat_n(b, run));
            i += run;
        }
    }
    out
}

/// `src`, all of it, decompressed (a version 2 or 3 page, or a level's data).
pub fn decompress(src: &[u8]) -> Result<Vec<u8>, Error> {
    let mut out = Vec::with_capacity(0x4000);
    let mut i = 0;
    while i < src.len() {
        i = step(src, i, &mut out)?;
    }
    Ok(out)
}

/// A version 1 file's 48K: decompressed from `src` until there are 49,152 bytes, and how many bytes of `src`
/// that took, including the end marker 00 ED ED 00 when it follows (it does in every version 1 file the archive
/// has, but its absence takes nothing away).
pub fn decompress_48k(src: &[u8]) -> Result<(Vec<u8>, usize), Error> {
    const LEN: usize = 0xC000;
    let mut out = Vec::with_capacity(LEN);
    let mut i = 0;
    while out.len() < LEN {
        if i >= src.len() {
            return Err(Error::Truncated(format!("the 48K block decompresses to {} bytes, not 49,152", out.len())));
        }
        i = step(src, i, &mut out)?;
    }
    if out.len() > LEN {
        return Err(Error::Corrupt("a run in the 48K block goes past its end".into()));
    }
    if src[i..].starts_with(&[0x00, 0xED, 0xED, 0x00]) {
        i += 4;
    }
    Ok((out, i))
}

/// Decompresses the code at `src[i]` onto `out`, returning where the next one starts.
fn step(src: &[u8], i: usize, out: &mut Vec<u8>) -> Result<usize, Error> {
    if src[i] == 0xED && src.get(i + 1) == Some(&0xED) {
        let (Some(&n), Some(&b)) = (src.get(i + 2), src.get(i + 3)) else {
            return Err(Error::Truncated("the data ends in the middle of a run's code (ED ED nn bb)".into()));
        };
        out.extend(std::iter::repeat_n(b, n as usize));
        Ok(i + 4)
    } else {
        out.push(src[i]);
        Ok(i + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rt(src: &[u8]) -> Vec<u8> {
        let c = compress(src);
        assert_eq!(decompress(&c).unwrap(), src, "round trip of {src:02x?} through {c:02x?}");
        c
    }

    #[test]
    fn the_documented_cases() {
        // Five or more equal bytes are coded; four are not.
        assert_eq!(rt(&[7; 5]), [0xED, 0xED, 5, 7]);
        assert_eq!(rt(&[7; 4]), [7; 4]);
        // Even two EDs are coded, as ED ED 02 ED.
        assert_eq!(rt(&[0xED, 0xED]), [0xED, 0xED, 2, 0xED]);
        assert_eq!(rt(&[1, 0xED, 0xED, 2]), [1, 0xED, 0xED, 2, 0xED, 2]);
        // A single ED, and the byte after it, are left alone: ED 6×00 is ED 00 ED ED 05 00.
        assert_eq!(rt(&[0xED, 0, 0, 0, 0, 0, 0]), [0xED, 0, 0xED, 0xED, 5, 0]);
        // A single ED at the very end.
        assert_eq!(rt(&[1, 2, 0xED]), [1, 2, 0xED]);
        assert_eq!(rt(&[0xED]), [0xED]);
        assert_eq!(rt(&[]), []);
    }

    #[test]
    fn runs_over_255() {
        // 300 zeros: a run of 255, and the 45 left.
        assert_eq!(rt(&[0; 300]), [0xED, 0xED, 255, 0, 0xED, 0xED, 45, 0]);
        // 256 zeros: 255 and one left over, as it is.
        assert_eq!(rt(&[0; 256]), [0xED, 0xED, 255, 0, 0]);
        // 259: the four left over are not a run.
        assert_eq!(rt(&[0; 259]), [0xED, 0xED, 255, 0, 0, 0, 0, 0]);
        // 256 EDs and then zeros: the one ED left over is single, so the zero after it is left alone too.
        let mut src = vec![0xED; 256];
        src.extend_from_slice(&[0; 6]);
        assert_eq!(rt(&src), [0xED, 0xED, 255, 0xED, 0xED, 0, 0xED, 0xED, 5, 0]);
        // 257 EDs: 255 and a run of two.
        assert_eq!(rt(&[0xED; 257]), [0xED, 0xED, 255, 0xED, 0xED, 0xED, 2, 0xED]);
        // A whole page of one byte.
        let c = rt(&[0xAA; 0x4000]);
        assert_eq!(c.len(), 4 * (0x4000 / 255 + 1));
    }

    #[test]
    fn every_short_pattern_round_trips() {
        // All sequences of up to seven bytes drawn from {00, ED, 01}: every way ED can sit beside a run.
        let alphabet = [0x00u8, 0xED, 0x01];
        for len in 0..=7 {
            for mut n in 0..3usize.pow(len) {
                let mut src = Vec::new();
                for _ in 0..len {
                    src.push(alphabet[n % 3]);
                    n /= 3;
                }
                let c = compress(&src);
                assert_eq!(decompress(&c).unwrap(), src);
                // The compressed form never has ED ED except as a code, and never a code right after a single ED.
                let mut i = 0;
                while i < c.len() {
                    if c[i] == 0xED && c.get(i + 1) == Some(&0xED) {
                        assert!(c[i + 2] >= 2);
                        i += 4;
                    } else if c[i] == 0xED {
                        assert_ne!(c.get(i + 1), Some(&0xED));
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
            }
        }
    }

    #[test]
    fn version_1_end_marker() {
        let mut ram = vec![0u8; 0xC000];
        ram[100] = 0xED;
        ram[0xBFFF] = 0xED; // The last byte a single ED: the marker's 00 follows it.
        let mut c = compress(&ram);
        let len = c.len();
        c.extend_from_slice(&[0x00, 0xED, 0xED, 0x00]);
        assert_eq!(decompress_48k(&c).unwrap(), (ram.clone(), len + 4));
        // Without the marker, and with something after it.
        assert_eq!(decompress_48k(&c[..len]).unwrap(), (ram.clone(), len));
        c.extend_from_slice(b"trailing");
        assert_eq!(decompress_48k(&c).unwrap().1, len + 4);
        // Too short, and a run that overshoots 48K.
        assert!(matches!(decompress_48k(&c[..len - 4]), Err(Error::Truncated(_))));
        let mut over = compress(&ram[..0xBFFE]);
        over.extend_from_slice(&[0xED, 0xED, 5, 0]);
        assert!(matches!(decompress_48k(&over), Err(Error::Corrupt(_))));
    }

    #[test]
    fn a_code_cut_short_fails() {
        assert!(decompress(&[1, 0xED, 0xED]).is_err());
        assert!(decompress(&[1, 0xED, 0xED, 5]).is_err());
        assert_eq!(decompress(&[1, 0xED, 0xED, 0, 9]).unwrap(), [1]);
    }
}
