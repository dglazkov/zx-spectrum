// What is printed on and around each of the 48K's forty keys.
//
// The words are the ROM's: each legend is what the key gives in that mode, from the 48K ROM's key tables (KEY-TABLE
// at 0205h, the extended-mode tables at 022Ch and 0246h, the control codes at 0260h, symbol shift at 026Ah and 0284h,
// and the keywords a letter gives in K mode, token = letter + A5h), as Logan and O'Hara's "The Complete Spectrum ROM
// Disassembly" sets them out. web/src/keyboard/legends.test.ts reads roms/48.rom and checks every legend against it.
// The spellings are the case's: the keyboard abbreviates and spaces some words differently from the tokens (RAND for
// RANDOMIZE, CONT, GOTO, STR $, L PRINT, IN KEY $), as photographs of a 48K show (docs/web.md lists them).

export interface KeyLegend {
  /** The key's name in keys.ts. */
  readonly key: string;
  /** Large, on the key: the letter or digit, or the key's name. */
  readonly main: string;
  /** Small and white, on the key: the keyword it gives in K mode. */
  readonly keyword?: string;
  /** Red, on the key: what it gives with SYMBOL SHIFT. */
  readonly symbol?: string;
  /** Green, on the case above the key: what it gives in extended mode. */
  readonly extended?: string;
  /** Red, on the case below the key: extended mode with a shift. */
  readonly extendedShifted?: string;
  /** Above a digit key, in its own colour: the colour (0–7) the digit selects in extended mode. */
  readonly colour?: number;
  /** White, above a digit key under its colour: what it does with CAPS SHIFT. */
  readonly capsShifted?: string;
  /** On a digit key, top right: the block graphic it gives in graphics mode (bits: 1 top right, 2 top left, 4 bottom right, 8 bottom left). */
  readonly graphic?: number;
  /** A key wider than the rest. */
  readonly wide?: boolean;
}

/** The colour names, by code, as printed above the digits. */
export const COLOUR_NAMES = ['BLACK', 'BLUE', 'RED', 'MAGENTA', 'GREEN', 'CYAN', 'YELLOW', 'WHITE'] as const;

/** Arrows above 5–8 are drawn rather than printed: these name them. */
export const ARROWS: Readonly<Record<string, 'left' | 'down' | 'up' | 'right'>> = { '⇦': 'left', '⇩': 'down', '⇧': 'up', '⇨': 'right' };

const digit = (d: string, symbol: string, capsShifted: string, extendedShifted: string, colour: number | undefined, graphic: number | undefined): KeyLegend => ({
  key: d,
  main: d,
  symbol,
  capsShifted,
  extendedShifted,
  colour,
  graphic,
});

const letter = (l: string, keyword: string, symbol: string, extended: string, extendedShifted: string): KeyLegend => ({
  key: l,
  main: l,
  keyword,
  symbol,
  extended,
  extendedShifted,
});

/** Row by row, as the keys lie on the case. */
export const LEGENDS: readonly (readonly KeyLegend[])[] = [
  [
    digit('1', '!', 'EDIT', 'DEF FN', 1, 0x1),
    digit('2', '@', 'CAPS LOCK', 'FN', 2, 0x2),
    digit('3', '#', 'TRUE VIDEO', 'LINE', 3, 0x3),
    digit('4', '$', 'INV. VIDEO', 'OPEN #', 4, 0x4),
    digit('5', '%', '⇦', 'CLOSE #', 5, 0x5),
    digit('6', '&', '⇩', 'MOVE', 6, 0x6),
    digit('7', "'", '⇧', 'ERASE', 7, 0x7),
    digit('8', '(', '⇨', 'POINT', undefined, 0x0),
    digit('9', ')', 'GRAPHICS', 'CAT', undefined, undefined),
    digit('0', '_', 'DELETE', 'FORMAT', 0, undefined),
  ],
  [
    letter('Q', 'PLOT', '<=', 'SIN', 'ASN'),
    letter('W', 'DRAW', '<>', 'COS', 'ACS'),
    letter('E', 'REM', '>=', 'TAN', 'ATN'),
    letter('R', 'RUN', '<', 'INT', 'VERIFY'),
    letter('T', 'RAND', '>', 'RND', 'MERGE'),
    letter('Y', 'RETURN', 'AND', 'STR $', '['),
    letter('U', 'IF', 'OR', 'CHR $', ']'),
    letter('I', 'INPUT', 'AT', 'CODE', 'IN'),
    letter('O', 'POKE', ';', 'PEEK', 'OUT'),
    letter('P', 'PRINT', '"', 'TAB', '©'),
  ],
  [
    letter('A', 'NEW', 'STOP', 'READ', '~'),
    letter('S', 'SAVE', 'NOT', 'RESTORE', '|'),
    letter('D', 'DIM', 'STEP', 'DATA', '\\'),
    letter('F', 'FOR', 'TO', 'SGN', '{'),
    letter('G', 'GOTO', 'THEN', 'ABS', '}'),
    letter('H', 'GOSUB', '↑', 'SQR', 'CIRCLE'),
    letter('J', 'LOAD', '-', 'VAL', 'VAL $'),
    letter('K', 'LIST', '+', 'LEN', 'SCREEN $'),
    letter('L', 'LET', '=', 'USR', 'ATTR'),
    { key: 'ENTER', main: 'ENTER' },
  ],
  [
    { key: 'CAPS SHIFT', main: 'CAPS SHIFT', wide: true },
    letter('Z', 'COPY', ':', 'LN', 'BEEP'),
    letter('X', 'CLEAR', '£', 'EXP', 'INK'),
    letter('C', 'CONT', '?', 'L PRINT', 'PAPER'),
    letter('V', 'CLS', '/', 'L LIST', 'FLASH'),
    letter('B', 'BORDER', '*', 'BIN', 'BRIGHT'),
    letter('N', 'NEXT', ',', 'IN KEY $', 'OVER'),
    letter('M', 'PAUSE', '.', 'PI', 'INVERSE'),
    { key: 'SYMBOL SHIFT', main: 'SYMBOL SHIFT' },
    { key: 'SPACE', main: 'SPACE', keyword: 'BREAK', wide: true },
  ],
];

/**
 * Where each row starts and how big its keys are, in key pitches (a pitch is 19 mm on the case), measured from a
 * photograph of a 48K straight from above with its top plate on (Nico Kaiser, docs/web.md), which shows the key faces
 * as they come through the plate: wide and low, 0.72 × 0.52 of a pitch, with half a pitch between rows for the
 * legends printed above and below them. Each row sits further right than the one above it; CAPS SHIFT and BREAK SPACE
 * are wider.
 */
export const GEOMETRY = {
  /** Left edge of each row's first key. */
  rowStart: [0, 0.49, 0.73, -0.04],
  /** A key's face, as a fraction of the pitch. */
  keyWidth: 0.72,
  keyHeight: 0.52,
  /** The wide keys, in pitches. */
  wideWidth: { 'CAPS SHIFT': 0.97, SPACE: 1.22 } as Readonly<Record<string, number>>,
  /** Z starts here (after CAPS SHIFT), and SPACE after SYMBOL SHIFT at this. */
  zStart: 1.23,
  /** Rows apart, in pitches. */
  rowPitch: 1.0,
} as const;
