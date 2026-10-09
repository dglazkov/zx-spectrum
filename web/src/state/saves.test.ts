import { describe, expect, it } from 'vitest';
import { Saves, THUMB_HEIGHT, THUMB_WIDTH, thumbnailOf, type Slot } from './saves';

const slot = (game: string, n: number, byte = n): Slot => ({ id: `${game}:${n}`, game, slot: n, title: game, savedAt: 1, state: new Uint8Array([byte]), snapshot: new Uint8Array(0), picture: new Uint8Array(4) });

// Where there is no IndexedDB (Node here; a private window, blocked site data), the slots last as long as the page.
describe('save slots without storage', () => {
  it('keep each game’s slots apart, by number, and its tape', async () => {
    const saves = new Saves(null);
    expect(await saves.put(slot('zxdb:0004293', 0), { game: 'zxdb:0004293', name: 's.tzx', bytes: new Uint8Array([1, 2]) })).toBe(false);
    await saves.put(slot('zxdb:0004293', 2), null);
    await saves.put(slot('basic', 0, 9), null);
    expect((await saves.list('zxdb:0004293')).map((s) => s?.slot ?? null)).toEqual([0, null, 2, null]);
    expect((await saves.get('basic', 0))?.state[0]).toBe(9);
    expect((await saves.tape('zxdb:0004293'))?.name).toBe('s.tzx');
    expect(await saves.tape('basic')).toBeNull();
    await saves.remove('zxdb:0004293', 0);
    expect(await saves.get('zxdb:0004293', 0)).toBeNull();
  });

  it('survive an IndexedDB that refuses to open', async () => {
    const refusing = { open: () => { throw new Error('SecurityError'); } } as unknown as IDBFactory;
    const saves = new Saves(refusing);
    await saves.put(slot('basic', 1), null);
    expect((await saves.list('basic'))[1]?.slot).toBe(1);
  });
});

describe('save slots when another page holds the store', () => {
  it('go on in memory rather than wait for it (an older page open at an older version)', async () => {
    // The open request is blocked, and never succeeds while the test runs.
    const blocked = {
      open: () => {
        const req = {} as { onblocked?: () => void; onsuccess?: () => void; onerror?: () => void; onupgradeneeded?: () => void };
        setTimeout(() => req.onblocked?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    const saves = new Saves(blocked);
    expect(await saves.put(slot('basic', 3), null)).toBe(false);
    expect((await saves.list('basic'))[3]?.slot).toBe(3);
  });
});

describe('a slot’s picture', () => {
  it('is the paper and a little border, small', () => {
    const frame = new Uint8Array(352 * 296).fill(7);
    frame[(32 + 1) * 352 + 32 + 1] = 2; // the first sample: red
    const t = thumbnailOf(frame);
    expect(t.length).toBe(THUMB_WIDTH * THUMB_HEIGHT);
    expect(t[0]).toBe(2);
    expect(t[1]).toBe(7);
  });
});
