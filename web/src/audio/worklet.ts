// The audio thread: plays the frames' samples the page sends, in the order they come, and says how many it has
// played, so that the page can run frames as they are needed (clock/scheduler.ts). Nothing here allocates in
// process(): a collection on the audio thread is a dropout.
//
// Messages in: { t: 'frame', samples } (stereo interleaved, transferred), { t: 'clear', generation } (drop what is
// queued and count from 0 again). Messages out: { t: 'played', generation, played, queued, underruns } whenever a
// frame's samples have all been played, and every few blocks while there is nothing to play; `generation` is the last
// clear's, so that the page can tell a report from before it.

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, processor: unknown): void;

export type ToWorklet = { t: 'frame'; samples: Float32Array } | { t: 'clear'; generation: number };
export type FromWorklet = { t: 'played'; generation: number; played: number; queued: number; underruns: number };

/** How fast the output falls to silence when the queue runs dry, a sample: a click becomes a 5 ms fade. */
const FADE = Math.exp(-1 / (0.005 * (typeof sampleRate === 'number' ? sampleRate : 48_000)));

class FrameProcessor extends AudioWorkletProcessor {
  private readonly chunks: Float32Array[] = [];
  private head = 0; // sample frames of chunks[0] played
  private played = 0;
  private queued = 0;
  private underruns = 0;
  private generation = 0;
  private starving = true;
  private starvedBlocks = 0;
  private left = 0;
  private right = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => {
      const m = e.data;
      if (m.t === 'frame') {
        this.chunks.push(m.samples);
        this.queued += m.samples.length >> 1;
      } else if (m.t === 'clear') {
        this.chunks.length = 0;
        this.head = 0;
        this.queued = 0;
        this.played = 0;
        this.generation = m.generation;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    let finished = false;
    for (let i = 0; i < L.length; i++) {
      const chunk = this.chunks[0];
      if (!chunk) {
        if (!this.starving && this.played > 0) this.underruns++;
        this.starving = true;
        this.left *= FADE;
        this.right *= FADE;
      } else {
        this.starving = false;
        const j = this.head << 1;
        this.left = chunk[j];
        this.right = chunk[j + 1];
        this.played++;
        this.queued--;
        if (++this.head << 1 >= chunk.length) {
          this.chunks.shift();
          this.head = 0;
          finished = true;
        }
      }
      L[i] = this.left;
      if (R !== L) R[i] = this.right;
    }
    if (finished || (this.starving && ++this.starvedBlocks % 8 === 0)) {
      this.port.postMessage({ t: 'played', generation: this.generation, played: this.played, queued: this.queued, underruns: this.underruns } satisfies FromWorklet);
    }
    return true;
  }
}

registerProcessor('zx-frames', FrameProcessor);
