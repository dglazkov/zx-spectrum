// The play cards (card.ts), a module a game in this directory, each exporting its card as `card`. They are found here
// by Vite, so that adding a game is adding its module and nothing else.

import type { GameCard } from '../card';

const modules = import.meta.glob<{ card: GameCard }>(['./*.ts', '!./index.ts', '!./*.test.ts'], { eager: true });

/** Every card, by ZXDB id. */
export const CARDS: Readonly<Record<string, GameCard>> = Object.fromEntries(
  Object.values(modules).map((m) => [m.card.id, m.card]),
);

/** The card for a ZXDB entry, if the shelf has one. Ids are seven digits; a shorter one is padded. */
export function cardFor(id: string | null | undefined): GameCard | null {
  return id ? (CARDS[id.padStart(7, '0')] ?? null) : null;
}
