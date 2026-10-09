// Save slots, a few for each game, kept in this browser (IndexedDB): the machine's whole state, a snapshot of it to
// fall back on (a state is for the build that made it; a later page may not read it), a small picture, and the tape
// the game came on, so that a game saved one day loads the next with its tape in the deck. Storage can be missing or
// refuse (a private window, blocked site data, a full disk): every access is wrapped, and the slots then last as
// long as the page, in memory. A page that opens the store at a newer version (a later build, in another tab) has it:
// this one lets go of it at once, and goes on in memory, rather than leave the newer one waiting.

export interface Slot {
  /** `${game}:${slot}` */
  readonly id: string;
  /** What the slots are for: `zxdb:0004293` for a game from the library, `file:<name>` for one opened, `basic`. */
  readonly game: string;
  /** 0 is the quick slot (F2 and F4); 1–3 are chosen. */
  readonly slot: number;
  readonly title: string;
  readonly savedAt: number;
  readonly state: Uint8Array;
  readonly snapshot: Uint8Array;
  /** The picture then, small: palette indices, THUMB_WIDTH × THUMB_HEIGHT (a slot of an older page has the whole frame, 352 × 296). */
  readonly picture: Uint8Array;
}

export interface SavedTape {
  readonly game: string;
  readonly name: string;
  readonly bytes: Uint8Array;
}

export const SLOTS = 4;

/** A slot's picture: the paper and 16 pixels of border around it, every third pixel. */
export const THUMB_WIDTH = 96;
export const THUMB_HEIGHT = 72;

/** The small picture of a frame (352 × 296 palette indices) a slot keeps. */
export function thumbnailOf(frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(THUMB_WIDTH * THUMB_HEIGHT);
  for (let y = 0; y < THUMB_HEIGHT; y++)
    for (let x = 0; x < THUMB_WIDTH; x++) out[y * THUMB_WIDTH + x] = frame[Math.min(295, 32 + y * 3 + 1) * 352 + Math.min(351, 32 + x * 3 + 1)] & 15;
  return out;
}

const DB = 'zx-spectrum';
const VERSION = 1;

/** Promises of IndexedDB's requests. */
function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class Saves {
  private db: Promise<IDBDatabase | null>;
  /** Where IndexedDB is not to be had, or refused a slot: the slots of this page only. */
  private readonly memory = new Map<string, Slot>();
  private readonly tapes = new Map<string, SavedTape>();
  /** The store has been let go (a newer page wants it): memory from here on. */
  private closed = false;

  constructor(factory: IDBFactory | null = globalThis.indexedDB ?? null) {
    this.db = this.open(factory);
  }

  private async open(factory: IDBFactory | null): Promise<IDBDatabase | null> {
    try {
      if (!factory) return null;
      const req = factory.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'id' }).createIndex('game', 'game');
        if (!db.objectStoreNames.contains('tapes')) db.createObjectStore('tapes', { keyPath: 'game' });
      };
      const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        // An older page holds the store open at its version: this one goes on in memory rather than wait for it.
        req.onblocked = () => resolve(null);
      });
      if (db) {
        db.onversionchange = () => {
          db.close();
          this.closed = true;
        };
        db.onclose = () => (this.closed = true);
      }
      return db;
    } catch {
      return null;
    }
  }

  private async store(name: 'slots' | 'tapes', mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
    try {
      const db = await this.db;
      return db && !this.closed ? db.transaction(name, mode).objectStore(name) : null;
    } catch {
      return null;
    }
  }

  /** The slots kept for `game`, by number (a missing one is empty). */
  async list(game: string): Promise<(Slot | null)[]> {
    const out: (Slot | null)[] = Array.from({ length: SLOTS }, () => null);
    let found: Slot[] = [];
    try {
      const store = await this.store('slots', 'readonly');
      if (store) found = await done(store.index('game').getAll(game) as IDBRequest<Slot[]>);
    } catch {
      // As far as memory goes.
    }
    for (const s of this.memory.values()) if (s.game === game) found.push(s);
    for (const s of found) if (s.slot >= 0 && s.slot < SLOTS && (!out[s.slot] || out[s.slot]!.savedAt < s.savedAt)) out[s.slot] = s;
    return out;
  }

  async get(game: string, slot: number): Promise<Slot | null> {
    const id = `${game}:${slot}`;
    let stored: Slot | null = null;
    try {
      const store = await this.store('slots', 'readonly');
      if (store) stored = ((await done(store.get(id))) as Slot | undefined) ?? null;
    } catch {
      // As far as memory goes.
    }
    const kept = this.memory.get(id) ?? null;
    return kept && (!stored || kept.savedAt > stored.savedAt) ? kept : stored;
  }

  /** Keeps `slot` (and the game's tape, when there is one): true if it went to storage, false if only to memory. */
  async put(slot: Slot, tape: SavedTape | null): Promise<boolean> {
    try {
      const slots = await this.store('slots', 'readwrite');
      if (slots) {
        await done(slots.put(slot));
        if (tape) {
          const tapes = await this.store('tapes', 'readwrite');
          if (tapes) await done(tapes.put(tape));
        }
        this.memory.delete(slot.id);
        return true;
      }
    } catch {
      // Kept in memory instead.
    }
    this.memory.set(slot.id, slot);
    if (tape) this.tapes.set(tape.game, tape);
    return false;
  }

  async tape(game: string): Promise<SavedTape | null> {
    try {
      const store = await this.store('tapes', 'readonly');
      if (store) {
        const t = (await done(store.get(game))) as SavedTape | undefined;
        if (t) return t;
      }
    } catch {
      // As far as memory goes.
    }
    return this.tapes.get(game) ?? null;
  }

  async remove(game: string, slot: number): Promise<void> {
    const id = `${game}:${slot}`;
    this.memory.delete(id);
    try {
      const store = await this.store('slots', 'readwrite');
      if (store) await done(store.delete(id));
    } catch {
      // Gone from memory, at least.
    }
  }
}
