import type { AudioEngine } from './AudioEngine';
import type { Vector3 } from 'three';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface SeedHum {
  panner: PannerNode;
  gain: GainNode;
  oscs: OscillatorNode[];
}

/** One-shot effects, ambience beds and positional seed hums. */
export class Sfx {
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private waterGain!: GainNode;
  private glideGain!: GainNode;
  private glideFilter!: BiquadFilterNode;
  private hums: SeedHum[] = [];
  private cricketTimer = 0;
  private running = false;

  constructor(private a: AudioEngine) {}

  start(seedPositions: Vector3[]) {
    if (this.running) return;
    const { ctx } = this.a;
    // Wind.
    const wind = this.a.noise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.07;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.a.ambience);
    wind.start();

    // Lake lapping.
    const water = this.a.noise();
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 500;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    water.connect(wf).connect(this.waterGain).connect(this.a.ambience);
    water.start();

    // Glide whoosh.
    const glide = this.a.noise();
    this.glideFilter = ctx.createBiquadFilter();
    this.glideFilter.type = 'bandpass';
    this.glideFilter.frequency.value = 800;
    this.glideFilter.Q.value = 1.2;
    this.glideGain = ctx.createGain();
    this.glideGain.gain.value = 0;
    glide.connect(this.glideFilter).connect(this.glideGain).connect(this.a.sfx);
    glide.start();

    // Positional hums for each seed.
    const notes = [74, 78, 81, 76, 83, 79, 86];
    seedPositions.forEach((p, i) => {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 4;
      panner.rolloffFactor = 1.6;
      panner.maxDistance = 120;
      panner.positionX.value = p.x;
      panner.positionY.value = p.y;
      panner.positionZ.value = p.z;
      const gain = ctx.createGain();
      gain.gain.value = 0.11;
      const oscs: OscillatorNode[] = [];
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = mtof(notes[i]);
        o.detune.value = det;
        const trem = ctx.createOscillator();
        trem.frequency.value = 0.6 + i * 0.13;
        const tg = ctx.createGain();
        tg.gain.value = 0.4;
        const og = ctx.createGain();
        og.gain.value = 0.6;
        trem.connect(tg).connect(og.gain);
        o.connect(og).connect(gain);
        o.start();
        trem.start();
        oscs.push(o, trem);
      }
      gain.connect(panner).connect(this.a.sfx);
      const send = ctx.createGain();
      send.gain.value = 0.3;
      panner.connect(send).connect(this.a.reverbSend);
      this.hums.push({ panner, gain, oscs });
    });
    this.running = true;
  }

  stopHum(i: number) {
    const h = this.hums[i];
    if (!h) return;
    const t = this.a.now;
    h.gain.gain.setTargetAtTime(0, t, 0.3);
    for (const o of h.oscs) o.stop(t + 2);
    this.hums[i] = undefined as unknown as SeedHum;
  }

  update(dt: number, opts: { awake: number; lakeDist: number; glide: number; speed: number; time: number }) {
    if (!this.running) return;
    const { ctx } = this.a;
    const t = ctx.currentTime;
    this.windFilter.frequency.setTargetAtTime(360 + Math.sin(opts.time * 0.13) * 160 + opts.speed * 12, t, 0.3);
    this.windGain.gain.setTargetAtTime(0.05 + 0.03 * Math.sin(opts.time * 0.21) + 0.02 * (1 - opts.awake), t, 0.5);
    this.waterGain.gain.setTargetAtTime(Math.max(0, 1 - opts.lakeDist / 45) * 0.12, t, 0.3);
    this.glideGain.gain.setTargetAtTime(opts.glide * 0.12, t, 0.1);
    this.glideFilter.frequency.setTargetAtTime(600 + opts.speed * 70, t, 0.1);

    // Crickets & night chirps — more where the forest is awake.
    this.cricketTimer -= dt;
    if (this.cricketTimer <= 0) {
      this.cricketTimer = 0.4 + Math.random() * (2.2 - opts.awake * 1.6);
      if (Math.random() < 0.25 + opts.awake * 0.7) this.chirp(opts.awake);
    }
  }

  private chirp(awake: number) {
    const { ctx } = this.a;
    const time = ctx.currentTime + 0.01;
    const f = 4200 + Math.random() * 1400;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.a.ambience);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const st = time + i * 0.07;
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.012 + awake * 0.012, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.05);
      o.connect(g).connect(pan);
      o.start(st);
      o.stop(st + 0.06);
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, time = this.a.now, dest: AudioNode = this.a.sfx, attack = 0.005) {
    const { ctx } = this.a;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, time);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(dest);
    o.start(time);
    o.stop(time + dur + 0.05);
    return g;
  }

  private sweep(f0: number, f1: number, dur: number, vol: number, q = 1.5, time = this.a.now) {
    const { ctx } = this.a;
    const n = this.a.noise();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, time);
    f.frequency.exponentialRampToValueAtTime(f1, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    n.connect(f).connect(g).connect(this.a.sfx);
    n.start(time, Math.random() * 2);
    n.stop(time + dur + 0.05);
  }

  private bell(n: number, time: number, vol: number, send = true) {
    const g = this.tone('sine', mtof(n), mtof(n) * 0.999, 2.4, vol, time);
    this.tone('sine', mtof(n) * 2.76, mtof(n) * 2.75, 0.9, vol * 0.3, time);
    if (send) g.connect(this.a.reverbSend);
  }

  jump(double: boolean) {
    if (!this.running) return;
    this.sweep(500, 2200, 0.28, 0.12, 2);
    this.tone('sine', double ? 700 : 520, double ? 1400 : 900, 0.25, 0.06);
    if (double) this.bell(86, this.a.now + 0.02, 0.05);
  }

  land(impact: number) {
    if (!this.running) return;
    const v = Math.min(1, impact / 25);
    this.tone('sine', 120, 45, 0.3, 0.25 * v);
    this.sweep(900, 200, 0.25, 0.08 * v, 1);
  }

  dash() {
    if (!this.running) return;
    this.sweep(300, 4000, 0.4, 0.22, 1.2);
    this.tone('sine', 180, 60, 0.35, 0.2);
    this.tone('triangle', 900, 1800, 0.2, 0.05);
  }

  collect() {
    if (!this.running) return;
    const t = this.a.now;
    [74, 78, 81, 85, 88, 90].forEach((n, i) => this.bell(n, t + i * 0.07, 0.09));
    this.sweep(3000, 9000, 1.2, 0.05, 3, t);
  }

  wave() {
    if (!this.running) return;
    const t = this.a.now;
    this.tone('sine', 70, 28, 3.5, 0.5, t, this.a.sfx, 0.02);
    const g = this.tone('sine', 140, 56, 2.5, 0.12, t);
    g.connect(this.a.reverbSend);
    this.sweep(200, 6000, 3.0, 0.12, 0.8, t);
    [62, 66, 69, 73, 76].forEach((n, i) => {
      const gg = this.tone('triangle', mtof(n), mtof(n), 4 + i * 0.3, 0.035, t + 0.3 + i * 0.12, this.a.sfx, 0.6);
      gg.connect(this.a.reverbSend);
    });
  }

  deliver() {
    if (!this.running) return;
    const t = this.a.now;
    [62, 69, 74, 78, 81].forEach((n, i) => this.bell(n, t + i * 0.12, 0.08));
    const g = this.tone('sine', 73.4, 73.4, 3, 0.2, t, this.a.sfx, 0.8);
    g.connect(this.a.reverbSend);
  }

  shadowKill() {
    if (!this.running) return;
    this.sweep(3000, 150, 0.6, 0.18, 2);
    this.tone('square', 220, 55, 0.4, 0.04);
    this.bell(93, this.a.now, 0.04);
  }

  hurt() {
    if (!this.running) return;
    this.tone('sawtooth', 110, 80, 0.25, 0.04);
  }

  extinguished() {
    if (!this.running) return;
    const t = this.a.now;
    [74, 69, 66, 62, 57].forEach((n, i) => this.bell(n, t + i * 0.25, 0.07));
    this.tone('sine', 220, 40, 3, 0.2, t);
  }

  ui() {
    if (!this.a.started) return;
    this.tone('sine', 1200, 1100, 0.12, 0.04);
  }

  finale() {
    if (!this.running) return;
    const t = this.a.now;
    this.tone('sine', 50, 25, 6, 0.6, t, this.a.sfx, 0.05);
    this.sweep(100, 8000, 6, 0.15, 0.6, t);
    for (let i = 0; i < 16; i++) this.bell(74 + [0, 4, 7, 11, 12, 16, 19, 23][i % 8], t + 1.5 + i * 0.18, 0.06);
  }
}
