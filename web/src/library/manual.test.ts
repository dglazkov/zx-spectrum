import { describe, expect, it } from 'vitest';
import { keyRow, readManual } from './manual';

// Laid out as the archive's texts are (the database's summary, then the inlay's own words), in words of our own.
const TEXT = [
  'THE GAME',
  '',
  'CONTROLS',
  'Keyboard or joystick.',
  '',
  'UP - Jump',
  'DOWN - Duck',
  'FIRE - Throw',
  '',
  'INSTRUCTIONS',
  'Find the disk.',
  '',
  'Keys',
  '----',
  'Q       Joystick UP     CLIMB or KICK',
  'A       Joystick DOWN   DUCK',
  'O ..... left',
  'SPACE   Joystick FIRE   THROW',
  '',
  'NB: up with left or right jumps.',
  '',
  'Loading',
  '-------',
  'LOAD ""',
].join('\r\n');

describe('a game’s manual', () => {
  it('finds the sections about the keys, and the best table of them', () => {
    const m = readManual(TEXT);
    expect(m.text.includes('\r')).toBe(false);
    expect(m.keys.map((k) => k.heading)).toEqual(['CONTROLS', 'Keys']);
    expect(m.table?.heading).toBe('Keys');
    expect(m.table?.rows).toEqual([
      ['Q', 'Joystick UP', 'CLIMB or KICK'],
      ['A', 'Joystick DOWN', 'DUCK'],
      ['O', 'left'],
      ['SPACE', 'Joystick FIRE', 'THROW'],
    ]);
  });

  it('reads a row of keys however it is set out, and not a sentence', () => {
    expect(keyRow('Z = left')).toEqual(['Z', 'left']);
    expect(keyRow('CAPS SHIFT : pause')).toEqual(['CAPS SHIFT', 'pause']);
    expect(keyRow('You can use the keyboard or a joystick.')).toBeNull();
    expect(keyRow('')).toBeNull();
  });

  it('has no table where the manual lists no keys', () => {
    expect(readManual('STORY\nOnce upon a time.\n').table).toBeNull();
  });
});
