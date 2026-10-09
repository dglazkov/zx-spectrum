// DEFLATE (RFC 1951), decoded: what is inside the archive's .zip files and a .szx's compressed blocks, for the
// stand-in emulator. (The real core has its own, in crates/unzip.) A bit at a time, after Mark Adler's puff.c: small
// and slow, and fast enough for a tape.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: how many codes of each length, and the symbols in code order. */
interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function huffman(lengths: ArrayLike<number>, n: number): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Uint16Array(16);
  for (let len = 1; len < 16; len++) offsets[len] = offsets[len - 1] + counts[len - 1];
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  return { counts, symbols };
}

let fixedLit: Huffman | undefined;
let fixedDist: Huffman | undefined;

/** The raw DEFLATE stream `data`, inflated. */
export function inflate(data: Uint8Array, sizeHint = data.length * 4): Uint8Array {
  let out = new Uint8Array(Math.max(1024, sizeHint));
  let outLen = 0;
  let pos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const ensure = (n: number) => {
    if (outLen + n <= out.length) return;
    const bigger = new Uint8Array(Math.max(out.length * 2, outLen + n));
    bigger.set(out.subarray(0, outLen));
    out = bigger;
  };
  const bits = (n: number): number => {
    while (bitCount < n) {
      if (pos >= data.length) throw new Error('inflate: the data ends early');
      bitBuf |= data[pos++] << bitCount;
      bitCount += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.counts[len];
      if (code - first < count) return h.symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: a bad code');
  };
  const codes = (lit: Huffman, dist: Huffman) => {
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[outLen++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        const l = sym - 257;
        if (l >= 29) throw new Error('inflate: a bad length');
        const length = LENGTH_BASE[l] + bits(LENGTH_EXTRA[l]);
        const d = decode(dist);
        if (d >= 30) throw new Error('inflate: a bad distance');
        const distance = DIST_BASE[d] + bits(DIST_EXTRA[d]);
        if (distance > outLen) throw new Error('inflate: a distance before the start');
        ensure(length);
        for (let i = 0; i < length; i++, outLen++) out[outLen] = out[outLen - distance];
      }
    }
  };

  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCount = 0;
      if (pos + 4 > data.length) throw new Error('inflate: the data ends early');
      const len = data[pos] | (data[pos + 1] << 8);
      pos += 4;
      if (pos + len > data.length) throw new Error('inflate: the data ends early');
      ensure(len);
      out.set(data.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
    } else if (type === 1) {
      if (!fixedLit || !fixedDist) {
        const l = new Uint8Array(288);
        l.fill(8, 0, 144);
        l.fill(9, 144, 256);
        l.fill(7, 256, 280);
        l.fill(8, 280, 288);
        fixedLit = huffman(l, 288);
        fixedDist = huffman(new Uint8Array(30).fill(5), 30);
      }
      codes(fixedLit, fixedDist);
    } else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i]] = bits(3);
      const lencode = huffman(lengths, 19);
      lengths.fill(0);
      let i = 0;
      while (i < nlen + ndist) {
        const sym = decode(lencode);
        if (sym < 16) lengths[i++] = sym;
        else {
          let repeat: number;
          let value = 0;
          if (sym === 16) {
            if (i === 0) throw new Error('inflate: a repeat with nothing before it');
            value = lengths[i - 1];
            repeat = 3 + bits(2);
          } else if (sym === 17) repeat = 3 + bits(3);
          else repeat = 11 + bits(7);
          if (i + repeat > nlen + ndist) throw new Error('inflate: too many lengths');
          lengths.fill(value, i, i + repeat);
          i += repeat;
        }
      }
      codes(huffman(lengths, nlen), huffman(lengths.subarray(nlen), ndist));
    } else {
      throw new Error('inflate: a bad block type');
    }
  }
  return out.slice(0, outLen);
}
