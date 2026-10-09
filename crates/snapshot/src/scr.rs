//! Screen dumps (.scr): the screen's memory as it is from 4000h, 6,144 bytes of bitmap and 768 of attributes,
//! for the machine to put back there. Two variants are read as well: the bitmap alone (6,144 bytes), given the
//! attributes the ROM clears the screen to (38h: black ink on white paper), and ULAplus's (6,976 bytes), whose 64
//! bytes of palette after the screen are left for a machine without ULAplus. Timex hi-colour and hi-res dumps
//! (12,288 and 12,289 bytes) are of a screen mode the Spectrum does not have.

use crate::{Error, SCREEN_SIZE, Screen};

const BITMAP: usize = 6144;
const ULAPLUS: usize = SCREEN_SIZE + 64;

/// The screen a .scr holds.
pub fn load_scr(d: &[u8]) -> Result<Box<Screen>, Error> {
    let mut screen = Box::new([0x38u8; SCREEN_SIZE]);
    match d.len() {
        SCREEN_SIZE | ULAPLUS => screen.copy_from_slice(&d[..SCREEN_SIZE]),
        BITMAP => screen[..BITMAP].copy_from_slice(d),
        12_288 | 12_289 => return Err(Error::Unsupported("a Timex hi-colour or hi-res screen".into())),
        n => return Err(Error::Corrupt(format!("{n} bytes is not a screen dump (6,912 bytes)"))),
    }
    Ok(screen)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_size() {
        let dump: Vec<u8> = (0..SCREEN_SIZE).map(|i| i as u8).collect();
        assert_eq!(&load_scr(&dump).unwrap()[..], &dump[..]);
        let mut ulaplus = dump.clone();
        ulaplus.extend_from_slice(&[0xFF; 64]);
        assert_eq!(&load_scr(&ulaplus).unwrap()[..], &dump[..]);
        let s = load_scr(&dump[..BITMAP]).unwrap();
        assert_eq!(&s[..BITMAP], &dump[..BITMAP]);
        assert!(s[BITMAP..].iter().all(|&a| a == 0x38));
        assert!(matches!(load_scr(&[0; 12_288]), Err(Error::Unsupported(_))));
        assert!(matches!(load_scr(&dump[..6911]), Err(Error::Corrupt(_))));
        assert!(load_scr(&[]).is_err());
    }
}
