// The Spectrum's sixteen colours: index 0–7 normal, 8–15 bright, each black, blue, red, magenta, green, cyan, yellow,
// white (docs/architecture.md).
//
// The ULA makes each colour from three on-or-off primaries and a BRIGHT bit that raises their level. No published
// colorimetric measurement of a real 48K's picture could be found (Wikipedia's palette is a calculation, and says so),
// so the levels are the circuit's: bright at the full level, normal at 85% of it, which is 0.55 V against 0.65 V in
// Chris Smith's design of the output stage for the Harlequin, his reverse-engineered, gate-for-gate 48K
// (zxdesign.info, "Designing the output driver", 2007), and Wikipedia's figure too. A video signal's voltage is
// already gamma-encoded, so 85% of the voltage is 85% of the code value: 0.85 × 255 = 216 (D8h). docs/web.md has
// the sources, and the other palettes here.

export interface Palette {
  readonly id: string;
  readonly name: string;
  /** 16 × RGB, 0–255. */
  readonly rgb: Uint8Array;
}

function levels(normal: number, bright: number): Uint8Array {
  const rgb = new Uint8Array(48);
  for (let i = 0; i < 16; i++) {
    const level = i < 8 ? normal : bright;
    const c = i & 7; // bit 0 blue, bit 1 red, bit 2 green
    rgb[i * 3] = c & 2 ? level : 0;
    rgb[i * 3 + 1] = c & 4 ? level : 0;
    rgb[i * 3 + 2] = c & 1 ? level : 0;
  }
  return rgb;
}

/** The palettes a person can choose. The first is the default. */
export const PALETTES: readonly Palette[] = [
  { id: 'ula', name: 'ULA levels (85%)', rgb: levels(0xd8, 0xff) },
  // What most emulators have shown since the 1990s (Fuse, SpecIde): normal at 75%.
  { id: 'classic', name: 'Emulator classic (75%)', rgb: levels(0xc0, 0xff) },
  // A grey television: the colours' luminance, Y = 0.299 R + 0.587 G + 0.114 B (ITU-R BT.601) of the ULA levels.
  { id: 'mono', name: 'Black and white television', rgb: mono(levels(0xd8, 0xff)) },
];

function mono(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(48);
  for (let i = 0; i < 16; i++) {
    const y = Math.round(0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]);
    out.fill(y, i * 3, i * 3 + 3);
  }
  return out;
}

export function palette(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** Colour `index` of `p` as a CSS colour. */
export function css(p: Palette, index: number): string {
  const i = (index & 15) * 3;
  return `rgb(${p.rgb[i]} ${p.rgb[i + 1]} ${p.rgb[i + 2]})`;
}
