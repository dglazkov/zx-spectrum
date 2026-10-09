// Going back in time: the page keeps the machine's whole state every so often, the last ten minutes of them, and can
// put any of them back. The real core's state holds the picture it was taken after, which the page reads back to show
// while choosing (Emulator.statePicture); for an emulator whose does not, the picture is kept beside it.

export interface Moment {
  /** Where in the machine's history it was kept: frames run, less those undone by going back. */
  readonly frame: number;
  readonly state: Uint8Array;
  /** The picture then (palette indices), where the state does not hold it. */
  readonly picture?: Uint8Array;
  /** How much of each of the sixteen colours the picture had (a sample of its pixels), for the strip. */
  readonly colours: Uint16Array;
}

/** The colours of a picture, sampled: every 97th pixel. */
export function coloursOf(picture: Uint8Array): Uint16Array {
  const out = new Uint16Array(16);
  for (let i = 0; i < picture.length; i += 97) out[picture[i] & 15]++;
  return out;
}

const sizeOf = (m: Moment) => m.state.length + (m.picture?.length ?? 0) + 32;

export class Rewind {
  private moments: Moment[] = [];
  private size = 0;

  /**
   * A moment every `every` frames (25: half a second on the 48K), `keep` of them at most (1,200: ten minutes), and no
   * more than `maxBytes` of them in all. The core's states are 1.4 KB at BASIC and 20–40 KB in a game (Saboteur's are
   * 34 KB: ten minutes of them are 41 MB); 96 MB holds the longest.
   */
  constructor(
    readonly every = 25,
    readonly keep = 1200,
    readonly maxBytes = 96 * 1024 * 1024,
  ) {}

  /** Whether a moment is due at `frame`, `every` frames after the last (more apart while a tape loads flat out). */
  due(frame: number, every = this.every): boolean {
    const last = this.moments.at(-1);
    return !last || frame - last.frame >= every || frame < last.frame;
  }

  /** Frames of history the moments span, from the first to `now`. */
  span(now: number): number {
    const first = this.moments[0];
    return first ? Math.max(0, now - first.frame) : 0;
  }

  add(moment: Moment): void {
    this.moments.push(moment);
    this.size += sizeOf(moment);
    let drop = 0;
    while (this.moments.length - drop > this.keep || (this.size > this.maxBytes && this.moments.length - drop > 1)) this.size -= sizeOf(this.moments[drop++]);
    if (drop) this.moments.splice(0, drop);
  }

  get length(): number {
    return this.moments.length;
  }

  at(i: number): Moment | undefined {
    return this.moments[i];
  }

  list(): readonly Moment[] {
    return this.moments;
  }

  /** Moment `i`, to go back to: the ones after it are let go, as that future will not happen now. */
  goBack(i: number): Moment | undefined {
    const m = this.moments[i];
    if (!m) return undefined;
    for (const later of this.moments.splice(i + 1)) this.size -= sizeOf(later);
    return m;
  }

  clear(): void {
    this.moments = [];
    this.size = 0;
  }

  get bytes(): number {
    return this.size;
  }
}
