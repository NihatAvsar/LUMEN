/** Web Audio graph: master → compressor, with music/sfx buses and a shared reverb. */
export class AudioEngine {
  ctx!: AudioContext;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  ambience!: GainNode;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  /** Low-pass on the music bus (closes when in danger). */
  musicFilter!: BiquadFilterNode;
  noiseBuffer!: AudioBuffer;
  started = false;
  volumes = { master: 0.8, music: 0.7, sfx: 0.8 };

  start() {
    if (this.started) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(this.volumes.master, ctx.currentTime + 3);
    this.master.connect(comp);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(4.5, 2.6);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.9;
    this.reverb.connect(revOut).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.reverb);

    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicFilter.connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = this.volumes.music;
    this.music.connect(this.musicFilter);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.volumes.sfx;
    this.sfx.connect(this.master);

    this.ambience = ctx.createGain();
    this.ambience.gain.value = 1;
    this.ambience.connect(this.sfx);

    const len = ctx.sampleRate * 3;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.started = true;
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }

  setVolumes(v: { master: number; music: number; sfx: number }) {
    this.volumes = { ...v };
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.1);
    this.music.gain.setTargetAtTime(v.music, t, 0.1);
    this.sfx.gain.setTargetAtTime(v.sfx, t, 0.1);
  }

  get now() {
    return this.ctx.currentTime;
  }

  noise(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number) {
    if (!this.started) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(px, t, 0.05);
      l.positionY.setTargetAtTime(py, t, 0.05);
      l.positionZ.setTargetAtTime(pz, t, 0.05);
      l.forwardX.setTargetAtTime(fx, t, 0.05);
      l.forwardY.setTargetAtTime(fy, t, 0.05);
      l.forwardZ.setTargetAtTime(fz, t, 0.05);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(px, py, pz);
    }
  }
}
