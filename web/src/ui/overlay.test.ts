import { describe, expect, it } from 'vitest';
import { rememberDismissed, wasDismissed } from './overlay';

/** A store in memory, as localStorage behaves. */
function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('the controls closed for a game', () => {
  it('are remembered for that game alone', () => {
    const store = memory();
    expect(wasDismissed('zxdb:0004293', store)).toBe(false);
    rememberDismissed('zxdb:0004293', store);
    rememberDismissed('zxdb:0004293', store);
    expect(wasDismissed('zxdb:0004293', store)).toBe(true);
    expect(wasDismissed('zxdb:0000722', store)).toBe(false);
    expect(JSON.parse(store.m.get('zx-spectrum.controls-closed')!)).toEqual(['zxdb:0004293']);
  });

  it('keep the last 200 games', () => {
    const store = memory();
    for (let i = 0; i < 205; i++) rememberDismissed(`file:${i}`, store);
    expect(wasDismissed('file:204', store)).toBe(true);
    expect(wasDismissed('file:4', store)).toBe(false);
  });

  it('cost nothing without storage, or with storage that refuses or holds nonsense', () => {
    const refusing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => rememberDismissed('zxdb:0004293', refusing)).not.toThrow();
    expect(wasDismissed('zxdb:0004293', refusing)).toBe(false);
    expect(wasDismissed('zxdb:0004293', null)).toBe(false);
    expect(wasDismissed('zxdb:0004293', { getItem: () => '{not json' })).toBe(false);
  });
});
