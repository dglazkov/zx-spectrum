import { describe, expect, it } from 'vitest';
import { loadKeys, romReady } from './typer';

const screen = (rows: Record<number, string>) => Array.from({ length: 24 }, (_, r) => (rows[r] ?? '').padEnd(32)).join('\n');

describe('loading a tape by itself', () => {
  it('types LOAD "" on a 48K and ENTER on the 128’s menu', () => {
    expect(loadKeys('48k')).toEqual([[33], [36, 25], [36, 25], [30]]);
    expect(loadKeys('plus3')).toEqual([[30]]);
  });

  it('waits for the ROM to say it is ready: the copyright on the bottom line, or the menu', () => {
    expect(romReady(screen({}), false)).toBe(false);
    expect(romReady(screen({ 23: '© 1982 Sinclair Research Ltd' }), false)).toBe(true);
    expect(romReady(screen({ 23: '© 1982 Amstrad' }), false)).toBe(true);
    expect(romReady(screen({ 5: '© 1982 Sinclair Research Ltd' }), false)).toBe(false);
    expect(romReady(screen({ 8: '       ▒Tape Loader ▒' }), true)).toBe(true);
    expect(romReady(screen({ 8: '       ▒Loader      ▒' }), true)).toBe(true);
    expect(romReady(screen({ 23: '© 1982 Sinclair Research Ltd' }), true)).toBe(false);
  });
});
