// Which of an entry's files to load, and on which machine. ZXDB lists every release's files: tapes as they were sold
// (TZX, which keeps a custom loader as it was) and as plain blocks (TAP), snapshots, disks, demos, fixes. The page
// takes the original release's tape, a TZX before a TAP, then a re-release's, then a snapshot; on a 128K, a file made
// for the 128K before one for both; the plain file before a variant, and the game as sold before a demo, a prototype or
// a fix. It loads only what ZXDB lists as Available.

import type { Model } from '../emulator/emulator';
import type { ZxEntry, ZxFile } from './zxinfo';

export type FileKind = 'tape' | 'snapshot';

export interface Choice {
  readonly file: ZxFile;
  readonly kind: FileKind;
  /** The machine to load it on. */
  readonly model: Model;
}

/** Why an entry cannot be loaded, said to the person. */
export class Unloadable extends Error {
  override name = 'Unloadable';
}

/** The machine for ZXDB's machine type, or null for one this is not (a ZX81, a Timex, the Next, a SAM). */
export function machineFor(machineType: string | null): Model | null {
  const m = machineType ?? 'ZX-Spectrum 48K';
  if (!/^ZX-Spectrum|^Pentagon|^Scorpion/.test(m)) return null;
  if (/Next|Spectrum \+?2B|ZX-Spectrum 128 \+2B/.test(m)) return null;
  if (/Pentagon|Scorpion/.test(m)) return 'pentagon';
  if (/\+3/.test(m)) return 'plus3';
  if (/\+2A/.test(m)) return 'plus2a';
  if (/\+2/.test(m)) return 'plus2';
  if (/128/.test(m)) return '128k'; // "128K", and "48K/128K": the 128's sound, where the game has it
  if (m === 'ZX-Spectrum 16K') return '16k';
  return '48k';
}

/** The kind of a file by its format, its type and its name, or null for one the emulator does not load (a disk, a cartridge, a picture). */
export function kindOf(file: ZxFile): FileKind | null {
  const name = file.path.toLowerCase().replace(/\.zip$/, '');
  if (/\.(tzx|tap|csw|pzx)$/.test(name) || /\((TZX|TAP|CSW|PZX)\)/.test(file.format)) return 'tape';
  if (/\.(z80|sna|szx)$/.test(name) || /\((Z80|SNA|SZX)\)/.test(file.format)) return 'snapshot';
  return null;
}

const FORMAT_ORDER = ['tzx', 'tap', 'pzx', 'csw', 'z80', 'szx', 'sna'];

function format(file: ZxFile): number {
  const name = file.path.toLowerCase().replace(/\.zip$/, '');
  const i = FORMAT_ORDER.findIndex((f) => name.endsWith(`.${f}`));
  return i < 0 ? FORMAT_ORDER.length : i;
}

/** A file named for one machine: "Cybernoid128.tap", "Exolon(128K)", "Game(48K)". */
function namedFor(file: ZxFile): '48' | '128' | null {
  const name = file.path.split('/').pop() ?? '';
  const says128 = /128/.test(name);
  const says48 = /(^|[^0-9])48(k|\b|[^0-9])/i.test(name);
  if (says128 && !says48) return '128';
  if (says48 && !says128) return '48';
  return null;
}

/** Something other than the game as it was sold: a demo, a prototype, a fix, a hack, a version for other hardware. */
function isAside(file: ZxFile): boolean {
  return !/^(Tape|Snapshot) image$/.test(file.type) || /demo|pre-?production|prototype|beta|ulaplus|bugfix|hack|cheat|trainer|unofficial|mix\b/i.test(`${file.path} ${file.comments ?? ''}`);
}

/**
 * Among files of one kind and release: the plain one first, then one that says only which version it is (the later
 * first: "v1.2" before "v1.0"), then one that says it is different some other way ("Large Case", "Inlay Misprint").
 */
function variant(file: ZxFile): number {
  const c = (file.comments ?? '').trim();
  if (!c) return 0;
  const v = /\bv(?:ersion)?\s*([0-9]+(?:\.[0-9]+)?)/i.exec(c);
  if (v && c.replace(v[0], '').replace(/[()\s0-9k]/gi, '') === '') return 1 - Number(v[1]) / 100;
  return 2;
}

/** The file to load for `entry`, and the machine; throws Unloadable with the reason when there is none. */
export function choose(entry: ZxEntry): Choice {
  if (entry.availability !== 'Available') {
    throw new Unloadable(`${entry.title}: ZXDB lists it as ${(entry.availability ?? 'not available').toLowerCase()}, so it is not loaded here.`);
  }
  const model = machineFor(entry.machine);
  if (!model) throw new Unloadable(`${entry.title} is for the ${entry.machine}, which this is not.`);
  const wants128 = model !== '48k' && model !== '16k';
  type Candidate = { file: ZxFile; kind: FileKind; release: number; order: number };
  const candidates: Candidate[] = [];
  entry.releases.forEach((files, release) =>
    files.forEach((file, order) => {
      const kind = kindOf(file);
      if (kind) candidates.push({ file, kind, release, order });
    }),
  );
  if (!candidates.length) {
    const has = [...new Set(entry.releases.flat().map((f) => f.type))].join(', ');
    throw new Unloadable(`The archive has no tape or snapshot of ${entry.title}${has ? ` (only ${has.toLowerCase()})` : ''}.`);
  }
  // Each key is smaller for the better file; the first that differs decides.
  const key = (c: Candidate): number[] => {
    const named = namedFor(c.file);
    const original = /^Original/.test(c.file.origin ?? '') || (c.release === 0 && !/^Re-release/.test(c.file.origin ?? ''));
    return [
      c.kind === 'tape' ? 0 : 1,
      isAside(c.file) ? 1 : 0,
      // On a 128K, a file made for it first, then one for both, then one for the 48K; on a 48K, anything but a 128K's.
      wants128 ? (named === '128' ? 0 : named === null ? 1 : 2) : named === '128' ? 2 : 0,
      original ? 0 : 1,
      format(c.file),
      variant(c.file),
      c.release,
      c.order,
    ];
  };
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  let best = candidates[0];
  let bestKey = key(best);
  for (const c of candidates.slice(1)) {
    const k = key(c);
    if (better(k, bestKey)) [best, bestKey] = [c, k];
  }
  return { file: best.file, kind: best.kind, model };
}
