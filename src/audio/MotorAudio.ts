/** Peak master volume (linear gain, ~-16 dBFS). Tune here; kept modest since this plays over a headset. */
export const MASTER_VOLUME = 0.16;

const IDLE_TONE_FREQ = 70;
const MAX_TONE_FREQ = 260;
const IDLE_NOISE_FREQ = 900;
const MAX_NOISE_FREQ = 3200;
const NOISE_FILTER_Q = 0.7;
const IDLE_LEVEL = 0.12;
const PARAM_SMOOTH_TIME = 0.06;
const DISARM_TIME_CONSTANT = 0.15;
const STOP_TIME_CONSTANT = 0.08;
const STOP_SUSPEND_DELAY_MS = 400;
const NOISE_BUFFER_SECONDS = 2;
const DETUNE_BASE_CENTS = [-7, -3, 3, 7];

type Voice = {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function computeRms(values: number[]): number {
  if (values.length === 0) return 0;
  const sumSquares = values.reduce((sum, v) => sum + clamp01(v) ** 2, 0);
  return Math.sqrt(sumSquares / values.length);
}

function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export class MotorAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private voices: Voice[] = [];
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;

  constructor() {
    // No AudioContext is created here: browsers block audio contexts from starting
    // outside a user gesture, so construction must stay side-effect free until start().
  }

  start(): void {
    if (this.ctx) {
      // Re-entering AR after a previous session called stop() (which only suspends, to avoid a
      // click from destroying live nodes) — resume the same context instead of no-op'ing, or
      // audio would stay silent for the rest of the page's life.
      void this.ctx.resume();
      return;
    }

    const ctx = new AudioContext();
    this.ctx = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);
    this.masterGain = masterGain;

    const toneBus = ctx.createGain();
    toneBus.gain.value = 1;
    toneBus.connect(masterGain);

    this.voices = DETUNE_BASE_CENTS.map((baseCents) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = IDLE_TONE_FREQ;
      osc.detune.value = baseCents + (Math.random() - 0.5) * 2;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = IDLE_TONE_FREQ * 4;
      filter.Q.value = 0.5;

      const gain = ctx.createGain();
      gain.gain.value = 0.25;

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(toneBus);
      osc.start();

      return { osc, filter, gain };
    });

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(ctx);
    noiseSource.loop = true;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = IDLE_NOISE_FREQ;
    noiseFilter.Q.value = NOISE_FILTER_Q;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noiseSource.start();

    this.noiseSource = noiseSource;
    this.noiseFilter = noiseFilter;
    this.noiseGain = noiseGain;

    void ctx.resume();
  }

  update(motorNormalized: number[], armed: boolean): void {
    const ctx = this.ctx;
    const masterGain = this.masterGain;
    if (!ctx || !masterGain) return;

    const rms = computeRms(motorNormalized);
    const now = ctx.currentTime;

    const toneFreq = IDLE_TONE_FREQ + (MAX_TONE_FREQ - IDLE_TONE_FREQ) * rms;
    const noiseFreq = IDLE_NOISE_FREQ + (MAX_NOISE_FREQ - IDLE_NOISE_FREQ) * rms;

    for (const voice of this.voices) {
      voice.osc.frequency.setTargetAtTime(toneFreq, now, PARAM_SMOOTH_TIME);
      voice.filter.frequency.setTargetAtTime(toneFreq * 4, now, PARAM_SMOOTH_TIME);
    }
    this.noiseFilter?.frequency.setTargetAtTime(noiseFreq, now, PARAM_SMOOTH_TIME);

    const level = armed ? IDLE_LEVEL + (1 - IDLE_LEVEL) * rms : 0;
    const targetGain = MASTER_VOLUME * level;
    // Always ramp via setTargetAtTime rather than assigning `.value` directly: this is called
    // every frame, and stomping an in-flight ramp with a raw assignment causes audible zipper noise.
    masterGain.gain.setTargetAtTime(targetGain, now, armed ? PARAM_SMOOTH_TIME : DISARM_TIME_CONSTANT);
  }

  stop(): void {
    const ctx = this.ctx;
    const masterGain = this.masterGain;
    if (!ctx || !masterGain) return;

    const now = ctx.currentTime;
    masterGain.gain.setTargetAtTime(0, now, STOP_TIME_CONSTANT);

    window.setTimeout(() => {
      if (ctx.state === 'running') void ctx.suspend();
    }, STOP_SUSPEND_DELAY_MS);
  }

  dispose(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    for (const voice of this.voices) {
      try {
        voice.osc.stop();
      } catch {
        // already stopped; safe to ignore during teardown
      }
      voice.osc.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
    }
    this.voices = [];

    try {
      this.noiseSource?.stop();
    } catch {
      // already stopped; safe to ignore during teardown
    }
    this.noiseSource?.disconnect();
    this.noiseFilter?.disconnect();
    this.noiseGain?.disconnect();
    this.masterGain?.disconnect();

    this.noiseSource = null;
    this.noiseFilter = null;
    this.noiseGain = null;
    this.masterGain = null;

    void ctx.close();
    this.ctx = null;
  }
}
