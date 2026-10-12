import type { AudioEngine } from './AudioEngine';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// D lydian-flavoured progression: Dmaj9 – Bm11 – Gmaj7#11 – A6sus.
const CHORDS = [
  [50, 54, 57, 61, 64],
  [47, 50, 54, 57, 64],
  [43, 47, 50, 54, 61],
  [45, 52, 59, 61, 66],
];
const PENTA = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83];
const EIGHTH = 60 / 72 / 2;
const CHORD_EIGHTHS = 16;

/** Generative score whose layers unlock as the forest awakens. */
export class Music {
  private layers: GainNode[] = [];
  private layerTarget: number[] = [];
  private padFilter!: BiquadFilterNode;
  private delay!: DelayNode;
  private nextTime = 0;
  private step = 0;
  private melodyIdx = 3;
  private running = false;
  /** Number of awakened regions (0..7) — drives layering. */
  level = 0;
  private brightness = 0;
  private droneGain!: GainNode;
  private droneFilter!: BiquadFilterNode;

  constructor(private a: AudioEngine) {}

  start() {
    if (this.running) return;
    const { ctx } = this.a;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 600;
    this.padFilter.Q.value = 0.7;

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = EIGHTH * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2400;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(this.a.music);
    dlp.connect(this.a.reverbSend);

    for (let i = 0; i < 8; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.a.music);
      const send = ctx.createGain();
      send.gain.value = i === 0 ? 0.6 : 0.45;
      g.connect(send).connect(this.a.reverbSend);
      this.layers.push(g);
      this.layerTarget.push(0);
    }
    this.padFilter.connect(this.layers[0]);

    // Dark drone for danger.
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 220;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain).connect(this.a.sfx);
    for (const f of [41.2, 43.65, 61.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(this.droneFilter);
      o.start();
    }

    this.nextTime = ctx.currentTime + 0.2;
    this.running = true;
  }

  update(danger: number, progress: number) {
    if (!this.running) return;
    const { ctx } = this.a;
    const t = ctx.currentTime;
    // Layer gains.
    const gains = [0.55, 0.32, 0.5, 0.18, 0.3, 0.22, 0.5, 0.0];
    for (let i = 0; i < 8; i++) {
      const on = i === 0 || this.level >= i ? 1 : 0;
      if (on !== this.layerTarget[i]) {
        this.layerTarget[i] = on;
        this.layers[i].gain.setTargetAtTime(on * gains[i], t, 2.5);
      }
    }
    this.brightness += (progress - this.brightness) * 0.01;
    this.padFilter.frequency.setTargetAtTime(500 + this.brightness * 2600, t, 0.5);
    this.a.musicFilter.frequency.setTargetAtTime(18000 - danger * 17000, t, 0.15);
    this.droneGain.gain.setTargetAtTime(danger * 0.16, t, 0.2);
    this.droneFilter.frequency.setTargetAtTime(160 + danger * 260, t, 0.2);

    while (this.nextTime < t + 0.25) {
      this.schedule(this.step, this.nextTime);
      this.nextTime += EIGHTH;
      this.step++;
    }
  }

  private schedule(step: number, time: number) {
    const chordIdx = Math.floor(step / CHORD_EIGHTHS) % CHORDS.length;
    const chord = CHORDS[chordIdx];
    const inChord = step % CHORD_EIGHTHS;
    const L = this.level;

    if (inChord === 0) {
      this.pad(chord, time, EIGHTH * CHORD_EIGHTHS);
      if (L >= 2) this.bass(chord[0] - 12, time);
      if (L >= 3) this.shimmer(chord, time, EIGHTH * CHORD_EIGHTHS);
      if (L >= 5) this.choir(chord, time, EIGHTH * CHORD_EIGHTHS);
    }
    if (L >= 2 && inChord === 8) this.bass(chord[0] - 12, time, 0.6);
    if (L >= 1 && Math.random() < 0.32 + L * 0.03) {
      const n = chord[Math.floor(Math.random() * chord.length)] + 24;
      this.bell(n, time, 0.5 + Math.random() * 0.5);
    }
    if (L >= 4 && step % 2 === 0 && Math.random() < 0.55) {
      this.melodyIdx = Math.max(0, Math.min(PENTA.length - 1, this.melodyIdx + Math.floor(Math.random() * 5) - 2));
      this.pluck(PENTA[this.melodyIdx], time);
    }
    if (L >= 6 && inChord % 4 === 0) this.heartbeat(time, inChord % 8 === 0 ? 1 : 0.6);
  }

  private env(g: GainNode, time: number, peak: number, attack: number, hold: number, release: number) {
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(peak, time + attack);
    g.gain.setValueAtTime(peak, time + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release);
  }

  private pad(chord: number[], time: number, dur: number) {
    const { ctx } = this.a;
    for (const n of chord) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        const g = ctx.createGain();
        this.env(g, time, 0.035, 2.2, dur - 2.2, 3.5);
        o.connect(g).connect(this.padFilter);
        o.start(time);
        o.stop(time + dur + 4);
      }
    }
  }

  private bell(n: number, time: number, vel: number) {
    const { ctx } = this.a;
    const f = mtof(n);
    for (const [ratio, amp, dec] of [[1, 1, 2.6], [2.76, 0.35, 1.2], [5.4, 0.12, 0.6]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.09 * amp * vel, time + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dec);
      o.connect(g).connect(this.layers[1]);
      o.start(time);
      o.stop(time + dec + 0.1);
    }
  }

  private bass(n: number, time: number, vel = 1) {
    const { ctx } = this.a;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(n);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = mtof(n);
    const g = ctx.createGain();
    this.env(g, time, 0.22 * vel, 0.04, 0.3, 3.2);
    o.connect(g);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o2.connect(g2).connect(g);
    g.connect(this.layers[2]);
    o.start(time);
    o2.start(time);
    o.stop(time + 4);
    o2.stop(time + 4);
  }

  private shimmer(chord: number[], time: number, dur: number) {
    const { ctx } = this.a;
    for (const n of [chord[2] + 24, chord[4] + 24, chord[3] + 12]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = mtof(n);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4 + Math.random() * 2;
      const lg = ctx.createGain();
      lg.gain.value = 6;
      lfo.connect(lg).connect(o.detune);
      const g = ctx.createGain();
      this.env(g, time, 0.04, 3, dur - 3, 3);
      o.connect(g).connect(this.layers[3]);
      o.start(time);
      lfo.start(time);
      o.stop(time + dur + 3.5);
      lfo.stop(time + dur + 3.5);
    }
  }

  private pluck(n: number, time: number) {
    const { ctx } = this.a;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(n);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4000, time);
    f.frequency.exponentialRampToValueAtTime(400, time + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.16, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 1.2);
    o.connect(f).connect(g);
    g.connect(this.layers[4]);
    g.connect(this.delay);
    o.start(time);
    o.stop(time + 1.3);
  }

  private choir(chord: number[], time: number, dur: number) {
    const { ctx } = this.a;
    const out = ctx.createGain();
    out.gain.value = 1;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 760;
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1180;
    f2.Q.value = 7;
    f1.connect(out);
    f2.connect(out);
    out.connect(this.layers[5]);
    for (const n of [chord[1] + 12, chord[2] + 12, chord[4]]) {
      for (const det of [-9, 0, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        const g = ctx.createGain();
        this.env(g, time, 0.06, 2.5, dur - 2.5, 3);
        o.connect(g);
        g.connect(f1);
        g.connect(f2);
        o.start(time);
        o.stop(time + dur + 3.5);
      }
    }
  }

  private heartbeat(time: number, vel: number) {
    const { ctx } = this.a;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, time);
    o.frequency.exponentialRampToValueAtTime(38, time + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.5 * vel, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.6);
    o.connect(g).connect(this.layers[6]);
    o.start(time);
    o.stop(time + 0.7);
  }

  /** Big swelling chord for the finale. */
  finale() {
    if (!this.running) return;
    const { ctx } = this.a;
    const time = ctx.currentTime + 0.05;
    const notes = [38, 50, 57, 62, 66, 69, 73, 76, 81, 85];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.5, time + 6);
    g.gain.setValueAtTime(0.5, time + 12);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 22);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, time);
    f.frequency.exponentialRampToValueAtTime(6000, time + 8);
    f.connect(g);
    g.connect(this.a.music);
    g.connect(this.a.reverbSend);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = n < 50 ? 'sine' : 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = n < 50 ? 0.25 : 0.03;
        o.connect(og).connect(f);
        o.start(time);
        o.stop(time + 23);
      }
    }
  }
}
