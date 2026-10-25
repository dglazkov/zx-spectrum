// What the page tells nerd of its use (`nerd guide telemetry`): a few events, each a step of playing a game or how it
// ended, posted to the server's /nerd/event (crux's part telemetry, in crates/app), which prints it as one line; and
// told to nerd's feedback widget (crux's part widget, loaded first in index.html), so that the last few go with what the
// person sends.
//
// Events are counted, never of anyone: no title, no file name, no number of an entry, only the kinds the page names.
//
//   game.loaded     a game is in the machine (kind: shelf, search, link, file, snapshot; ms: fetching it)
//   game.failed     a game asked for did not get there (kind: fetch, refused)
//   game.started    its play has begun (kind: button, the Start button got there; hand, the person started it;
//                   ms: from loaded)
//   game.played     how long it was played (ms), as the person goes on to another game or leaves the page
//   slot.saved      the machine kept in a save slot (kind: quick, slot)
//   slot.restored   a save slot put back (kind: quick, slot)
//   rewind.used     back to a moment kept for rewinding
//   machine.stopped the machine stopped (the module trapped, a frame threw)

declare global {
  interface Window {
    nerdFeedback?: { open(): void; close(): void; event(name: string): void; shortcut(keys: string): void };
  }
}

export type EventName = 'game.loaded' | 'game.failed' | 'game.started' | 'game.played' | 'slot.saved' | 'slot.restored' | 'rewind.used' | 'machine.stopped';

export interface EventMore {
  readonly kind?: string;
  readonly n?: number;
  readonly ms?: number;
}

/** The line the server prints for an event: its name and what it says, nothing else. */
export function eventBody(name: EventName, more: EventMore = {}): string {
  const body: Record<string, string | number> = { nerd: 'event', name };
  if (more.kind) body.kind = more.kind;
  if (more.n !== undefined && Number.isFinite(more.n)) body.n = Math.round(more.n);
  if (more.ms !== undefined && Number.isFinite(more.ms)) body.ms = Math.max(0, Math.round(more.ms));
  return JSON.stringify(body);
}

export function emit(name: EventName, more: EventMore = {}): void {
  try {
    window.nerdFeedback?.event(name);
    // keepalive: one sent as the page goes (game.played) still arrives.
    void fetch('/nerd/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: eventBody(name, more), keepalive: true }).catch(() => {});
  } catch {
    // Telemetry never stands in the way of the machine.
  }
}

/** nerd's feedback card, from the page's own entries (Settings, the Keys sheet, F7). */
export function openFeedback(): void {
  window.nerdFeedback?.open();
}

/** The key that opens it: one the Spectrum's keyboard has not got, and the page uses for nothing else. */
export const FEEDBACK_KEY = 'F7';
