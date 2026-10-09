//! The ULA's picture, drawn lazily: nothing is drawn until something is about to change what a part of the
//! picture not yet drawn would show (a border write, a write to the screen, a change of screen bank, the
//! frame's end), and then everything up to that moment is drawn as the ULA drew it.
//!
//! The frame is 352 × 296 pixels, one byte each, a colour from 0 to 15 (8–15 bright), with the paper at
//! (48, 48). It is drawn in units of one T-state (two pixels): frame pixel (x, y) is drawn at T-state
//! `first_pixel + y × line + x / 2`, which puts the paper's corner at the model's `paper` T-state.
//!
//! - **The border** on Sinclair's ULAs and Amstrad's gate array is latched each 4 T-states (8 pixels): a write
//!   at T-state `w` (the I/O write's second T-state) shows in the 8-pixel group drawn from `g` when
//!   `w <= g + border_latch`: 3 on the 48K (the WoS FAQ: an OUT ending at 14339–14342 changes the border
//!   from the paper's corner at 14336), 2 on the 128K family (azesmbog's ULA 128 test, as a +2 shows it).
//!   On the Pentagon the border is taken at every T-state (2 pixels).
//! - **The paper**: each pair of columns is fetched in four T-states, bitmap and attribute of the even column,
//!   then of the odd one, from `fetch_offset` T-states after the even column's first pixel (14338 on the 48K,
//!   the floating bus's first byte); a write lands in what the ULA shows if it happens no later than the
//!   fetch. FLASH swaps ink and paper for 16 frames in every 32.
//! - **Snow**: on the 16K/48K, 128K and +2, an opcode fetch whose refresh (its fourth T-state) falls on the
//!   ULA's fetch of an even column, with I pointing at contended memory, makes the ULA fetch that column's
//!   bitmap and attribute with the refresh address's low byte (R); one that falls on the odd column's fetch
//!   makes it show the even column's bytes again (Weiv's account of the effect, 2022).

/// The frame's size, and where its paper is.
pub const FRAME_WIDTH: usize = 352;
pub const FRAME_HEIGHT: usize = 296;
pub const PAPER_X: usize = 48;
pub const PAPER_Y: usize = 48;

/// Units (T-states, two pixels) a frame row.
const UNITS: u32 = (FRAME_WIDTH / 2) as u32;
/// The first and last+1 unit of the paper in a row, and its first and last+1 row.
const PAPER_U0: u32 = 24;
const PAPER_U1: u32 = PAPER_U0 + 128;
const PAPER_Y0: u32 = PAPER_Y as u32;
const PAPER_Y1: u32 = PAPER_Y0 + 192;

/// For each bitmap byte, eight bytes in memory order, FFh where its bit (most significant first) is set.
static EXPAND: [u64; 256] = {
    let mut t = [0u64; 256];
    let mut b = 0;
    while b < 256 {
        let mut bytes = [0u8; 8];
        let mut i = 0;
        while i < 8 {
            if b & (0x80 >> i) != 0 {
                bytes[i] = 0xFF;
            }
            i += 1;
        }
        t[b] = u64::from_ne_bytes(bytes);
        b += 1;
    }
    t
};

/// What a snowy opcode fetch did to a column.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SnowKind {
    /// The even column's bitmap and attribute fetched with R as the low byte of their addresses.
    Snow(u8),
    /// The odd column shows the even column's bytes again.
    Double,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SnowEvent {
    pub line: u8,
    pub col: u8,
    pub kind: SnowKind,
}

#[derive(Clone, Debug)]
pub(crate) struct Video {
    pub pixels: Vec<u8>,
    first_pixel: u32,
    line: u32,
    fetch_offset: u32,
    border_step: u32,
    /// A border write at T-state `w` shows from the group drawn from `g` when `w <= g + border_latch`.
    border_latch: u32,
    /// The next unit to draw.
    row: u32,
    unit: u32,
    /// The border colour as the next unit to draw will show it.
    pub border: u8,
    /// Frames since power-on, for FLASH (its phase is bit 4).
    pub flash_frames: u32,
    /// This frame's snowy fetches, in the order they happened, and the next one to apply.
    pub snow: Vec<SnowEvent>,
    snow_next: usize,
    /// The bitmap byte of the column being fetched, taken between its two fetches.
    latched: Option<u8>,
}

impl Video {
    pub fn new(
        first_pixel: u32,
        line: u32,
        fetch_offset: u32,
        border_step: u32,
        border_latch: u32,
    ) -> Video {
        Video {
            pixels: vec![0; FRAME_WIDTH * FRAME_HEIGHT],
            first_pixel,
            line,
            fetch_offset,
            border_step,
            border_latch,
            row: 0,
            unit: 0,
            border: 7,
            flash_frames: 0,
            snow: Vec::new(),
            snow_next: 0,
            latched: None,
        }
    }

    /// The T-state at which frame row `row`'s first pixel is drawn.
    #[inline(always)]
    fn row_t(&self, row: u32) -> u32 {
        self.first_pixel + row * self.line
    }

    /// The T-state of the ULA's bitmap fetch for paper column `col` of the line drawn from `row_t`.
    #[inline(always)]
    pub fn bitmap_fetch(&self, paper_line_t: u32, col: u32) -> u32 {
        paper_line_t + (col & !1) * 4 + self.fetch_offset + (col & 1) * 2
    }

    /// The T-state from which unit `unit` of row `row` can be drawn: after its border is latched, or after
    /// the last of its bytes is fetched. A change at T-state `t` shows in the units whose time is `>= t`.
    #[inline(always)]
    fn ready(&self, row: u32, unit: u32) -> u32 {
        let row_t = self.row_t(row);
        if (PAPER_Y0..PAPER_Y1).contains(&row) && (PAPER_U0..PAPER_U1).contains(&unit) {
            let col = (unit - PAPER_U0) / 4;
            self.bitmap_fetch(row_t + PAPER_U0, col) + 1
        } else if self.border_step == 4 {
            row_t + (unit & !3) + self.border_latch
        } else {
            row_t + unit + self.border_latch
        }
    }

    /// Draws everything that can no longer change before T-state `t`: every unit whose border was latched,
    /// or whose bytes were fetched, before `t`.
    pub fn render_to(&mut self, t: u32, screen: &[u8]) {
        while self.row < FRAME_HEIGHT as u32 {
            let row = self.row;
            // How far along the row is ready: readiness rises along a row, so the first unit not yet ready is
            // found by halving (the whole rest of the row when its last unit is ready).
            let limit = if self.ready(row, UNITS - 1) < t {
                UNITS
            } else {
                let (mut lo, mut hi) = (self.unit, UNITS - 1);
                if self.ready(row, lo) >= t {
                    lo
                } else {
                    // ready(lo) < t <= ready(hi)
                    while hi - lo > 1 {
                        let mid = (lo + hi) / 2;
                        if self.ready(row, mid) < t {
                            lo = mid;
                        } else {
                            hi = mid;
                        }
                    }
                    hi
                }
            };
            self.draw_units(row, limit, screen);
            if limit < UNITS {
                // A column whose bitmap byte is fetched before t but its attribute not: the bitmap is taken
                // now, so that a write between the two fetches lands in the attribute alone.
                let u = self.unit;
                if (PAPER_Y0..PAPER_Y1).contains(&row) && (PAPER_U0..PAPER_U1).contains(&u) {
                    let col = (u - PAPER_U0) / 4;
                    if self.bitmap_fetch(self.row_t(row) + PAPER_U0, col) < t
                        && self.latched.is_none()
                    {
                        let (b, _) = self.column_addresses(row - PAPER_Y0, col);
                        self.latched = Some(screen[b]);
                    }
                }
                return;
            }
            self.row += 1;
            self.unit = 0;
        }
    }

    /// Draws units from the next one to `limit` (exclusive) of row `row`: runs of border, and whole paper
    /// columns (a paper column's units are ready together, so `limit` is never inside one).
    fn draw_units(&mut self, row: u32, limit: u32, screen: &[u8]) {
        let base = row as usize * FRAME_WIDTH;
        let paper_row = (PAPER_Y0..PAPER_Y1).contains(&row);
        while self.unit < limit {
            let u = self.unit;
            if paper_row && (PAPER_U0..PAPER_U1).contains(&u) {
                let col = (u - PAPER_U0) / 4;
                self.draw_column(row - PAPER_Y0, col, screen);
                self.unit = PAPER_U0 + (col + 1) * 4;
            } else {
                let end = if paper_row && u < PAPER_U0 {
                    PAPER_U0.min(limit)
                } else {
                    limit
                };
                self.pixels[base + u as usize * 2..base + end as usize * 2].fill(self.border);
                self.unit = end;
            }
        }
    }

    /// Where the ULA fetches paper column `col` of paper line `line` from: its bitmap and attribute addresses,
    /// unless a snowy opcode fetch disturbed them.
    fn column_addresses(&mut self, line: u32, col: u32) -> (usize, usize) {
        let (mut b_at, mut a_at) = screen_addresses(line, col);
        while let Some(e) = self.snow.get(self.snow_next) {
            if (e.line as u32, e.col as u32) < (line, col) {
                // For a column already drawn (it cannot be: fetches come before drawing): passed over.
                self.snow_next += 1;
                continue;
            }
            if e.line as u32 == line && e.col as u32 == col {
                match e.kind {
                    SnowKind::Snow(r) => {
                        b_at = (b_at & 0xFF00) | r as usize;
                        a_at = (a_at & 0xFF00) | r as usize;
                    }
                    SnowKind::Double => {
                        b_at -= 1;
                        a_at -= 1;
                    }
                }
            }
            break;
        }
        (b_at, a_at)
    }

    /// Draws paper column `col` (0–31) of paper line `line` (0–191).
    fn draw_column(&mut self, line: u32, col: u32, screen: &[u8]) {
        let (b_at, a_at) = self.column_addresses(line, col);
        if let Some(e) = self.snow.get(self.snow_next)
            && (e.line as u32, e.col as u32) == (line, col)
        {
            self.snow_next += 1;
        }
        let bitmap = self.latched.take().unwrap_or(screen[b_at]);
        let attr = screen[a_at];
        let bright = (attr >> 3) & 8;
        let mut ink = (attr & 7) | bright;
        let mut paper = ((attr >> 3) & 7) | bright;
        if attr & 0x80 != 0 && self.flash_frames & 16 != 0 {
            std::mem::swap(&mut ink, &mut paper);
        }
        // Eight pixels at once: each byte of the mask is FFh where the bitmap's bit is set.
        let mask = EXPAND[bitmap as usize];
        let splat = |c: u8| u64::from_ne_bytes([c; 8]);
        let px = (splat(ink) & mask) | (splat(paper) & !mask);
        let at = (PAPER_Y as u32 + line) as usize * FRAME_WIDTH + PAPER_X + col as usize * 8;
        self.pixels[at..at + 8].copy_from_slice(&px.to_ne_bytes());
    }

    /// Changes the border at T-state `t` (drawing everything before the change first).
    pub fn set_border(&mut self, t: u32, colour: u8, screen: &[u8]) {
        if colour != self.border {
            self.render_to(t, screen);
            self.border = colour;
        }
    }

    /// The frame is over: everything left is drawn, and the next frame starts from the top.
    pub fn end_frame(&mut self, screen: &[u8]) {
        self.render_to(u32::MAX, screen);
        self.row = 0;
        self.unit = 0;
        self.snow.clear();
        self.snow_next = 0;
        self.latched = None;
        self.flash_frames = self.flash_frames.wrapping_add(1);
    }

    /// Whether anything of the frame has been drawn (the picture is part-way through).
    pub fn position(&self) -> (u32, u32) {
        (self.row, self.unit)
    }

    pub fn snow_next(&self) -> usize {
        self.snow_next
    }

    pub fn latched(&self) -> Option<u8> {
        self.latched
    }

    /// Puts back how far the frame's snow and the column being fetched have got (for a saved state).
    pub fn restore_progress(&mut self, snow_next: usize, latched: Option<u8>) {
        self.snow_next = snow_next.min(self.snow.len());
        self.latched = latched;
    }

    pub fn set_position(&mut self, row: u32, unit: u32) {
        self.row = row.min(FRAME_HEIGHT as u32);
        self.unit = unit.min(UNITS);
    }
}

/// The address in the screen bank of paper line `line`'s bitmap at column `col`, and its attribute.
#[inline(always)]
pub(crate) fn screen_addresses(line: u32, col: u32) -> (usize, usize) {
    let b = (((line & 0xC0) << 5) | ((line & 0x07) << 8) | ((line & 0x38) << 2)) as usize
        + col as usize;
    let a = 0x1800 + (line as usize >> 3) * 32 + col as usize;
    (b, a)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video48() -> Video {
        Video::new(14336 - 48 * 224 - 24, 224, 2, 4, 3)
    }

    #[test]
    fn a_border_write_lands_on_its_8_pixel_group() {
        let screen = vec![0u8; 0x4000];
        // The paper's corner is drawn at 14336, so frame pixel (48, 0) at 14336 - 48 * 224 = 3584.
        for (w, x) in [(3587, 48), (3588, 56), (3591, 56), (3592, 64)] {
            let mut v = video48();
            v.border = 1;
            v.set_border(w, 2, &screen);
            v.end_frame(&screen);
            let row: Vec<u8> = v.pixels[..FRAME_WIDTH].to_vec();
            assert_eq!(row[x - 1], 1, "write at {w}");
            assert_eq!(row[x], 2, "write at {w}");
        }
    }

    #[test]
    fn the_paper_shows_the_screen_with_flash() {
        let mut screen = vec![0u8; 0x4000];
        screen[0] = 0b1000_0001; // line 0, column 0
        screen[0x1800] = 0x80 | 0x40 | (1 << 3) | 2; // flash, bright, paper 1, ink 2
        let mut v = video48();
        v.end_frame(&screen);
        let at = PAPER_Y * FRAME_WIDTH + PAPER_X;
        assert_eq!(&v.pixels[at..at + 8], &[10, 9, 9, 9, 9, 9, 9, 10]);
        for _ in 0..16 {
            v.end_frame(&screen);
        }
        assert_eq!(
            &v.pixels[at..at + 8],
            &[9, 10, 10, 10, 10, 10, 10, 9],
            "flash"
        );
    }

    #[test]
    fn a_write_between_the_two_fetches_lands_in_the_attribute_alone() {
        let mut screen = vec![0u8; 0x4000];
        screen[0] = 0xFF;
        screen[0x1800] = 0x07; // ink 7 on paper 0
        let mut v = video48();
        // Column 0 of line 0: its bitmap is fetched at 14338, its attribute at 14339. Writes at 14339 land in
        // the attribute only.
        v.render_to(14339, &screen);
        screen[0] = 0x00;
        screen[0x1800] = 0x38; // ink 0 on paper 7
        v.end_frame(&screen);
        let at = PAPER_Y * FRAME_WIDTH + PAPER_X;
        assert_eq!(v.pixels[at], 0, "the old bitmap in the new attribute's ink");
        // And at 14340 neither lands.
        let mut v = video48();
        screen[0] = 0xFF;
        screen[0x1800] = 0x07;
        v.render_to(14340, &screen);
        screen[0x1800] = 0x38;
        v.end_frame(&screen);
        assert_eq!(v.pixels[at], 7);
    }
}
