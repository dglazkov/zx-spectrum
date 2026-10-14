// Every play card in Russian (a card module's `ru`, by its English: card.ts's cardWords): each sentence a person reads
// translated, nothing left over that the card no longer says, a step's keys still named in its Russian (the page sets
// them as keycaps where the words name them: ui/howto.ts's stepNow), and the same English said the same way on every
// card.

import { describe, expect, it } from 'vitest';
import { cardWords } from './card';
import { CARD_WORDS_RU, CARDS } from './games';

const CYRILLIC = /[А-Яа-яЁё]/;

/** Where a step's words name a key, as stepNow finds it: the name, not inside a longer word or number. */
function names(text: string, key: string): boolean {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${k}(?![A-Za-z0-9])`).test(text);
}

describe('the play cards in Russian', () => {
  for (const card of Object.values(CARDS)) {
    describe(card.title, () => {
      const ru = CARD_WORDS_RU[card.id];
      const english = cardWords(card);

      it('has every sentence of the card in Russian', () => {
        const missing = english.filter((en) => !ru[en]);
        expect(missing, `not translated:\n${missing.join('\n')}`).toEqual([]);
        for (const en of english) expect(ru[en], en).toMatch(CYRILLIC);
      });

      it('has nothing the card no longer says', () => {
        const said = new Set(english);
        expect(Object.keys(ru).filter((en) => !said.has(en))).toEqual([]);
      });

      it('names each step’s keys in its Russian, as its English does, so that they show as keycaps', () => {
        for (const step of card.start.steps) {
          const text = ru[step.text];
          if (!text) continue;
          for (const key of step.keys.filter((k) => k !== 'any' && names(step.text, k))) expect(names(text, key), `${key} in: ${text}`).toBe(true);
        }
      });
    });
  }

  it('says the same English the same way on every card', () => {
    const seen = new Map<string, { ru: string; title: string }>();
    const differ: string[] = [];
    for (const card of Object.values(CARDS)) {
      for (const [en, ru] of Object.entries(CARD_WORDS_RU[card.id])) {
        const before = seen.get(en);
        if (before && before.ru !== ru) differ.push(`${en}: “${before.ru}” (${before.title}), “${ru}” (${card.title})`);
        else seen.set(en, { ru, title: card.title });
      }
    }
    expect(differ).toEqual([]);
  });
});
