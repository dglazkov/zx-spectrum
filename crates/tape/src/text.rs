//! Text as the formats and the Spectrum store it.

/// TZX's texts are ISO 8859-1, whose code points are Unicode's first 256; lines are separated by CR.
pub(crate) fn latin1(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| if b == 13 { '\n' } else { b as char })
        .collect()
}

/// The BASIC keywords, from token 0xA5 (RND) to 0xFF (COPY).
const TOKENS: [&str; 91] = [
    "RND",
    "INKEY$",
    "PI",
    "FN",
    "POINT",
    "SCREEN$",
    "ATTR",
    "AT",
    "TAB",
    "VAL$",
    "CODE",
    "VAL",
    "LEN",
    "SIN",
    "COS",
    "TAN",
    "ASN",
    "ACS",
    "ATN",
    "LN",
    "EXP",
    "INT",
    "SQR",
    "SGN",
    "ABS",
    "PEEK",
    "IN",
    "USR",
    "STR$",
    "CHR$",
    "NOT",
    "BIN",
    "OR",
    "AND",
    "<=",
    ">=",
    "<>",
    "LINE",
    "THEN",
    "TO",
    "STEP",
    "DEF FN",
    "CAT",
    "FORMAT",
    "MOVE",
    "ERASE",
    "OPEN #",
    "CLOSE #",
    "MERGE",
    "VERIFY",
    "BEEP",
    "CIRCLE",
    "INK",
    "PAPER",
    "FLASH",
    "BRIGHT",
    "INVERSE",
    "OVER",
    "OUT",
    "LPRINT",
    "LLIST",
    "STOP",
    "READ",
    "DATA",
    "RESTORE",
    "NEW",
    "BORDER",
    "CONTINUE",
    "DIM",
    "REM",
    "FOR",
    "GO TO",
    "GO SUB",
    "INPUT",
    "LOAD",
    "LIST",
    "LET",
    "PAUSE",
    "NEXT",
    "POKE",
    "PRINT",
    "PLOT",
    "RUN",
    "SAVE",
    "RANDOMIZE",
    "IF",
    "CLS",
    "DRAW",
    "CLEAR",
    "RETURN",
    "COPY",
];

/// The block graphics 0x80 to 0x8F: bit 0 the top right quarter, bit 1 the top left, bit 2 the bottom right,
/// bit 3 the bottom left.
const GRAPHICS: [char; 16] = [
    ' ', '▝', '▘', '▀', '▗', '▐', '▚', '▜', '▖', '▞', '▌', '▛', '▄', '▟', '▙', '█',
];

/// A name in the Spectrum's character set (a tape header's ten characters) as the screen shows it: the
/// characters it shares with ASCII, but for ↑, £ and ©; the block graphics; the user-defined graphics as the
/// letters they start out as; the keywords' tokens spelled out. Control codes are left out with their
/// parameters (the colour codes take one, AT and TAB two), which is how a name such as Saboteur's
/// `INK 2; "SABOTEUR"` comes out as SABOTEUR. Trailing spaces, which pad every name, are dropped.
pub fn spectrum(bytes: &[u8]) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        i += 1;
        match b {
            0x10..=0x15 => i += 1,
            0x16 | 0x17 => i += 2,
            0x00..=0x1F => {}
            0x5E => out.push('↑'),
            0x60 => out.push('£'),
            0x7F => out.push('©'),
            0x20..=0x7E => out.push(b as char),
            0x80..=0x8F => out.push(GRAPHICS[(b - 0x80) as usize]),
            0x90..=0xA4 => out.push((b'A' + (b - 0x90)) as char),
            0xA5..=0xFF => out.push_str(TOKENS[(b - 0xA5) as usize]),
        }
    }
    out.trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_come_out_as_the_screen_shows_them() {
        assert_eq!(spectrum(b"\x10\x02SABOTEUR"), "SABOTEUR");
        assert_eq!(spectrum(b"\x16\x00\x00       "), "");
        assert_eq!(spectrum(b"Sabot1.1  "), "Sabot1.1");
        assert_eq!(spectrum(&[0x60, b'1', 0x7F, 0x5E]), "£1©↑");
        assert_eq!(spectrum(&[0x83, 0x8F, 0x90, 0xAF, 0xFF]), "▀█ACODECOPY");
        assert_eq!(TOKENS[0xAF - 0xA5], "CODE");
        assert_eq!(TOKENS[0xEF - 0xA5], "LOAD");
    }

    #[test]
    fn latin1_keeps_its_code_points() {
        assert_eq!(latin1(b"caf\xe9\rok"), "café\nok");
    }
}
