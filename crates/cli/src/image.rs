//! Pictures: the machine's frame as an indexed PNG, and the reference pictures (PNG and GIF) read back and
//! turned into Spectrum colour numbers, for comparing by colour number as docs/test-corpus.md asks.

use std::fmt;

/// A picture as RGB pixels.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rgb {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<[u8; 3]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageError(pub String);

impl fmt::Display for ImageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ImageError {}

fn err<T>(s: impl Into<String>) -> Result<T, ImageError> {
    Err(ImageError(s.into()))
}

// --- Writing ---

fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, e) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
        }
        *e = c;
    }
    let mut c = !0u32;
    for &b in data {
        c = table[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8);
    }
    !c
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut c = kind.to_vec();
    c.extend_from_slice(data);
    out.extend_from_slice(&c);
    out.extend_from_slice(&crc32(&c).to_be_bytes());
}

/// An 8-bit indexed PNG of `indices` (width × height), with `palette`, each pixel `scale` times as wide and as
/// tall.
pub fn png_indexed(
    indices: &[u8],
    width: usize,
    height: usize,
    palette: &[[u8; 3]],
    scale: usize,
) -> Vec<u8> {
    let scale = scale.max(1);
    let (w, h) = (width * scale, height * scale);
    let mut raw = Vec::with_capacity((w + 1) * h);
    for y in 0..h {
        raw.push(0);
        let row = &indices[(y / scale) * width..(y / scale + 1) * width];
        for &p in row {
            for _ in 0..scale {
                raw.push(p);
            }
        }
    }
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(w as u32).to_be_bytes());
    ihdr.extend_from_slice(&(h as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 3, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &ihdr);
    let plte: Vec<u8> = palette.iter().flatten().copied().collect();
    chunk(&mut out, b"PLTE", &plte);
    chunk(
        &mut out,
        b"IDAT",
        &miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6),
    );
    chunk(&mut out, b"IEND", &[]);
    out
}

// --- Reading PNG ---

/// Reads a PNG (any colour type and bit depth, interlaced or not) as RGB.
pub fn read_png(data: &[u8]) -> Result<Rgb, ImageError> {
    if data.len() < 8 || &data[..8] != b"\x89PNG\r\n\x1a\n" {
        return err("not a PNG");
    }
    let mut at = 8;
    let (mut width, mut height, mut depth, mut ctype, mut interlace) =
        (0usize, 0usize, 0u8, 0u8, 0u8);
    let mut palette: Vec<[u8; 3]> = Vec::new();
    let mut idat = Vec::new();
    while at + 8 <= data.len() {
        let len = u32::from_be_bytes(data[at..at + 4].try_into().unwrap()) as usize;
        let kind = &data[at + 4..at + 8];
        if at + 12 + len > data.len() {
            return err("PNG cut short");
        }
        let body = &data[at + 8..at + 8 + len];
        match kind {
            b"IHDR" => {
                width = u32::from_be_bytes(body[0..4].try_into().unwrap()) as usize;
                height = u32::from_be_bytes(body[4..8].try_into().unwrap()) as usize;
                depth = body[8];
                ctype = body[9];
                interlace = body[12];
            }
            b"PLTE" => palette = body.chunks(3).map(|c| [c[0], c[1], c[2]]).collect(),
            b"IDAT" => idat.extend_from_slice(body),
            b"IEND" => break,
            _ => {}
        }
        at += 12 + len;
    }
    if width == 0 || height == 0 || width * height > 1 << 26 {
        return err("PNG size");
    }
    let raw = miniz_oxide::inflate::decompress_to_vec_zlib(&idat)
        .map_err(|e| ImageError(format!("PNG inflate: {e:?}")))?;
    let channels = match ctype {
        0 => 1,
        2 => 3,
        3 => 1,
        4 => 2,
        6 => 4,
        _ => return err("PNG colour type"),
    };
    let bits = channels * depth as usize;
    let bpp = bits.div_ceil(8).max(1);
    let mut pixels = vec![[0u8; 3]; width * height];
    let passes: Vec<(usize, usize, usize, usize)> = if interlace == 1 {
        vec![
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ]
    } else {
        vec![(0, 0, 1, 1)]
    };
    let mut pos = 0;
    for (x0, y0, dx, dy) in passes {
        if x0 >= width || y0 >= height {
            continue;
        }
        let pw = (width - x0).div_ceil(dx);
        let ph = (height - y0).div_ceil(dy);
        let stride = (pw * bits).div_ceil(8);
        let mut prev = vec![0u8; stride];
        for py in 0..ph {
            if pos + 1 + stride > raw.len() {
                return err("PNG data short");
            }
            let filter = raw[pos];
            let mut line = raw[pos + 1..pos + 1 + stride].to_vec();
            pos += 1 + stride;
            for i in 0..stride {
                let a = if i >= bpp { line[i - bpp] } else { 0 } as i32;
                let b = prev[i] as i32;
                let c = if i >= bpp { prev[i - bpp] } else { 0 } as i32;
                let x = line[i] as i32;
                line[i] = match filter {
                    0 => x,
                    1 => x + a,
                    2 => x + b,
                    3 => x + (a + b) / 2,
                    4 => {
                        let p = a + b - c;
                        let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
                        x + if pa <= pb && pa <= pc {
                            a
                        } else if pb <= pc {
                            b
                        } else {
                            c
                        }
                    }
                    _ => return err("PNG filter"),
                } as u8;
            }
            for px in 0..pw {
                let sample = |k: usize| -> u16 {
                    let bit = (px * channels + k) * depth as usize;
                    match depth {
                        16 => u16::from_be_bytes([line[bit / 8], line[bit / 8 + 1]]) >> 8,
                        8 => line[bit / 8] as u16,
                        _ => {
                            let shift = 8 - depth as usize - (bit % 8);
                            ((line[bit / 8] >> shift) & ((1 << depth) - 1)) as u16
                        }
                    }
                };
                let scale_up = |v: u16| -> u8 {
                    match depth {
                        1 => (v * 255) as u8,
                        2 => (v * 85) as u8,
                        4 => (v * 17) as u8,
                        _ => v as u8,
                    }
                };
                let rgb = match ctype {
                    3 => palette
                        .get(sample(0) as usize)
                        .copied()
                        .unwrap_or([0, 0, 0]),
                    0 | 4 => {
                        let g = scale_up(sample(0));
                        [g, g, g]
                    }
                    _ => [sample(0) as u8, sample(1) as u8, sample(2) as u8],
                };
                pixels[(y0 + py * dy) * width + x0 + px * dx] = rgb;
            }
            prev = line;
        }
    }
    Ok(Rgb {
        width,
        height,
        pixels,
    })
}

// --- Reading GIF ---

/// Reads the first image of a GIF as RGB (onto its logical screen, the background where it does not reach).
pub fn read_gif(data: &[u8]) -> Result<Rgb, ImageError> {
    if data.len() < 13 || !(data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a")) {
        return err("not a GIF");
    }
    let sw = u16::from_le_bytes([data[6], data[7]]) as usize;
    let sh = u16::from_le_bytes([data[8], data[9]]) as usize;
    let flags = data[10];
    let bg = data[11] as usize;
    let mut at = 13;
    let mut global = Vec::new();
    if flags & 0x80 != 0 {
        let n = 2usize << (flags & 7);
        if at + 3 * n > data.len() {
            return err("GIF palette");
        }
        global = data[at..at + 3 * n]
            .chunks(3)
            .map(|c| [c[0], c[1], c[2]])
            .collect();
        at += 3 * n;
    }
    let fill = global.get(bg).copied().unwrap_or([0, 0, 0]);
    let mut pixels = vec![fill; sw * sh];
    let mut transparent: Option<u8> = None;
    while at < data.len() {
        match data[at] {
            0x21 => {
                // Extension: a graphic control's transparent colour; the rest passed over.
                let label = data.get(at + 1).copied().unwrap_or(0);
                at += 2;
                let mut first = true;
                while at < data.len() && data[at] != 0 {
                    let n = data[at] as usize;
                    if first && label == 0xF9 && n >= 4 && data[at + 1] & 1 != 0 {
                        transparent = Some(data[at + 4]);
                    }
                    first = false;
                    at += 1 + n;
                }
                at += 1;
            }
            0x2C => {
                if at + 10 > data.len() {
                    return err("GIF image");
                }
                let x0 = u16::from_le_bytes([data[at + 1], data[at + 2]]) as usize;
                let y0 = u16::from_le_bytes([data[at + 3], data[at + 4]]) as usize;
                let w = u16::from_le_bytes([data[at + 5], data[at + 6]]) as usize;
                let h = u16::from_le_bytes([data[at + 7], data[at + 8]]) as usize;
                let iflags = data[at + 9];
                at += 10;
                let mut table = global.clone();
                if iflags & 0x80 != 0 {
                    let n = 2usize << (iflags & 7);
                    table = data[at..at + 3 * n]
                        .chunks(3)
                        .map(|c| [c[0], c[1], c[2]])
                        .collect();
                    at += 3 * n;
                }
                let min_code = data[at] as u32;
                at += 1;
                let mut stream = Vec::new();
                while at < data.len() && data[at] != 0 {
                    let n = data[at] as usize;
                    stream.extend_from_slice(&data[at + 1..(at + 1 + n).min(data.len())]);
                    at += 1 + n;
                }
                let indices = lzw(&stream, min_code, w * h)?;
                let rows: Vec<usize> = if iflags & 0x40 != 0 {
                    let mut r = Vec::new();
                    for (start, step) in [(0, 8), (4, 8), (2, 4), (1, 2)] {
                        r.extend((start..h).step_by(step));
                    }
                    r
                } else {
                    (0..h).collect()
                };
                for (i, &idx) in indices.iter().enumerate() {
                    let (x, y) = (x0 + i % w, y0 + rows[i / w]);
                    if x < sw && y < sh && Some(idx) != transparent {
                        pixels[y * sw + x] = table.get(idx as usize).copied().unwrap_or([0, 0, 0]);
                    }
                }
                return Ok(Rgb {
                    width: sw,
                    height: sh,
                    pixels,
                });
            }
            _ => break,
        }
    }
    err("GIF has no image")
}

fn lzw(stream: &[u8], min_code: u32, n: usize) -> Result<Vec<u8>, ImageError> {
    let clear = 1u32 << min_code;
    let end = clear + 1;
    let mut size = min_code + 1;
    let mut dict: Vec<(u32, u8)> = Vec::with_capacity(4096); // (prefix, last byte)
    let reset = |dict: &mut Vec<(u32, u8)>| {
        dict.clear();
        for i in 0..clear {
            dict.push((u32::MAX, i as u8));
        }
        dict.push((u32::MAX, 0));
        dict.push((u32::MAX, 0));
    };
    reset(&mut dict);
    let mut out = Vec::with_capacity(n);
    let (mut bitpos, mut prev): (usize, Option<u32>) = (0, None);
    let mut buf = Vec::new();
    let expand = |dict: &Vec<(u32, u8)>, mut code: u32, buf: &mut Vec<u8>| {
        buf.clear();
        while code != u32::MAX {
            let (p, b) = dict[code as usize];
            buf.push(b);
            code = p;
        }
        buf.reverse();
    };
    while out.len() < n {
        if bitpos + size as usize > stream.len() * 8 {
            break;
        }
        let mut code = 0u32;
        for i in 0..size as usize {
            let bit = bitpos + i;
            code |= (((stream[bit / 8] >> (bit % 8)) & 1) as u32) << i;
        }
        bitpos += size as usize;
        if code == clear {
            reset(&mut dict);
            size = min_code + 1;
            prev = None;
            continue;
        }
        if code == end {
            break;
        }
        match prev {
            None => {
                expand(&dict, code, &mut buf);
                out.extend_from_slice(&buf);
            }
            Some(p) => {
                if (code as usize) < dict.len() {
                    expand(&dict, code, &mut buf);
                    let first = buf[0];
                    out.extend_from_slice(&buf);
                    if dict.len() < 4096 {
                        dict.push((p, first));
                    }
                } else {
                    expand(&dict, p, &mut buf);
                    let first = buf[0];
                    buf.push(first);
                    out.extend_from_slice(&buf);
                    if dict.len() < 4096 {
                        dict.push((p, first));
                    }
                }
            }
        }
        prev = Some(code);
        if dict.len() == (1 << size) as usize && size < 12 {
            size += 1;
        }
    }
    out.resize(n, 0);
    Ok(out)
}

/// Reads a PNG or a GIF.
pub fn read_image(data: &[u8]) -> Result<Rgb, ImageError> {
    if data.starts_with(b"\x89PNG") {
        read_png(data)
    } else if data.starts_with(b"GIF8") {
        read_gif(data)
    } else {
        err("neither a PNG nor a GIF")
    }
}

/// The Spectrum colour number (0–15, bright black read as 0) nearest an RGB colour, whatever the palette's
/// levels (0xC0, 0xD8, 0xBF, ... for the normal colours, 0xFF for the bright): each channel is on above a
/// quarter, and the colour bright when a channel that is on is nearer full than the normal levels.
pub fn colour_number(rgb: [u8; 3]) -> u8 {
    let [r, g, b] = rgb;
    let on = |v: u8| v >= 0x40;
    let c = (on(b) as u8) | ((on(r) as u8) << 1) | ((on(g) as u8) << 2);
    if c == 0 {
        return 0;
    }
    let top = [r, g, b].into_iter().filter(|&v| on(v)).max().unwrap_or(0);
    if top >= 0xEC { c | 8 } else { c }
}

impl Rgb {
    /// The picture as colour numbers.
    pub fn colour_numbers(&self) -> Vec<u8> {
        self.pixels.iter().map(|&p| colour_number(p)).collect()
    }
}

/// Where two pictures of colour numbers differ.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Difference {
    pub compared: usize,
    pub differing: usize,
    /// The bounding box of the differences: x0, y0, x1, y1 (inclusive).
    pub bounds: Option<(usize, usize, usize, usize)>,
    /// Up to ten differing pixels: x, y, ours, theirs.
    pub examples: Vec<(usize, usize, u8, u8)>,
}

/// Compares `a` (aw wide) at offset (ax, ay) against all of `b` (bw × bh), colour 8 counted as 0.
pub fn compare(
    a: &[u8],
    aw: usize,
    ax: usize,
    ay: usize,
    b: &[u8],
    bw: usize,
    bh: usize,
) -> Difference {
    let mut d = Difference::default();
    let ah = a.len() / aw.max(1);
    let norm = |c: u8| if c == 8 { 0 } else { c };
    for y in 0..bh {
        for x in 0..bw {
            let (px, py) = (x + ax, y + ay);
            if px >= aw || py >= ah {
                continue;
            }
            d.compared += 1;
            let (p, q) = (norm(a[py * aw + px]), norm(b[y * bw + x]));
            if p != q {
                d.differing += 1;
                d.bounds = Some(match d.bounds {
                    None => (x, y, x, y),
                    Some((x0, y0, x1, y1)) => (x0.min(x), y0.min(y), x1.max(x), y1.max(y)),
                });
                if d.examples.len() < 10 {
                    d.examples.push((x, y, p, q));
                }
            }
        }
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_png_written_reads_back() {
        let idx: Vec<u8> = (0..352 * 296).map(|i| (i % 16) as u8).collect();
        let pal = spectrum::PALETTE;
        let png = png_indexed(&idx, 352, 296, &pal, 1);
        let back = read_png(&png).unwrap();
        assert_eq!((back.width, back.height), (352, 296));
        let nums = back.colour_numbers();
        for (i, (&a, &b)) in idx.iter().zip(&nums).enumerate() {
            assert_eq!(if a == 8 { 0 } else { a }, b, "pixel {i}");
        }
    }

    #[test]
    fn colours_by_number_in_any_palette() {
        assert_eq!(colour_number([0xD8, 0, 0]), 2);
        assert_eq!(colour_number([0xFF, 0, 0]), 10);
        assert_eq!(colour_number([0xBF, 0xBF, 0xBF]), 7);
        assert_eq!(colour_number([0xFF, 0xFF, 0xFF]), 15);
        assert_eq!(colour_number([0, 0, 0]), 0);
        assert_eq!(colour_number([0, 0xC0, 0xC0]), 5);
    }
}
