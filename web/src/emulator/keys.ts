// The Spectrum's forty keys, numbered as the ULA reads them: half-row r (0–7, by the address line that selects it)
// and bit b (0–4) make key r × 5 + b (docs/architecture.md). This is the only numbering of keys in the page.

/** The keys of each half-row, from bit 0. */
export const HALF_ROWS: readonly (readonly string[])[] = [
  ['CAPS SHIFT', 'Z', 'X', 'C', 'V'], // FEFE
  ['A', 'S', 'D', 'F', 'G'], // FDFE
  ['Q', 'W', 'E', 'R', 'T'], // FBFE
  ['1', '2', '3', '4', '5'], // F7FE
  ['0', '9', '8', '7', '6'], // EFFE
  ['P', 'O', 'I', 'U', 'Y'], // DFFE
  ['ENTER', 'L', 'K', 'J', 'H'], // BFFE
  ['SPACE', 'SYMBOL SHIFT', 'M', 'N', 'B'], // 7FFE
];

/** A key's code from its name ('A', '7', 'ENTER', 'CAPS SHIFT', ...). */
export const KEY: Readonly<Record<string, number>> = Object.fromEntries(
  HALF_ROWS.flatMap((row, r) => row.map((name, b) => [name, r * 5 + b])),
);

/** A key's name from its code. */
export const KEY_NAME: readonly string[] = HALF_ROWS.flat();

export const CAPS_SHIFT = KEY['CAPS SHIFT'];
export const SYMBOL_SHIFT = KEY['SYMBOL SHIFT'];
export const ENTER = KEY.ENTER;
export const SPACE = KEY.SPACE;

/** The keyboard's rows as they lie on the case, top to bottom, left to right. */
export const LAYOUT: readonly (readonly string[])[] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'ENTER'],
  ['CAPS SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'SYMBOL SHIFT', 'SPACE'],
];
