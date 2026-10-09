//! The screen read as text: each 8 × 8 cell of the picture's paper matched against the 48K ROM's font, with ink
//! or paper either way round (programs print in INVERSE, and the 128's menu bar is inverse), as tests and
//! agents read what a program shows.

use crate::machine::Machine;
use crate::model::ROM_48;
use crate::video::{FRAME_WIDTH, PAPER_X, PAPER_Y};

/// What a cell no character of the font matches reads as.
pub const UNKNOWN: char = '\u{2592}';

/// The screen as text: 24 rows of 32 characters, and which cells matched in inverse (paper on ink).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenText {
    pub rows: Vec<String>,
    pub inverse: Vec<Vec<bool>>,
}

impl ScreenText {
    /// The rows joined by newlines.
    pub fn text(&self) -> String {
        self.rows.join("\n")
    }

    /// Whether any row contains `needle`.
    pub fn contains(&self, needle: &str) -> bool {
        self.rows.iter().any(|r| r.contains(needle))
    }

    /// Each row with an `i` under each inverse cell and a space under the rest.
    pub fn inverse_rows(&self) -> Vec<String> {
        self.inverse
            .iter()
            .map(|r| r.iter().map(|&i| if i { 'i' } else { ' ' }).collect())
            .collect()
    }
}

/// The Spectrum's character for font code `code` (32–127): ASCII but for 5Eh (↑), 60h (£) and 7Fh (©).
pub fn spectrum_char(code: u8) -> char {
    match code {
        0x5E => '↑',
        0x60 => '£',
        0x7F => '©',
        c => c as char,
    }
}

/// The font: the 48K ROM's characters 32–127 at 3D00h, eight bytes each.
fn font() -> &'static [u8] {
    &ROM_48[0x3D00..0x4000]
}

/// The font's 96 patterns as 64-bit words, sorted, with their characters.
fn font_index() -> &'static [(u64, char)] {
    static INDEX: std::sync::OnceLock<Vec<(u64, char)>> = std::sync::OnceLock::new();
    INDEX.get_or_init(|| {
        let mut v: Vec<(u64, char)> = font()
            .chunks(8)
            .enumerate()
            .map(|(i, g)| {
                (
                    u64::from_be_bytes(g.try_into().unwrap()),
                    spectrum_char(32 + i as u8),
                )
            })
            .collect();
        // The first of two equal patterns wins (the font has none, but a space and a blank are one).
        v.sort_by_key(|&(p, _)| p);
        v.dedup_by_key(|&mut (p, _)| p);
        v
    })
}

fn match_font(pattern: &[u8; 8]) -> Option<char> {
    let key = u64::from_be_bytes(*pattern);
    let index = font_index();
    index
        .binary_search_by_key(&key, |&(p, _)| p)
        .ok()
        .map(|i| index[i].1)
}

/// Reads the paper of a frame (352 × 296 colours) as text. `ink` gives each cell's ink colour (from the
/// attributes), to tell normal from inverse where a cell could be read both ways.
pub fn read_frame(frame: &[u8], ink: impl Fn(usize, usize) -> u8) -> ScreenText {
    let mut rows = Vec::with_capacity(24);
    let mut inverse = Vec::with_capacity(24);
    for cy in 0..24 {
        let mut row = String::with_capacity(32);
        let mut inv = Vec::with_capacity(32);
        for cx in 0..32 {
            // The cell's eight rows of eight pixels, a word each.
            let mut words = [0u64; 8];
            for (y, w) in words.iter_mut().enumerate() {
                let at = (PAPER_Y + cy * 8 + y) * FRAME_WIDTH + PAPER_X + cx * 8;
                *w = u64::from_ne_bytes(frame[at..at + 8].try_into().unwrap());
            }
            let c0 = (words[0] & 0xFF) as u8;
            let splat = |c: u8| u64::from_ne_bytes([c; 8]);
            // A byte of each word FFh where the pixel is c0.
            let eq = |w: u64, c: u8| -> u64 {
                let x = w ^ splat(c);
                // Each zero byte of x becomes 80h, then FFh.
                let z = !(((x & 0x7F7F_7F7F_7F7F_7F7F) + 0x7F7F_7F7F_7F7F_7F7F)
                    | x
                    | 0x7F7F_7F7F_7F7F_7F7F);
                (z >> 7) * 0xFF
            };
            let is0: [u64; 8] = words.map(|w| eq(w, c0));
            if is0.iter().all(|&m| m == u64::MAX) {
                row.push(' ');
                inv.push(false);
                continue;
            }
            // The other colour: the first pixel that is not c0.
            let (y1, m1) = is0
                .iter()
                .enumerate()
                .find(|(_, m)| **m != u64::MAX)
                .unwrap();
            let byte = (!m1).trailing_zeros() as usize / 8;
            let c1 = words[y1].to_ne_bytes()[byte];
            let two = words
                .iter()
                .zip(&is0)
                .all(|(&w, &m0)| (m0 | eq(w, c1)) == u64::MAX);
            if !two {
                row.push(UNKNOWN);
                inv.push(false);
                continue;
            }
            // The colour taken for ink: the attribute's, if the cell shows it, else the first seen.
            let i = ink(cx, cy);
            let set_is_c0 = c0 == i || c1 != i;
            let mut pattern = [0u8; 8];
            for (y, p) in pattern.iter_mut().enumerate() {
                let m = if set_is_c0 { is0[y] } else { !is0[y] };
                // The mask's bytes are pixels left to right in memory order: bit 7 is the leftmost.
                let bytes = m.to_ne_bytes();
                let mut v = 0u8;
                for (x, &b) in bytes.iter().enumerate() {
                    if b != 0 {
                        v |= 0x80 >> x;
                    }
                }
                *p = v;
            }
            if let Some(ch) = match_font(&pattern) {
                row.push(ch);
                inv.push(false);
            } else if let Some(ch) = match_font(&pattern.map(|b| !b)) {
                row.push(ch);
                inv.push(true);
            } else {
                row.push(UNKNOWN);
                inv.push(false);
            }
        }
        rows.push(row);
        inverse.push(inv);
    }
    ScreenText { rows, inverse }
}

impl Machine {
    /// The screen read as text, from the last frame's picture.
    pub fn screen_text(&self) -> ScreenText {
        let screen = self.hw.mem.screen();
        read_frame(self.frame(), |cx, cy| {
            let a = screen[0x1800 + cy * 32 + cx];
            (a & 7) | ((a >> 3) & 8)
        })
    }
}
