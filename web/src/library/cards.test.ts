// The play cards' registry (games/index.ts) and every card in it held to the shape the page relies on: the keys it
// names are Spectrum keys, the joystick's are directions and fire, a key map is for a game with no joystick, the
// route's steps name their keys, and its sources are addresses. A card that breaks one of these would break the page
// (its keycaps, its key map, its start button), so it fails here first.

import { describe, expect, it } from 'vitest';
import { KEY } from '../emulator/keys';
import { SHELF } from '../ui/library';
import type { Pad } from './card';
import { CARDS, cardFor } from './games';

const PADS: readonly Pad[] = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'FIRE'];
const isKey = (name: string) => name.split('+').every((k) => KEY[k.trim()] !== undefined);

describe('the play cards', () => {
  it('finds Saboteur’s by its ZXDB id, padded or not, and none for a game without one', () => {
    expect(cardFor('0004293')?.title).toBe('Saboteur!');
    expect(cardFor('4293')?.id).toBe('0004293');
    expect(cardFor('0002514')).toBeNull();
    expect(cardFor(null)).toBeNull();
    expect(cardFor('')).toBeNull();
  });

  for (const card of Object.values(CARDS)) {
    describe(card.title, () => {
      it('is for a game on the shelf, under its own id, with its words filled in', () => {
        expect(card.id).toMatch(/^\d{7}$/);
        expect(CARDS[card.id]).toBe(card);
        expect(SHELF.some((e) => e.id === card.id)).toBe(true);
        for (const words of [card.title, card.blurb, card.goal]) expect(words.trim().length).toBeGreaterThan(3);
        expect(card.tips.length).toBeGreaterThanOrEqual(1);
        expect(card.tips.every((t) => t.trim().length > 3)).toBe(true);
        expect(['48k', '128k']).toContain(card.model);
      });

      it('names controls by the joystick’s directions and fire and by Spectrum keys', () => {
        expect(card.controls.length).toBeGreaterThan(0);
        for (const c of card.controls) {
          expect(c.does.trim().length, JSON.stringify(c)).toBeGreaterThan(1);
          expect(c.pad !== null || c.keys !== null, `${c.does}: neither the joystick nor a key`).toBe(true);
          for (const p of c.pad ?? []) expect(PADS, c.does).toContain(p);
          for (const k of c.keys ?? []) expect(isKey(k), `${c.does}: ${k} is not a Spectrum key`).toBe(true);
        }
        for (const x of card.extras) expect(isKey(x.key), `${x.does}: ${x.key} is not a Spectrum key`).toBe(true);
      });

      it('has a key map only where it takes no joystick, onto Spectrum keys', () => {
        if (!card.keymap) return;
        expect(card.joystick, 'a game that takes a joystick needs no key map').toBe(false);
        for (const [pad, key] of Object.entries(card.keymap)) {
          expect(PADS).toContain(pad);
          expect(isKey(key!), `${pad}: ${key}`).toBe(true);
        }
      });

      it('has a start route a person can read and the page can drive', () => {
        const r = card.start;
        expect(r.steps.length).toBeGreaterThan(0);
        for (const s of r.steps) expect(s.text.trim().length).toBeGreaterThan(3);
        expect(r.within).toBeGreaterThan(0);
        if (r.skills) expect(r.skills[0]).toBeLessThanOrEqual(r.skills[1]);
        // Asked of a blank screen (the machine still loading), a route waits, or is not ready: it does not throw.
        const blank = { text: ' '.repeat(32 * 24), attr: () => 0x38 };
        expect(() => r.ready(blank)).not.toThrow();
        expect(() => r.next(blank, { joystick: true, skill: 1 })).not.toThrow();
      });

      it('says where its facts came from', () => {
        expect(card.sources.length).toBeGreaterThan(0);
        for (const s of card.sources) {
          expect(s.title.trim().length).toBeGreaterThan(3);
          expect(() => new URL(s.url)).not.toThrow();
        }
      });
    });
  }
});
