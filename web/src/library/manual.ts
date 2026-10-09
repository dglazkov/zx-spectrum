// A game's manual: its instructions as the archive keeps them (plain text, from the cassette's inlay and the
// magazines), with the parts about the keys and the joystick picked out to show first. How to get from a game's
// first screen to playing, where it has been worked out, is library/start.ts's.

import { fetchArchive, type ZxEntry } from './zxinfo';

export interface Manual {
  /** The whole text, its line ends made plain. */
  readonly text: string;
  /** The sections about the keys and joysticks: a heading and its lines. */
  readonly keys: readonly { heading: string; lines: readonly string[] }[];
  /** The best table of keys among them, as rows of cells ("A", "Joystick UP", "CLIMB UP if on ladder…"), or null. */
  readonly table: { heading: string; rows: readonly (readonly string[])[] } | null;
}

/** A line of a table of keys, as its cells: a key (or a few), and what it does, set apart by spaces, a dash, = or :. */
export function keyRow(line: string): string[] | null {
  const t = line.trim();
  if (!t || t.length > 120) return null;
  let cells = t.split(/\s{2,}|\t+|\s*\.{3,}\s*/).filter(Boolean);
  if (cells.length < 2) {
    const m = /^(.{1,24}?)\s+[-=:]\s+(.+)$/.exec(t);
    if (!m) return null;
    cells = [m[1], m[2]];
  }
  return cells[0].length <= 24 ? cells.map((c) => c.trim()) : null;
}

/** Whether a line heads a section: underlined with dashes or equals signs, or a short line in capitals. */
function heading(line: string, next: string | undefined): boolean {
  const t = line.trim();
  if (!t || t.length > 48) return false;
  if (next !== undefined && /^\s*[-=_]{3,}\s*$/.test(next) && !/^[-=_]+$/.test(t)) return true;
  return /^[A-Z][A-Z0-9 &'/:()-]{2,}$/.test(t) && /[A-Z]{3}/.test(t);
}

/** The manual from its text: the sections whose heading speaks of keys, controls or joysticks. */
export function readManual(raw: string): Manual {
  const text = raw.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[  ]+$/gm, '').trim();
  const lines = text.split('\n');
  const keys: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (heading(line, lines[i + 1])) {
      current = /control|keys?\b|keyboard|joystick/i.test(line) ? { heading: line.trim(), lines: [] } : null;
      if (current) keys.push(current);
      if (/^\s*[-=_]{3,}\s*$/.test(lines[i + 1] ?? '')) i++;
      continue;
    }
    if (current && current.lines.length < 24) current.lines.push(line);
  }
  for (const k of keys) while (k.lines.length && !k.lines.at(-1)?.trim()) k.lines.pop();
  // The table: the section with the most rows of keys, its first run of them (before its notes); rows that name a
  // Spectrum key (A, SPACE, CAPS SHIFT) count for more than ones that name a direction (UP, FIRE).
  let table: Manual['table'] = null;
  let best = 0;
  const isKey = (c: string) => /^([A-Z0-9]|SPACE|ENTER|CAPS SHIFT|SYMBOL SHIFT|SYM(BOL)? SHIFT|BREAK|CAPS)( ?([/,&]|or|and) ?([A-Z0-9]|SPACE|ENTER))*$/i.test(c.trim());
  for (const k of keys) {
    const rows: string[][] = [];
    for (const line of k.lines) {
      const row = keyRow(line);
      if (row) rows.push(row);
      else if (rows.length && !line.trim()) break;
      else if (rows.length >= 2) break;
    }
    const score = rows.length + 0.5 * rows.filter((r) => isKey(r[0])).length;
    if (rows.length >= 2 && score > best) {
      best = score;
      table = { heading: k.heading, rows: rows.slice(0, 14) };
    }
  }
  return { text, keys: keys.filter((k) => k.lines.some((l) => l.trim())), table };
}

const cache = new Map<string, Promise<Manual>>();

/** The entry's manual, fetched through the page's server (once a page), or null where the archive has none. */
export function fetchManual(entry: ZxEntry, signal?: AbortSignal): Promise<Manual> | null {
  const path = entry.instructions;
  if (!path) return null;
  let pending = cache.get(path);
  if (!pending) {
    // The archive's texts are ASCII, some with Windows' quotes and pound signs.
    pending = fetchArchive(path, undefined, signal).then((bytes) => readManual(new TextDecoder('windows-1252').decode(bytes)));
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
  }
  return pending;
}
