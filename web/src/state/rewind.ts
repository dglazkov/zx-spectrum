// Going back in time: the page keeps the machine's whole state every so often (with the picture it showed then, to
// show while choosing), the last minute or two of them, and can put any of them back.

export interface Moment {
  /** Where in the machine's history it was kept: frames run, less those undone by going back. */
  readonly frame: number;
  readonly state: Uint8Array;
  /** The picture then (palette indices). */
  readonly picture: Uint8Array;
}

export class Rewind {
  private moments: Moment[] = [];
  private size = 0;

  /**
   * A moment every `every` frames (50: a second on the 48K), `keep` of them at most (120: two minutes), and no more
   * than `maxBytes` of them in all.
   */
  constructor(
    readonly every = 50,
    readonly keep = 120,
    readonly maxBytes = 96 * 1024 * 1024,
  ) {}

  /** Whether a moment is due at `frame`. */
  due(frame: number): boolean {
    const last = this.moments.at(-1);
    return !last || frame - last.frame >= this.every || frame < last.frame;
  }

  add(moment: Moment): void {
    this.moments.push(moment);
    this.size += moment.state.length + moment.picture.length;
    while (this.moments.length > this.keep || (this.size > this.maxBytes && this.moments.length > 1)) {
      const old = this.moments.shift();
      if (old) this.size -= old.state.length + old.picture.length;
    }
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
    for (const later of this.moments.splice(i + 1)) this.size -= later.state.length + later.picture.length;
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
