// The play cards (card.ts), a module a game in this directory, each exporting its card as `card` and its words in
// Russian as `ru` (card.ts's cardWords, by their English). They are found here by Vite, so that adding a game is
// adding its module and nothing else; their Russian joins the page's (i18n.ts).

import { addWords } from '../../i18n/i18n';
import type { CardWords, GameCard } from '../card';

const modules = import.meta.glob<{ card: GameCard; ru?: CardWords }>(['./*.ts', '!./index.ts', '!./*.test.ts'], { eager: true });

/** Every card, by ZXDB id. */
export const CARDS: Readonly<Record<string, GameCard>> = Object.fromEntries(
  Object.values(modules).map((m) => [m.card.id, m.card]),
);

/** Every card's words in Russian, by the card's ZXDB id (empty for a card with none yet). */
export const CARD_WORDS_RU: Readonly<Record<string, CardWords>> = Object.fromEntries(
  Object.values(modules).map((m) => [m.card.id, m.ru ?? {}]),
);

for (const words of Object.values(CARD_WORDS_RU)) addWords('ru', words);

/** The card for a ZXDB entry, if the shelf has one. Ids are seven digits; a shorter one is padded. */
export function cardFor(id: string | null | undefined): GameCard | null {
  return id ? (CARDS[id.padStart(7, '0')] ?? null) : null;
}
