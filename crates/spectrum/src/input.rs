//! The keyboard, the joysticks, and typing.
//!
//! Keys are numbered as the ULA reads them: half-row `r` (0–7, by the address line A8–A15 that selects it)
//! and bit `b` (0–4) make key `r * 5 + b` (docs/architecture.md). Reading port FEh with several address lines
//! low gives the AND of their half-rows (WoS FAQ, port FEh).

/// Key codes by name.
pub mod keys {
    pub const CAPS_SHIFT: u8 = 0;
    pub const Z: u8 = 1;
    pub const X: u8 = 2;
    pub const C: u8 = 3;
    pub const V: u8 = 4;
    pub const A: u8 = 5;
    pub const S: u8 = 6;
    pub const D: u8 = 7;
    pub const F: u8 = 8;
    pub const G: u8 = 9;
    pub const Q: u8 = 10;
    pub const W: u8 = 11;
    pub const E: u8 = 12;
    pub const R: u8 = 13;
    pub const T: u8 = 14;
    pub const K1: u8 = 15;
    pub const K2: u8 = 16;
    pub const K3: u8 = 17;
    pub const K4: u8 = 18;
    pub const K5: u8 = 19;
    pub const K0: u8 = 20;
    pub const K9: u8 = 21;
    pub const K8: u8 = 22;
    pub const K7: u8 = 23;
    pub const K6: u8 = 24;
    pub const P: u8 = 25;
    pub const O: u8 = 26;
    pub const I: u8 = 27;
    pub const U: u8 = 28;
    pub const Y: u8 = 29;
    pub const ENTER: u8 = 30;
    pub const L: u8 = 31;
    pub const K: u8 = 32;
    pub const J: u8 = 33;
    pub const H: u8 = 34;
    pub const SPACE: u8 = 35;
    pub const SYMBOL_SHIFT: u8 = 36;
    pub const M: u8 = 37;
    pub const N: u8 = 38;
    pub const B: u8 = 39;
}

/// The keys of each half-row, from bit 0.
pub const HALF_ROWS: [[&str; 5]; 8] = [
    ["CAPS SHIFT", "Z", "X", "C", "V"],
    ["A", "S", "D", "F", "G"],
    ["Q", "W", "E", "R", "T"],
    ["1", "2", "3", "4", "5"],
    ["0", "9", "8", "7", "6"],
    ["P", "O", "I", "U", "Y"],
    ["ENTER", "L", "K", "J", "H"],
    ["SPACE", "SYMBOL SHIFT", "M", "N", "B"],
];

/// A key's code from its name: `A`, `7`, `ENTER`, `SPACE`, `CAPS SHIFT` (or `CS`, `CAPS`, `SHIFT`),
/// `SYMBOL SHIFT` (or `SS`, `SYM`), case aside.
pub fn key_code(name: &str) -> Option<u8> {
    let n = name.trim().to_ascii_uppercase().replace(['_', '-'], " ");
    let n = match n.as_str() {
        "CS" | "CAPS" | "SHIFT" | "CAPSSHIFT" => "CAPS SHIFT",
        "SS" | "SYM" | "SYMBOL" | "SYMSHIFT" | "SYMBOLSHIFT" | "SYM SHIFT" => "SYMBOL SHIFT",
        "RETURN" | "ENT" => "ENTER",
        "SPC" | " " | "BREAK" => "SPACE",
        other => other,
    };
    for (r, row) in HALF_ROWS.iter().enumerate() {
        for (b, k) in row.iter().enumerate() {
            if *k == n {
                return Some((r * 5 + b) as u8);
            }
        }
    }
    None
}

/// A key's name from its code.
pub fn key_name(code: u8) -> &'static str {
    HALF_ROWS[(code / 5) as usize % 8][(code % 5) as usize]
}

/// Which joystick the machine has (attached to a Kempston interface, or as keys).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Joystick {
    #[default]
    None,
    /// A Kempston interface: port 1Fh (decoded by A5 low) reads 000FUDLR, active high.
    Kempston,
    /// Interface 2's left port, as keys 6 (left), 7 (right), 8 (down), 9 (up), 0 (fire).
    Sinclair1,
    /// Interface 2's right port: 1 (left), 2 (right), 3 (down), 4 (up), 5 (fire).
    Sinclair2,
    /// A cursor (Protek, AGF) joystick: 5 (left), 8 (right), 6 (down), 7 (up), 0 (fire).
    Cursor,
}

impl Joystick {
    pub fn id(self) -> &'static str {
        match self {
            Joystick::None => "none",
            Joystick::Kempston => "kempston",
            Joystick::Sinclair1 => "sinclair1",
            Joystick::Sinclair2 => "sinclair2",
            Joystick::Cursor => "cursor",
        }
    }

    pub fn from_id(s: &str) -> Option<Joystick> {
        Some(match s.trim().to_ascii_lowercase().as_str() {
            "none" | "" => Joystick::None,
            "kempston" => Joystick::Kempston,
            "sinclair1" | "sinclair" | "interface2" | "if2" => Joystick::Sinclair1,
            "sinclair2" => Joystick::Sinclair2,
            "cursor" | "protek" | "agf" => Joystick::Cursor,
            _ => return None,
        })
    }

    /// The keys the joystick's right, left, down, up and fire are, for the kinds that are keys.
    fn keys(self) -> Option<[u8; 5]> {
        use keys::*;
        match self {
            Joystick::Sinclair1 => Some([K7, K6, K8, K9, K0]),
            Joystick::Sinclair2 => Some([K2, K1, K3, K4, K5]),
            Joystick::Cursor => Some([K8, K5, K6, K7, K0]),
            _ => None,
        }
    }
}

/// The joystick's bits, as the Kempston interface reads them.
pub mod joy {
    pub const RIGHT: u8 = 1;
    pub const LEFT: u8 = 2;
    pub const DOWN: u8 = 4;
    pub const UP: u8 = 8;
    pub const FIRE: u8 = 16;
}

/// The keyboard matrix and the joystick, as the ports read them.
#[derive(Clone, Debug)]
pub(crate) struct Input {
    /// Keys held down by the person (or a script), by code.
    keys: [bool; 40],
    /// The matrix's ghosting: with no diodes in it, keys down on two half-rows in one column join the rows,
    /// so three keys at the corners of a rectangle read as the fourth too.
    pub ghosting: bool,
    pub joystick: Joystick,
    pub joy_bits: u8,
    /// Each half-row as port FEh reads it: bits 0–4, 0 where a key is down (keys and key joysticks together).
    rows: [u8; 8],
}

impl Input {
    pub fn new() -> Input {
        Input {
            keys: [false; 40],
            ghosting: true,
            joystick: Joystick::None,
            joy_bits: 0,
            rows: [0x1F; 8],
        }
    }

    pub fn key(&mut self, code: u8, down: bool) {
        if (code as usize) < 40 {
            self.keys[code as usize] = down;
            self.rebuild();
        }
    }

    pub fn is_down(&self, code: u8) -> bool {
        self.keys.get(code as usize).copied().unwrap_or(false)
    }

    pub fn release_all(&mut self) {
        self.keys = [false; 40];
        self.rebuild();
    }

    pub fn set_joystick(&mut self, kind: Joystick, bits: u8) {
        self.joystick = kind;
        self.joy_bits = bits & 0x1F;
        self.rebuild();
    }

    fn rebuild(&mut self) {
        let mut rows = [0x1Fu8; 8];
        let mut press = |code: u8| rows[(code / 5) as usize] &= !(1 << (code % 5));
        for (code, &down) in self.keys.iter().enumerate() {
            if down {
                press(code as u8);
            }
        }
        if let Some(keys) = self.joystick.keys() {
            for (bit, &code) in keys.iter().enumerate() {
                if self.joy_bits & (1 << bit) != 0 {
                    press(code);
                }
            }
        }
        if self.ghosting {
            // Rows that share a column with a key down on both are joined: each reads every key of the others.
            loop {
                let mut changed = false;
                for a in 0..8 {
                    for b in 0..8 {
                        if a != b && (!rows[a] & !rows[b] & 0x1F) != 0 && rows[a] != rows[b] {
                            let joined = rows[a] & rows[b];
                            changed |= rows[a] != joined || rows[b] != joined;
                            rows[a] = joined;
                            rows[b] = joined;
                        }
                    }
                }
                if !changed {
                    break;
                }
            }
        }
        self.rows = rows;
    }

    pub fn set_ghosting(&mut self, on: bool) {
        self.ghosting = on;
        self.rebuild();
    }

    /// Bits 0–4 of port FEh for the high byte of the port's address: the AND of every half-row it selects.
    #[inline]
    pub fn read(&self, high: u8) -> u8 {
        let mut v = 0x1F;
        for (r, &row) in self.rows.iter().enumerate() {
            if high & (1 << r) == 0 {
                v &= row;
            }
        }
        v
    }

    /// What the Kempston interface puts on the bus.
    pub fn kempston(&self) -> u8 {
        self.joy_bits & 0x1F
    }
}

/// The Spectrum keys that type a character, a chord (keys held together) at a time; None for a character the
/// keyboard cannot type. Letters are lower case unshifted, upper case with CAPS SHIFT; the symbols are SYMBOL
/// SHIFT with the key their red legend is on; `~ | \ { } [ ] ©` are extended mode then SYMBOL SHIFT (as the
/// page's `charChords` types them). Newline is ENTER. On a 48K in K mode a letter types its keyword: typing
/// `LOAD ""` there is J, then `""`.
pub fn char_chords(ch: char) -> Option<Vec<Vec<u8>>> {
    use keys::*;
    let letter = |c: char| key_code(&c.to_ascii_uppercase().to_string());
    Some(match ch {
        'a'..='z' => vec![vec![letter(ch)?]],
        'A'..='Z' => vec![vec![CAPS_SHIFT, letter(ch)?]],
        '0'..='9' => vec![vec![key_code(&ch.to_string())?]],
        ' ' => vec![vec![SPACE]],
        '\n' | '\r' => vec![vec![ENTER]],
        _ => {
            let sym = match ch {
                '!' => '1',
                '@' => '2',
                '#' => '3',
                '$' => '4',
                '%' => '5',
                '&' => '6',
                '\'' => '7',
                '(' => '8',
                ')' => '9',
                '_' => '0',
                '<' => 'R',
                '>' => 'T',
                ';' => 'O',
                '"' => 'P',
                '^' => 'H',
                '-' => 'J',
                '+' => 'K',
                '=' => 'L',
                ':' => 'Z',
                '£' => 'X',
                '?' => 'C',
                '/' => 'V',
                '*' => 'B',
                ',' => 'N',
                '.' => 'M',
                _ => '\0',
            };
            if sym != '\0' {
                return Some(vec![vec![SYMBOL_SHIFT, key_code(&sym.to_string())?]]);
            }
            let ext = match ch {
                '~' => 'A',
                '|' => 'S',
                '\\' => 'D',
                '{' => 'F',
                '}' => 'G',
                '[' => 'Y',
                ']' => 'U',
                '©' => 'P',
                _ => return None,
            };
            vec![
                vec![CAPS_SHIFT, SYMBOL_SHIFT],
                vec![SYMBOL_SHIFT, key_code(&ext.to_string())?],
            ]
        }
    })
}

/// Key presses scheduled at frames, paced as the ROM's KEYBOARD routine needs them, as the page's KeyFeeder
/// paces them (web/src/input/feeder.ts): each typed key held 3 frames, 3 frames between keys, and a key not
/// pressed again until the KSTATE set holding it is free (6 frames after it was let go), nor a third while
/// both sets are held. The ROM (02BFh KEYBOARD, run at every interrupt) keeps the two most recent keys in two
/// sets, and frees a set 5 interrupts after its key was last seen; a key pressed again before that is taken
/// for the same press held down.
#[derive(Clone, Debug)]
pub struct Typist {
    /// (frame, key, down), in frame order.
    queue: Vec<(u64, u8, bool)>,
    /// The two KSTATE sets: the key each holds and the frame it is free from.
    sets: [(i32, u64); 2],
    typed_until: u64,
    /// How many times each key is held by what has gone in, so that two holds of one key overlap rightly.
    count: [u8; 40],
}

/// Frames a typed key is held, and between keys.
pub const TYPING_HOLD: u64 = 3;
pub const TYPING_GAP: u64 = 3;
const SET_FREE_AFTER: u64 = 6;

impl Default for Typist {
    fn default() -> Typist {
        Typist::new()
    }
}

impl Typist {
    pub fn new() -> Typist {
        Typist {
            queue: Vec::new(),
            sets: [(-1, 0), (-1, 0)],
            typed_until: 0,
            count: [0; 40],
        }
    }

    /// The key the ROM registers for a chord: the one that is not a shift; both shifts are a key of their own
    /// (extended mode); a shift alone none.
    fn main_key(chord: &[u8]) -> i32 {
        if let Some(&k) = chord
            .iter()
            .find(|&&c| c != keys::CAPS_SHIFT && c != keys::SYMBOL_SHIFT)
        {
            return k as i32;
        }
        if chord.contains(&keys::CAPS_SHIFT) && chord.contains(&keys::SYMBOL_SHIFT) {
            keys::SYMBOL_SHIFT as i32
        } else {
            -1
        }
    }

    fn claim(&mut self, key: i32, from: u64, hold: u64) -> u64 {
        if key < 0 {
            return from;
        }
        let mut t = from;
        loop {
            if let Some(s) = self.sets.iter().find(|s| s.0 == key && s.1 > t) {
                t = s.1;
                continue;
            }
            if let Some(i) = self.sets.iter().position(|s| s.1 <= t) {
                self.sets[i] = (key, t + hold + SET_FREE_AFTER);
                return t;
            }
            t = self.sets.iter().map(|s| s.1).min().unwrap_or(t);
        }
    }

    fn at(&mut self, frame: u64, code: u8, down: bool) {
        let i = self.queue.partition_point(|&(f, _, _)| f <= frame);
        self.queue.insert(i, (frame, code, down));
    }

    /// Types `chords` one after another from frame `now` (after whatever was typed before), at the ROM's pace.
    /// Returns the frame the last key is let go at.
    pub fn type_chords(&mut self, chords: &[Vec<u8>], now: u64) -> u64 {
        let mut t = now.max(self.typed_until);
        for chord in chords {
            let from = self.claim(Self::main_key(chord), t, TYPING_HOLD);
            for &c in chord {
                self.at(from, c, true);
            }
            for &c in chord {
                self.at(from + TYPING_HOLD, c, false);
            }
            t = from + TYPING_HOLD + TYPING_GAP;
            self.typed_until = from + TYPING_HOLD;
        }
        self.typed_until
    }

    /// Types a text (see `char_chords`); characters the keyboard cannot type are passed over.
    pub fn type_text(&mut self, text: &str, now: u64) -> u64 {
        let chords: Vec<Vec<u8>> = text.chars().filter_map(char_chords).flatten().collect();
        self.type_chords(&chords, now)
    }

    /// A chord held from `from` for `frames` frames (a game's press: no ROM pacing).
    pub fn press(&mut self, chord: &[u8], from: u64, frames: u64) {
        for &c in chord {
            self.at(from, c, true);
            self.at(from + frames.max(1), c, false);
        }
    }

    /// Whether anything is still to go in at or after `frame`.
    pub fn busy(&self, frame: u64) -> bool {
        self.queue.last().is_some_and(|&(f, _, _)| f >= frame) || frame <= self.typed_until
    }

    /// The presses and releases due by `frame`, as (key, down) to put to the machine, in order.
    pub fn due(&mut self, frame: u64) -> Vec<(u8, bool)> {
        let n = self.queue.partition_point(|&(f, _, _)| f <= frame);
        let mut out = Vec::new();
        for (_, code, down) in self.queue.drain(..n) {
            let c = &mut self.count[code as usize];
            if down {
                *c += 1;
                if *c == 1 {
                    out.push((code, true));
                }
            } else if *c > 0 {
                *c -= 1;
                if *c == 0 {
                    out.push((code, false));
                }
            }
        }
        out
    }

    pub fn clear(&mut self) {
        *self = Typist::new();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_rows_and_together() {
        let mut i = Input::new();
        i.key(keys::A, true);
        i.key(keys::Q, true);
        assert_eq!(i.read(0xFD), 0x1E); // A
        assert_eq!(i.read(0xFB), 0x1E); // Q
        assert_eq!(i.read(0x00), 0x1E); // all rows: A and Q are both bit 0
        assert_eq!(i.read(0xFE), 0x1F);
        i.set_joystick(Joystick::Cursor, joy::FIRE | joy::LEFT);
        assert_eq!(i.read(0xEF), 0x1E); // 0
        assert_eq!(i.read(0xF7), 0x0F); // 5
    }

    #[test]
    fn three_keys_at_a_rectangles_corners_read_as_the_fourth() {
        // The FAQ's example: CAPS SHIFT, B and V together read as SPACE too (BREAK).
        let mut i = Input::new();
        for k in [keys::CAPS_SHIFT, keys::B, keys::V] {
            i.key(k, true);
        }
        assert_eq!(i.read(0x7F) & 1, 0, "SPACE reads as down");
        i.set_ghosting(false);
        assert_eq!(i.read(0x7F) & 1, 1);
        // Two keys alone ghost nothing.
        let mut i = Input::new();
        i.key(keys::CAPS_SHIFT, true);
        i.key(keys::K5, true);
        assert_eq!(i.read(0xFE), 0x1E);
        assert_eq!(i.read(0xF7), 0x0F);
    }

    #[test]
    fn keys_by_name() {
        assert_eq!(key_code("enter"), Some(keys::ENTER));
        assert_eq!(key_code("SS"), Some(keys::SYMBOL_SHIFT));
        assert_eq!(key_code("7"), Some(keys::K7));
        assert_eq!(key_name(keys::B), "B");
        assert_eq!(
            char_chords('"'),
            Some(vec![vec![keys::SYMBOL_SHIFT, keys::P]])
        );
    }

    #[test]
    fn typing_paces_a_repeated_key() {
        let mut t = Typist::new();
        // LOAD "" : J, then the two quotes, which are the same key (P): the second waits for its set.
        t.type_chords(
            &[
                vec![keys::J],
                vec![keys::SYMBOL_SHIFT, keys::P],
                vec![keys::SYMBOL_SHIFT, keys::P],
                vec![keys::ENTER],
            ],
            10,
        );
        let mut downs = Vec::new();
        for f in 0..60 {
            for (k, d) in t.due(f) {
                if d && k != keys::SYMBOL_SHIFT {
                    downs.push((f, k));
                }
            }
        }
        assert_eq!(
            downs,
            [
                (10, keys::J),
                (16, keys::P),
                (25, keys::P),
                (31, keys::ENTER)
            ]
        );
    }
}
