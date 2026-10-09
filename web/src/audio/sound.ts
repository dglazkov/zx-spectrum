// The sound card: an AudioContext with the frame worklet (worklet.ts) feeding a gentle high-pass (the beeper sits at
// one level or the other when quiet, which a television's speaker never passed on) and a volume control. It can only
// be made once the person has done something on the page: browsers hold sound back until then.

import workletUrl from './worklet.ts?worker&url';
import type { FromWorklet, ToWorklet } from './worklet';

export class Sound {
  readonly context: AudioContext;
  readonly rate: number;
  private readonly node: AudioWorkletNode;
  private readonly gain: GainNode;
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
    this.gain = new GainNode(context, { gain: this.volume });
    node.connect(highPass).connect(this.gain).connect(context.destination);
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
