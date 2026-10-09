// The sound card: an AudioContext with the frame worklet (worklet.ts) feeding a gentle high-pass (the beeper sits at
// one level or the other when quiet, which a television's speaker never passed on), a level for the machine, a soft
// limit, and a volume control. It can only be made once the person has done something on the page: browsers hold
// sound back until then.
//
// The level: the machines are as loud as their circuits make them (docs/audio.md), and a 128's AY music comes out
// about 13 dB under a 48K's BEEP, its beeper's span shared with the AY. Levelled (the default), the 128 family is
// lifted by LIFT_128, which brings its beeper to the 48K's and its music most of the way; the soft limit after it
// keeps what would then pass full scale from clipping (nothing under 0.8 is touched).

import workletUrl from './worklet.ts?worker&url';
import type { FromWorklet, ToWorklet } from './worklet';

export class Sound {
  readonly context: AudioContext;
  readonly rate: number;
  private readonly node: AudioWorkletNode;
  private readonly gain: GainNode;
  private readonly lift: GainNode;
  private volume = 0.8;
  private muted = false;
  /** Underruns the worklet has counted: frames that came too late. */
  underruns = 0;
  private generation = 0;

  private constructor(context: AudioContext, node: AudioWorkletNode, onPlayed: (played: number) => void) {
    this.context = context;
    this.rate = context.sampleRate;
    this.node = node;
    const highPass = new BiquadFilterNode(context, { type: 'highpass', frequency: 12, Q: 0.5 });
    // The lift, then the limit: the shaper's curve covers -2 to 2, so the lift's gain halves what it passes it.
    this.lift = new GainNode(context, { gain: 0.5 });
    const limit = new WaveShaperNode(context, { curve: softLimit(), oversample: 'none' });
    this.gain = new GainNode(context, { gain: this.volume });
    node.connect(highPass).connect(this.lift).connect(limit).connect(this.gain).connect(context.destination);
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
      if (e.data.generation !== this.generation) return; // from before the last clear
      this.underruns = e.data.underruns;
      onPlayed(e.data.played);
    };
  }

  /**
   * Sound, made: call from a click's or a key's handler. `onPlayed` hears how many sample frames have been played in
   * all. The context may not be running yet (a gesture the browser does not count, as a touch's pointerdown is not,
   * or the system holding sound back): it is not waited for, as a resume the browser does not allow never settles;
   * `resume()` on a later gesture starts it, and `onState` hears whenever it starts or stops.
   */
  static async start(onPlayed: (played: number) => void): Promise<Sound> {
    const context = new AudioContext({ latencyHint: 'interactive' });
    context.resume().catch(() => {});
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, 'zx-frames', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    return new Sound(context, node, onPlayed);
  }

  /** Asks for the sound card again, if it is not running: from a gesture's handler. */
  resume(): void {
    if (this.context.state !== 'running' && this.context.state !== 'closed') this.context.resume().catch(() => {});
  }

  /** `listener` hears whenever the context starts or stops running (suspended by the system, interrupted, resumed). */
  onState(listener: () => void): void {
    this.context.addEventListener('statechange', listener);
  }

  /** A frame's samples (stereo interleaved), copied: the emulator's buffer is its own. */
  send(samples: Float32Array): void {
    const copy = samples.slice();
    this.node.port.postMessage({ t: 'frame', samples: copy } satisfies ToWorklet, [copy.buffer]);
  }

  /** Forget what is queued and count played samples from 0 again (after a jump in time: a rewind, a reset). */
  clear(): void {
    this.node.port.postMessage({ t: 'clear', generation: ++this.generation } satisfies ToWorklet);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.apply();
  }

  /** The machine's level: 1 as it is, more to lift a quieter one (the 128 family, levelled). */
  setLevel(level: number): void {
    this.lift.gain.setTargetAtTime(0.5 * level, this.context.currentTime, 0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.apply();
  }

  get running(): boolean {
    return this.context.state === 'running';
  }

  private apply(): void {
    this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume * this.volume, this.context.currentTime, 0.015);
  }
}

/** How much the 128 family is lifted when the sound is levelled: +6.8 dB. */
export const LIFT_128 = 2.2;

/** The soft limit's curve, over inputs from -2 to 2: straight to ±0.8, then bending to ±1 and no further. */
export function softLimit(points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 4 - 2;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  return curve;
}
