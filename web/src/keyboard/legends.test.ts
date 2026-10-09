import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEY } from '../emulator/keys';
import { LEGENDS } from './legends';

// The 48K ROM, whose key tables are the legends' source (roms/README.md says whose it is).
const rom = new Uint8Array(readFileSync(new URL('../../../roms/48.rom', import.meta.url)));

/** The ROM's keywords, RND (A5h) on, from its token table at 0095h. */
const tokens: string[] = [];
{
  let p = 0x0095;
  let word = '';
  while (tokens.length < 92) {
    const b = rom[p++];
    word += String.fromCharCode(b & 0x7f);
    if (b & 0x80) {
      tokens.push(word.trim());
      word = '';
    }
  }
  tokens.shift(); // the '?' of the error report
}
const name = (code: number) => (code >= 0xa5 ? tokens[code - 0xa5] : code === 0x60 ? '£' : code === 0x7f ? '©' : code === 0x5e ? '↑' : String.fromCharCode(code));

/** The case abbreviates and spaces some keywords; otherwise its legend is the ROM's word. */
const PRINTED: Record<string, string> = { RANDOMIZE: 'RAND', CONTINUE: 'CONT', 'GO TO': 'GOTO', 'GO SUB': 'GOSUB', 'STR$': 'STR $', 'CHR$': 'CHR $', LPRINT: 'L PRINT', LLIST: 'L LIST', 'INKEY$': 'IN KEY $', 'VAL$': 'VAL $', 'SCREEN$': 'SCREEN $', 'OPEN #': 'OPEN #', 'CLOSE #': 'CLOSE #' };
const printed = (word: string) => PRINTED[word] ?? word;

const all = LEGENDS.flat();
const letters = all.filter((l) => /^[A-Z]$/.test(l.key));
const digits = all.filter((l) => /^[0-9]$/.test(l.key));
const letterIndex = (l: string) => l.charCodeAt(0) - 0x41;

describe('the keyboard’s legends, against the ROM', () => {
  it('has the forty keys, each once, in four rows of ten', () => {
    expect(LEGENDS.map((r) => r.length)).toEqual([10, 10, 10, 10]);
    expect(new Set(all.map((l) => KEY[l.key])).size).toBe(40);
  });

  it('gives each letter its K-mode keyword (letter + A5h)', () => {
    for (const l of letters) expect(l.keyword, l.key).toBe(printed(name(l.key.charCodeAt(0) + 0xa5)));
  });

  it('gives each letter its extended-mode word (022Ch) above, and with a shift (0246h) below', () => {
    for (const l of letters) {
      expect(l.extended, l.key).toBe(printed(name(rom[0x022c + letterIndex(l.key)])));
      expect(l.extendedShifted, l.key).toBe(printed(name(rom[0x0246 + letterIndex(l.key)])));
    }
  });

  it('gives each letter what SYMBOL SHIFT types with it (026Ah)', () => {
    for (const l of letters) expect(l.symbol, l.key).toBe(printed(name(rom[0x026a + letterIndex(l.key)])));
  });

  it('gives each digit its extended-mode word with SYMBOL SHIFT (0284h) below', () => {
    for (const l of digits) expect(l.extendedShifted, l.key).toBe(printed(name(rom[0x0284 + Number(l.key)])));
  });

  it('gives each digit with CAPS SHIFT the editing function of its control code (0260h)', () => {
    const fn: Record<number, string> = { 0x07: 'EDIT', 0x06: 'CAPS LOCK', 0x04: 'TRUE VIDEO', 0x05: 'INV. VIDEO', 0x08: '⇦', 0x0a: '⇩', 0x0b: '⇧', 0x09: '⇨', 0x0f: 'GRAPHICS', 0x0c: 'DELETE' };
    for (const l of digits) expect(l.capsShifted, l.key).toBe(fn[rom[0x0260 + Number(l.key)]]);
  });

  it('puts above each digit the colour it selects, and on it the block graphic it types (80h + digit, 8 is 80h)', () => {
    for (const l of digits) {
      const d = Number(l.key);
      expect(l.colour, l.key).toBe(d <= 7 ? d : undefined);
      if (d >= 1 && d <= 8) expect(l.graphic, l.key).toBe(d & 7);
    }
  });

  it('agrees with the ROM’s main key table (0205h) on what each key is', () => {
    for (const l of [...letters, ...digits]) {
      const code = KEY[l.key];
      const r = Math.floor(code / 5);
      const b = code % 5;
      expect(String.fromCharCode(rom[0x0205 + (4 - b) * 8 + (7 - r)]), l.key).toBe(l.key);
    }
  });
});
