# Sound: `audio` and `ay`

Two crates. `audio` turns levels that change at T-states into samples a sound card can play, band-limited
and exact in time, through an output stage modelled on what the sound went through on its way to a person's
ear. `ay` is the AY-3-8912 sound chip of the 128K, +2, +3 and Pentagon (and, as a variant, Yamaha's YM2149),
to the register and to the tick, putting its three channels into an `audio` buffer. Neither knows the
Spectrum exists. The last part of this record is for the machine that does: the levels the Spectrum's own
sound pin gives, on the 48K and the 128K, and how loud the beeper is against the AY.

## How the machine uses them

```rust
let mut sound = audio::Buffer::new(3_546_900, 48_000);   // the CPU clock, the host's sample rate
let mut beeper = audio::Level::new();                     // the ULA's sound pin, as a level
let mut psg = ay::Ay::new(ay::Chip::Ay8912, 1_773_450, 3_546_900);
psg.set_mix(ay::Mix { stereo: ay::Stereo::Joined, separation: 1.0, gain: 0.56 });

// During the frame, at the T-state of each I/O write:
beeper.set(&mut sound, t, 0.44 * level_from(ear, mic)); // OUT (0xFE)
psg.select(value);                                       // OUT (0xFFFD)
psg.write(t, value, &mut sound);                         // OUT (0xBFFD)
let byte = psg.read();                                   // IN (0xFFFD): None if the chip leaves the bus alone

// At the frame's end, the chip first, then the buffer:
psg.end_frame(70_908, &mut sound);
sound.end_frame(70_908);
let n = sound.read_samples(&mut interleaved_stereo_f32);
```

Every T-state is one of the frame (0 at the interrupt), as everywhere in the emulator
(docs/architecture.md). A step may be added at or past the frame's length: it is then in the next frame,
where it belongs. Steps can be added in any order. Read the samples every frame; an unread buffer keeps at most
a second. On a rewind or a reset, `sound.clear()` drops what no longer follows on.

## `audio`: the buffer

### Band-limited steps

A level that jumps between two samples cannot be sampled as it is: the jump holds every frequency, and those
above half the sample rate fold back as aliases, the harsh inharmonic fizz of a naively sampled square wave.
What can be sampled is the jump passed through a low-pass filter first. So each step is put into the buffer as
a band-limited step: a windowed sinc, integrated, positioned at the step's exact place between two samples.
This is Shay Green's (blargg's) blip_buf technique. The buffer holds each sample's *change* of level, a step
adding its kernel's taps; reading integrates them back.

- **The kernel.** A sinc cut off at 0.445 of the sample rate, under a Kaiser window (β = 9.5) of half-width 15.5
  samples: 32 taps a step. It is tabulated at 256 positions between two samples, and a position between two of
  those is interpolated linearly (16 bits). The parameters were chosen by measuring the kernel's continuous
  spectrum for a range of widths, cut-offs and window shapes (an FFT of the kernel sampled 256 times a sample):

  | | |
  |---|---|
  | flat within 0.1 dB up to | 0.377 of the rate (16.6 kHz at 44.1 kHz, 18.1 kHz at 48 kHz) |
  | −3 dB at | 0.428 of the rate (18.9 kHz at 44.1 kHz) |
  | rejection of everything that would fold back below 20 kHz | ≥ 95.0 dB at 44.1 kHz, ≥ 96.7 dB at 48 kHz |
  | overshoot of a step (Gibbs) | 8.7% |

- **Exact levels.** The table is integers built from the rounded running integral, so the taps of every
  position add up to exactly 2²⁰, and levels are integers too (`audio::UNIT` = 2²⁰ is a level of 1.0). A step
  of height d adds exactly d × 2²⁰ to the integral once its last tap is read: any number of steps that return a
  level to where it was return the output there exactly. The test throws thousands of steps of odd sizes at
  odd times and one that undoes their sum: the output is 0.0, not nearly.
- **Exact time.** T-state t of a frame falls at sample (F + t) × rate ⁄ clock + ½, F being the frame's start in
  T-states since the buffer began, kept as an integer and a remainder over the clock, so that over any number
  of frames the samples handed out are the total time times the rate, rounded to the nearest (the ½), and
  never wander. The clock (3,500,000 or 3,546,900 Hz, or any other) and the rate (any) can change: the clock
  between frames, keeping the fraction of a sample the next frame starts at; the rate drops what is buffered
  (it was made for the old rate) but keeps the levels, so nothing thumps.
- **Latency.** A step comes out 14.5 samples after it went in, the same for every step (0.33 ms at 44.1 kHz):
  the time the kernel needs on its far side, so that the samples handed out are final.

### The output stage

On each side, in order:

1. **The DC block**, a first-order high-pass at 4 Hz. The Spectrum's sound reaches anything outside it through a
   capacitor: on the 128K the ULA's sound enters the TV sound modulator through R112 (68 kΩ) and C123 (1 µF),
   the AY's through R132 (39 kΩ) and C127 (1 µF) (128K technical manual, §5.3.4 and the parts list), corners of
   2.3 and 4.1 Hz. A beeper left high, or the AY's offset, settles to silence instead of sitting as DC.
2. **A tone**, optionally (`audio::Tone`):
   - `Flat`: nothing more, the sound as a line out gives it.
   - `Speaker`: the 16K/48K's own speaker. A 40 Ω loudspeaker (service manual, parts list) a few centimetres
     across, inside the case: a second-order high-pass at 400 Hz for its resonance, below which a small
     speaker gives little, and a second-order low-pass at 5 kHz. **These two corners are chosen, not measured**:
     no measurement of the speaker's response was found. Fuse models the same speaker with a 1 kHz bass cut and a
     steep treble roll-off, a thinner sound than this.
   - `Television`: the 128K, +2 and +3, heard through a TV. Their sound frequency-modulates the TV's sound
     carrier (MC1376, IC38), and the manual shows nothing in the path but the coupling above: no pre-emphasis.
     So the set's standard 50 µs de-emphasis (ITU-R BT.470, systems B/G/I) acts as a first-order low-pass at
     3,183 Hz; then a second-order high-pass at 150 Hz for a TV's speaker in its cabinet (chosen).
3. **The volume, times `HEADROOM` (0.70), then a clamp to ±1** which the headroom keeps from ever acting. The
   convention is that the sources' levels together stay within a span of 1.0 on each side (the beeper and the
   AY share it). For *any* input within that span, whatever it does, the output is bounded by half the total
   variation of the stage's step response (the response settles to zero at both ends). The test measures that
   variation at T-state resolution: before the headroom it is 1.40 for `Flat` (a step's overshoot, and a pulse
   train timed against the kernel's ripples adding them up), 1.04 for `Speaker` and 1.06 for `Television`. With
   0.70 no sample can pass ±0.98. Square waves, from 20 Hz to 20 kHz from silence, peak at 1.15 (0.80 out).

The filters are biquads (Robert Bristow-Johnson's Audio EQ Cookbook), in f64. A change of tone or rate starts
the new filters as if the level had always been what it is.

### API

```rust
pub const UNIT: i32;                      // a level of 1.0, in step units
pub fn units(level: f32) -> i32;
pub trait Sink { fn add_step(&mut self, t: u32, left: i32, right: i32); }
pub struct Discard;                       // a Sink that drops everything (sound off)
pub struct Level;                         // a source that holds a level
impl Level {
    pub const fn new() -> Level;
    pub fn set(&mut self, out: &mut impl Sink, t: u32, level: f32);
    pub fn set_stereo(&mut self, out: &mut impl Sink, t: u32, left: f32, right: f32);
    pub fn set_units(&mut self, out: &mut impl Sink, t: u32, left: i32, right: i32);
    pub fn units(&self) -> (i32, i32);
}
pub struct Buffer;                        // implements Sink
impl Buffer {
    pub fn new(clock_hz: u32, sample_rate: u32) -> Buffer;
    pub fn clock_hz(&self) -> u32;
    pub fn sample_rate(&self) -> u32;
    pub fn set_clock(&mut self, clock_hz: u32);
    pub fn set_sample_rate(&mut self, sample_rate: u32);
    pub fn output(&self) -> Output;
    pub fn set_output(&mut self, output: Output);
    pub fn clear(&mut self);
    pub fn add_step(&mut self, t: u32, left: i32, right: i32);
    pub fn samples_for(&self, frame_len: u32) -> usize;
    pub fn end_frame(&mut self, frame_len: u32);
    pub fn samples_avail(&self) -> usize;
    pub fn read_samples(&mut self, out: &mut [f32]) -> usize;   // interleaved L, R; returns stereo samples
}
pub struct Output { pub tone: Tone, pub dc_block: bool, pub volume: f32 }
pub enum Tone { Flat, Speaker, Television }
pub const HEADROOM: f64; pub const DC_CORNER_HZ: f64;   // and the tones' corners
pub mod kernel;                           // the table and its constants, LATENCY among them
```

## `ay`: the AY-3-8912

### Time

The chip runs on its own clock (1,773,450 Hz on the 128K family, exactly half the CPU's; 1,750,000 Hz on the
Pentagon, half of 3.5 MHz). Every 8 of its cycles is a *tick*, on which every counter moves: 16 T-states on both
machines. On any other pair of clocks a tick falls at T-state ⌊k × 8 × cpu ⁄ ay⌋, kept as a remainder over the
chip's clock, so ticks never drift (tested on 2 MHz against 3,546,900 Hz and 1 MHz against 3.5 MHz).

`write(t, …)` runs the chip up to `t` (every tick before `t`), then takes the write. A change it makes to a
channel's level (volume, mixer, an envelope restarted) is put out at `t` itself, so samples played through
the volume registers are timed to the T-state; a new period takes effect at the counter's next tick. A level is
put into the sink only when a channel's output changes. Ticks on which nothing that can be heard moves (a tone
on a silent or tone-disabled channel, noise no channel listens to, an envelope no channel uses) are taken in
bulk, exactly; a test runs random register programs both ways, tick by tick and in bulk, and compares every
step and the whole state at every frame.

### Register by register

| Register | Bits | What it does, and the source |
|---|---|---|
| 0–5 | 8 + 4 | Tone periods A, B, C, 12 bits. f = clock ⁄ (16 × TP) (GI data manual §3.1). The counter counts up and comes round when it reaches the period, *or has passed it* (MAME's notes, from "careful studies of the chip output"; Hatari, ayumi and jt49 do the same, starting the counter again from 0): lowered below the count, a tone turns once, at the next tick, instead of counting on to 4,095. (MAME's code now subtracts the period in a loop instead, which turns the tone count ⁄ period times on that tick; its own notes and the others say otherwise.) Period 0 is period 1 (MAME, the YM2203 datasheet; Hatari measured the same on the YM2149). |
| 6 | 5 | Noise period. The noise generator is a 17-bit shift register, shifted right, the new bit 16 being bit 0 XOR bit 3 (x¹⁷ + x¹⁴ + 1; MAME, "verified on AY-3-8910 and YM2149 chips"), bit 0 the output, starting at 1. It shifts every second time its counter comes round: f = clock ⁄ (16 × NP) (GI §3.2). Period 0 is 1. |
| 7 | 8 | Mixer and port directions. Bits 0–2 disable tone A–C, 3–5 noise A–C (active low: 0 enables, GI §3.3); a channel passes its volume when (tone or tone disabled) and (noise or noise disabled), so one with both disabled passes its volume constantly: "disabling noise and tone does not turn off a channel" (GI §3.3 note). Bit 6 makes port A an output, bit 7 port B. |
| 8–10 | 5 | Amplitude: bits 0–3 a fixed level, or with bit 4 the envelope's (GI §3.4). Level 0 is silence. |
| 11–12 | 16 | Envelope period. A step lasts 16 × EP of the chip's cycles, two ticks, and a cycle of 16 steps 256 × EP: f = clock ⁄ (256 × EP) (GI §3.5.1). Period 0 steps every tick, twice as fast as 1 (MAME: "this does NOT apply to the Envelope period. In that case, period = 0 is half as period = 1"; jt49 does the same). |
| 13 | 4 | Envelope shape: Continue, Attack, Alternate, Hold (GI §3.5.2). Writing it restarts the envelope at its first step (15 counting down, or 0 with Attack) and its period counter from 0 (Hatari: "this also starts a new phase", measured on the ST; ayumi does the same; MAME keeps the counter). Hold stops after one cycle; Alternate turns round after each; "when both the Hold bit and the Alternate bit are ones, the envelope counter is reset to its initial count before holding"; without Continue it ends at 0. All sixteen shapes are tested step by step against the manual's Fig. 7. |
| 14 | 8 | I/O port A. As an input it reads its pins (`set_port_a_input`, high where nothing drives them); as an output it drives the latch, and reads the pins *through* it, latch AND pins (Fuse's model). Written as an input, the value is stored and driven once the port turns output. |
| 15 | 8 | Port B: the 8912 has no pins for it, so it reads 0xFF as an input and the latch as an output (Fuse). |

Unused bits read back as 0 (MAME: "tested and confirmed on hardware" on the AY-3-8910, of which the 8912 is the
one-port version). Latching an address whose high four bits are not 0 deselects the chip: it ignores the data
port and leaves the bus alone until a valid address is latched (the datasheet's "Register array": DA7–DA4 are
mask-programmed to a 0000 code, and when they are "incorrect" the bidirectional buffers are forced to high
impedance; MAME); `read` then gives `None`, for the
machine to put its floating bus on the data lines. After a reset nothing is latched, every register is 0.

### The DAC

The AY's levels are not the datasheet's ideal 3 dB a step. Matthew Westcott measured them on a real Spectrum 128
in December 2001 (comp.sys.sinclair, placed in the public domain; quoted in full in MAME's ay8910.cpp, and the
basis of Fuse's table): channel C held at a constant level, its volume stepped 0–15, the voltage read between
its pin and ground, in the machine. Normalised, these are the levels used:

| Volume | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Volts | 1.147 | 1.162 | 1.169 | 1.178 | 1.192 | 1.213 | 1.238 | 1.299 | 1.336 | 1.457 | 1.573 | 1.707 | 1.882 | 2.060 | 2.320 | 2.580 |
| Level | 0 | .0105 | .0154 | .0216 | .0314 | .0461 | .0635 | .1061 | .1319 | .2163 | .2973 | .3908 | .5129 | .6371 | .8186 | 1 |
| dB | −∞ | −39.6 | −36.3 | −33.3 | −30.1 | −26.7 | −23.9 | −19.5 | −17.6 | −13.3 | −10.5 | −8.2 | −5.8 | −3.9 | −1.7 | 0 |

The envelope's 16 steps use the same 16 levels. The curve depends on the load: MAME's own measurements of an
AY-3-8910 across loads from 983 Ω to open circuit are in ay8910.cpp, and an unloaded chip's curve is flatter.
Westcott's is the Spectrum's.

### Stereo, and the 128K's joined outputs

`Mix { stereo, separation, gain }`, `gain` being the level of all three channels at full volume on each side.

- `Joined`: the Spectrum 128 as it is. Its three outputs are joined on one track (IC32 pins 1, 4 and 5; cutting
  the track is the usual stereo modification), and joined outputs do not add their voltages: each pulls the
  common node towards the supply through its own conductance, into one load. `dac::joined` models exactly that,
  V = 5 V × Σg ⁄ (Σg + G), the structure of MAME's resistor model for the same chip in the same machine, and
  calibrates it to Westcott's measurements, which were taken in that configuration (one channel stepped, the
  other two joined to it at 0): all three at 0 gives G ⁄ g₀ = 3 (5 − V₀) ⁄ V₀, and each measured voltage gives
  its level's g. Alone, a channel follows Westcott's curve exactly; one channel at full is 0.58 of all three at
  full, where added it would be a third. The 4,096 combinations are a table of integers. (On the YM2149, for
  which there is no such measurement, `Joined` is `Mono`.)
- `Mono`: each channel a third of `gain`, added, on both sides.
- `Abc`: A left, B centre, C right; `Acb`: A left, C centre, B right (the stereo modifications, and the
  Pentagon's). A side channel pans linearly by `separation` (0 is mono, 1 entirely to its side), so that each
  side gets `gain` with all three at full, whatever the placement.

Every table of contributions is integers, so steps sum back exactly.

### The YM2149

`Chip::Ym2149`: 32 envelope steps, one tick each per period (the cycle as long as the AY's), period 0 the same as
1 (Hatari, measured); fixed volume v sits on envelope level 2v + 1 (0 stays silent); every register bit reads
back as written (MAME: "YM2149: no anomaly"); its DAC is Hatari's measurement of a real Atari ST (`ymout1c5bit`,
its level 0 being 310 before Hatari set it to zero), normalised.

### State

`State` is plain data: the registers, the latched address, every counter and output, the shift register, the
envelope's step and flags, the port's pins, and where the next tick falls. `state()` and `set_state(&State)`;
the mix and what was put into the buffer are not in it (they are the listener's), and after a restore the chip
moves its outputs to the restored ones at its next tick, as differences from what it last put out, so the sound
carries on without a jump. Tested: a state saved mid-song plays the next five frames again to the same levels
at the same T-states. The same holds for every change made without a T-state (`set_mix`, `set_state`,
`set_register`, `reset`): it is heard from the chip's next tick, which `run` takes on its own even when the chip
would otherwise take the rest of the frame in one go. A state the chip could not be in (one saved from the other
chip, whose envelope has 32 steps, or a damaged one) is kept within what it can hold: registers through the
chip's masks, the address to 4 bits, the envelope's step to its steps, the counters to their widths, the shift
register to 17 bits; nothing in it can index past the DAC's table.

### API

```rust
pub enum Chip { Ay8912, Ym2149 }
pub enum Stereo { Mono, Joined, Abc, Acb }
pub struct Mix { pub stereo: Stereo, pub separation: f32, pub gain: f32 }
pub const REGISTER_MASKS: [u8; 16];
pub struct State { /* public fields, see the source */ }
pub struct Ay;
impl Ay {
    pub fn new(chip: Chip, ay_clock_hz: u32, cpu_clock_hz: u32) -> Ay;
    pub fn chip(&self) -> Chip;
    pub fn reset(&mut self);
    pub fn set_clocks(&mut self, ay_clock_hz: u32, cpu_clock_hz: u32);
    pub fn clocks(&self) -> (u32, u32);
    pub fn mix(&self) -> Mix;
    pub fn set_mix(&mut self, mix: Mix);
    pub fn select(&mut self, value: u8);
    pub fn address(&self) -> u8;
    pub fn write<S: Sink>(&mut self, t: u32, value: u8, out: &mut S);
    pub fn read(&self) -> Option<u8>;
    pub fn register(&self, r: u8) -> u8;
    pub fn registers(&self) -> [u8; 16];
    pub fn set_register(&mut self, r: u8, value: u8);     // untimed, for loading snapshots
    pub fn set_port_a_input(&mut self, pins: u8);
    pub fn port_a_output(&self) -> Option<u8>;
    pub fn outputs(&self) -> [u8; 3];                     // each channel's DAC level now
    pub fn state(&self) -> State;
    pub fn set_state(&mut self, state: &State);
    pub fn run<S: Sink>(&mut self, t: u32, out: &mut S);
    pub fn end_frame<S: Sink>(&mut self, frame_len: u32, out: &mut S);
}
pub mod dac;                                              // the measured tables, and `joined`
```

docs/architecture.md sketched `write(t, v)` and `read`; `write` takes the sink as well (the chip must run up to
`t`, putting out what it played until then, before it takes the write), and `read` says `None` when the chip
does not drive the bus.

## The Spectrum's own sound: levels for the machine

### The 16K/48K

One ULA pin, 28, is the MIC output, the EAR input and the speaker's drive at once (service manual §5.4). Its
voltage for each value of port 0xFE's bits 4 (EAR) and 3 (MIC), measured (the comp.sys.sinclair FAQ's 48K
reference, also at 8bitchip.info):

| EAR (bit 4) | MIC (bit 3) | Issue 2 | Issue 3 |
|---|---|---|---|
| 0 | 0 | 0.39 V | 0.34 V |
| 0 | 1 | 0.73 V | 0.66 V |
| 1 | 0 | 3.66 V | 3.56 V |
| 1 | 1 | 3.79 V | 3.70 V |

The speaker is not driven linearly from it. On the Issue 1 and 2 boards the pin drives the speaker through two
diodes in series (D9, D10; the Issue 1/2 circuit diagram); on the Issue 3 through D9 into the base of TR7, a
ZTX450 emitter follower with the 40 Ω speaker in its emitter (service manual, parts list and §5.4.3). Either way
about two junction drops, 1.2–1.4 V, must be crossed before any current flows, and the speaker is driven by
roughly what is left. The service manual says it: "while SAVEing, the level of the MIC output is barely
sufficient to drive the loudspeaker… during the execution of a BEEP instruction the CPU writes instead to port
254 on data bus 4. This effectively boosts the MIC output". Fuse, citing Chris Smith's ULA book, takes the
threshold as 1.4 V. Through the speaker, relative to EAR and MIC both set:

| EAR | MIC | Issue 2 | Issue 3 | (threshold 1.2–1.4 V) |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | |
| 0 | 1 | 0 | 0 | below the threshold: silent or nearly ("barely sufficient") |
| 1 | 0 | 0.946–0.950 | 0.939–0.944 | |
| 1 | 1 | 1 | 1 | |

**Recommended for the 48K's speaker**: none 0, MIC 0, EAR 0.94, both 1.0, the whole span of 1.0 being the
beeper's (the 48K has no other source), with `Tone::Speaker`.

**The tape heard while loading** comes in at the EAR socket and moves the same pin, so the loading noise goes
through the same threshold. How loud depends on the recorder's volume; no measurement was found. Emulators use
little: Fuse 4% of the beeper's level, MAME about 10%. A level of about 0.1, crossing the speaker's threshold
only on the tape's peaks, is a reasonable default; make it a setting.

### The 128K and +2

The 128K has no speaker: the ULA's sound and the AY's go to the TV's sound carrier and to the MIC socket for a
monitor (128K technical manual, §5.3.1). The ULA's pin enters through R112 (68 kΩ), the AY's three joined
outputs through R132 (39 kΩ), into the modulator's input (§5.3.4), so each contributes in proportion to its
voltage swing over its resistor, and the pin's voltage is heard linearly (no threshold). For want of a
measurement on the 128K's ULA, the 48K Issue 3's voltages give, relative to EAR and MIC both set:

| EAR | MIC | level |
|---|---|---|
| 0 | 0 | 0 |
| 0 | 1 | 0.095 |
| 1 | 0 | 0.958 |
| 1 | 1 | 1 |

Against the AY: the beeper's full swing, 3.36 V over 68 kΩ, gives 49 µA; one AY channel at volume 15, Westcott's
1.43 V in the machine over 39 kΩ, 37 µA, three quarters of the beeper; all three at 15, joined (2.47 V by the
model above), 63 µA. **Recommended for the 128K and +2**, sharing the span of 1.0: the beeper's span 0.44 (EAR
alone 0.44 × 0.958 = 0.42, MIC alone 0.04), the AY `Stereo::Joined` with `gain` 0.56, and `Tone::Television`
for the TV or `Flat`. Fuse's choice (beeper 50, each AY channel 24, added) is close: 0.41 and 0.59. With the
AY's channels added instead (`Mono`, or stereo), the same currents give the beeper 0.31 and the AY 0.69. The
tape on the 128K is heard the same way, at a level to choose.

The +2A and +3 mix differently (their gate array replaces the ULA, and their EAR/MIC lines are not shared the
same way); nothing measured was found for them, and the 128K's figures are the best guess.

## Tests

`nerd test audio` runs both crates (`cargo test -p audio -p ay`): 21 tests in `audio`, 29 in `ay`, 3.8 s on
this machine including the build. Nothing reads the clock: time is T-states and samples counted.

`audio` (tests/buffer.rs and the modules' own):

- **Sample counts.** For both clocks, all three frame lengths (69,888, 70,908, 71,680) and eight rates (8,000 to
  192,000 Hz, including 31,250 and 11,025): after each of 2,000 frames, the samples handed out equal the total
  time times the rate, rounded, exactly (96,000 frames checked), and `samples_for` predicts each frame. 100,000
  frames (33 minutes) on each clock end exact. A clock change between frames keeps the count.
- **Frame boundaries.** Steps at the frame's last T-state, at its length and past it, added before the frame
  ends, give the same samples to the bit as the same steps added in the next frame; a square wave whose edges
  are all at frame boundaries keeps its level exactly over 1,000 frames.
- **Exactness.** Thousands of random steps and one undoing their sum return the output to exactly 0.0.
- **Position.** A step at T-state t is centred at sample 0.5 + t × rate ⁄ clock + 14.5, measured by the centroid
  of the differences between samples (exact for a band-limited pulse): the worst error over 1,200 placements, two
  clocks and three rates is 7 × 10⁻⁶ of a sample (a two-thousandth of a T-state).
- **Aliasing.** Square waves of 1.7 to 8.9 kHz (half-periods of 199 to 1,031 T-states, as beeper loops make them)
  rendered at 44.1, 48 and 22.05 kHz; a 32,768-point FFT under a Kaiser window (β = 16, side lobes below
  −150 dB); everything that is not a harmonic, up to 20 kHz (or 0.4535 of the rate), against the fundamental. The
  floor is −90 dB. Measured, band-limited against naive sampling of the same wave (which the test also checks
  is plainly above the floor, so the measurement has teeth):

  | Rate | 1.7 kHz | 3.7 kHz | 5.3 kHz | 8.8 kHz |
  |---|---|---|---|---|
  | 44,100 | −123.2 (naive −23.6) | −126.1 (−16.6) | −123.4 (−14.1) | −118.5 (−9.5) |
  | 48,000 | −124.1 (−24.8) | −126.5 (−18.6) | −124.2 (−17.0) | −119.6 (−13.9) |
  | 22,050 | −122.6 (−18.6) | −124.2 (−13.9) | −116.9 (−9.4) | −112.6 (−9.5) |

- **Headroom.** The bound above, measured for each tone at 44.1 and 48 kHz: no sample of any input within a
  span of 1.0 can pass 0.979 (`Flat`), 0.728 (`Speaker`), 0.743 (`Television`). Square waves of span 1.0 every
  sixth of an octave from 20 Hz to 20 kHz, from silence, peak at 0.805, 0.718 and 0.725.
- **The kernel.** Every one of its 257 rows sums to exactly 2²⁰; the last is the first one sample on; the step's
  middle is where `LATENCY` says.
- **The output stage.** The DC block is −3.01 dB at 4 Hz and flat at 100 Hz, and takes a held level to below
  10⁻⁶ in a second; the tones' corners are where they say; a change of tone or rate makes no thump.
- **Level** adds only differences.

`ay` (tests/ay.rs and the crate's own):

- **Tone frequency**: periods 1 to 4,095, edges exactly 16 × TP T-states apart, across frames; period 0 the same
  as 1; a period lowered below the count turns at the next tick.
- **Noise**: 262,242 outputs against the shift register as specified, and the sequence repeating after
  2¹⁷ − 1 = 131,071 (a prime: the period is that or 1, and it is not constant); the shift rate clock ⁄ (16 × NP)
  for NP = 0, 1, 2, 5, 31.
- **Envelopes**: all sixteen shapes, five cycles step by step (80 steps each), against the manual's Fig. 7, drawn
  as characters (`\_`, `/_`, `\\`, `\/\/`, `\¯`, `//`, `/¯`, `/\/\`); a step lasting 16 × EP cycles (EP = 3), EP = 0
  twice as fast as 1; a rewrite of register 13 restarting at once; the YM2149's 32 steps for every shape, and its
  EP = 0.
- **Mixer**: every one of the 64 settings of the six enables, 300 ticks each, against (tone or disabled) and
  (noise or disabled); both disabled passes the volume constantly and nothing else does.
- **Volume** fixed or by bit 4; **registers** reading back through their masks (and the YM's not); an address
  with high bits deselecting the chip; **port A** as input and output, port B's missing pins.
- **Clocks**: on the 128K's, the Pentagon's, 2 MHz against 3,546,900 Hz and 1 MHz against 3.5 MHz, every tick of
  300 frames at ⌊k × 8 × cpu ⁄ ay⌋ and their number exact.
- **Timing of writes**: a volume change put out at the T-state of its write.
- **DAC**: each fixed volume's level equal to Westcott's normalised voltage, to half a unit.
- **Stereo**: mono, ABC and ACB at full separation, none and half; a new mix moving the sound at the next tick.
- **Joined outputs**: a channel alone following Westcott's curve to 2 × 10⁻⁶, one at full 0.581 of all three,
  two between one and three, louder in any channel never quieter, the YM2149's joined the same as its mono.
- **State**: saved and restored mid-song, the next five frames the same levels at the same T-states. A new mix, a
  restored state, a stored register and a reset, on a chip holding a steady level, each put out at the next tick
  (not at the frame's end). A YM2149's state, and a damaged one, put into an AY-3-8912 with every mix, run without
  reaching outside its tables.
- **Into the buffer**: channel A's tone at periods 1 to 4 (111 to 28 kHz on the 128K, the carriers sample players
  use), on the 128K's and the Pentagon's clocks, at 44.1 and 48 kHz: everything in it lies in the kernel's stop
  band, and what moves in the output is −98.9 dB or less against the square (the floor is −90). A busy song
  (stereo, tones, noise, envelopes) played through the buffer in frames of the machine's length, of half, a
  fifth, and 1,237 T-states: the same samples to the bit, on both machines' clocks.
- **Bulk ticks**: random register programs, both chips, two pairs of clocks, 200 frames each, run tick by tick
  and in bulk: identical steps and state; and again, 300 frames on each chip, with changes made without a T-state
  among the writes (stored registers, new mixes, restored states, resets). The bulk counter arithmetic against a
  plain counter for every start, period and length up to 40.

### Measured cost

`cargo run --release -p ay --example cost [-- --json]` times one minute of 128K sound at 48 kHz, AY into
buffer, every sample read through the output stage (not a test: it judges the machine as well as the code). On
this machine, natively: 55 ms with the chip silent (0.09% of real time), 83 ms playing three tones, 198 ms with
noise and an envelope on every channel, and 1.0 s (1.7%) in the worst case there is, every period at 1 (tones
at 110 kHz, the noise and every envelope at their fastest). Both crates build for wasm32-unknown-unknown.

## Known gaps

- **The joined-outputs model rests on an assumption**: that each output pulls towards the chip's 5 V supply
  through a conductance. Westcott measured one channel at a time; nobody has published all three together. Had
  the outputs pulled towards 3.5 V (a source follower's ceiling), all three at full would be 1.35 times one
  channel's swing rather than 1.72; MAME's own fit of a resistor network to the same measurements gives 1.78.
- **The speaker and TV tones are models**, their corners chosen from what such parts do; no measured response
  of the 48K's speaker, or of a TV's sound, was found.
- **The 128K's ULA voltages** are taken from the 48K Issue 3's; the beeper-to-AY ratio rests on them and on the
  two mixing resistors. The +2A/+3's mixing is not researched.
- **Port A's input mode**: the data manual says the register "will follow the signals applied to the I/O port"
  in input mode; the latch here keeps what the CPU wrote (Fuse's behaviour, which the 128K ROM runs against),
  which differs only if software writes the latch as an input and reads it after turning the port to output.
- **Where MAME and Hatari disagree** this follows one and says so: the envelope's period counter restarts on a
  write to register 13 (Hatari, measured on the YM2149; MAME keeps it), and the AY's envelope period 0 is twice
  as fast as 1 (MAME; on the YM2149, Hatari's measurement that 0 is 1). The difference is at most one step's
  timing.
- **When a write is heard**: a change of volume or mixer is put out at the write's T-state; whether the chip
  passes it to its DAC at once or at its next internal clock edge (up to 8 of its cycles, 16 T-states, later)
  was not found measured.
- The AY-3-8910's two ports and the AY8930's extended mode are not modelled.

## Sources

- General Instrument, *AY-3-8910/8912 Programmable Sound Generator Data Manual*, February 1979: register
  functions, frequency equations, the envelope shapes (Fig. 7, 8), the mixer's truth table, the I/O ports.
  https://web.archive.org/web/20140217224114/http://dev-docs.atariforge.org/files/GI_AY-3-8910_Feb-1979.pdf
- General Instrument, *AY-3-8910/8912/8913* datasheet (post-1983): the same, abridged.
  http://map.grauw.nl/resources/sound/generalinstrument_ay-3-8910.pdf
- MAME, `src/devices/sound/ay8910.cpp` and `.h` (Couriersud and others): the counters' comparison and period 0,
  the envelope's period 0, the noise taps, read-back masks on hardware, chip select, Westcott's measurements
  quoted in full, MAME's own load measurements. https://github.com/mamedev/mame/blob/master/src/devices/sound/ay8910.cpp
- Matthew Westcott, AY volume measurements on a Spectrum 128, comp.sys.sinclair, December 2001.
  http://groups.google.com/group/comp.sys.sinclair/browse_thread/thread/fb3091da4c4caf26/d5959a800cda0b5e
- Hatari, `src/sound.c`: the YM2149 measured on an Atari ST (period 0 as 1, the envelope restart, the 32 levels).
  https://github.com/hatari/hatari/blob/main/src/sound.c
- Fuse, `sound.c` (Russell Marks, Philip Kendall and others): the beeper's levels and the MIC threshold, the AY
  levels from Westcott's post, port A's read, the speaker models.
  https://github.com/libretro/fuse-libretro/blob/master/fuse/sound.c
- Peter Sovietov, ayumi, an AY/YM emulator. https://github.com/true-grue/ayumi
- Jose Tejada, jt49, a YM2149 in Verilog. https://github.com/jotego/jt49
- Shay Green (blargg), blip_buf: the band-limited step technique. https://code.google.com/p/blip-buf
- World of Spectrum, *ZX Spectrum 16K/48K technical reference* (the comp.sys.sinclair FAQ): the pin 28 voltages.
  https://worldofspectrum.org/faq/reference/48kreference.htm ; also https://zx48.8bitchip.info/cassport.htm
- Sinclair Research, *ZX Spectrum Service Manual* (OCR): §5.4 the tape interface and the speaker's drive, the
  parts lists (TR7 ZTX450, D9, the 40 Ω speaker).
  https://k1.spdns.de/Vintage/Sinclair/82/Sinclair%20ZX%20Spectrum/Repair/ZX%20Spectrum%20Service%20Manual%20(OCRed).pdf
- *ZX Spectrum Issue 1/2 circuit diagram*: the buzzer driven through D9 and D10.
  https://spectrumforeveryone.com/wp-content/uploads/2017/08/ZXSpectrumIssue12-Schematics.pdf
- Sinclair Research, *ZX Spectrum 128K Technical Manual*: §5.3 the sound to the TV and the MIC socket, R112/C123
  and R132/C127, the parts list. https://spectrumcomputing.co.uk/pub/sinclair/technical-docs/ZXSpectrum128K_TechnicalManual.pdf
- The 128K's joined AY outputs and the stereo modification. https://octocom.speccy.org/Articulo4_e.html
- ITU-R BT.470, *Conventional analogue television systems*: 50 µs sound pre-emphasis for systems B, G, I.
  https://www.itu.int/rec/R-REC-BT.470/
- Robert Bristow-Johnson, *Audio EQ Cookbook*: the biquads. https://www.w3.org/TR/audio-eq-cookbook/
