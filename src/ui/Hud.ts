import type { Seed } from '../game/Seeds';
import { angleDiff } from '../core/math';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private root = $('hud');
  private strip = $('compass-strip');
  private seedsEl = $('seeds');
  private energyEl = $('energy');
  private energyFill = $('energy-fill');
  private toastEl = $('toast');
  private narrativeEl = $('narrative');
  private hintEl = $('hint');
  private fpsEl = $('fps');
  private toastTimer = 0;
  private narrativeQueue: { text: string; dur: number }[] = [];
  private narrativeTimer = 0;
  private hintTimer = 0;
  private dirMarks: HTMLElement[] = [];
  private seedMarks: HTMLElement[] = [];
  private treeMark: HTMLElement;
  private seedIcons: HTMLElement[] = [];

  constructor(seedCount: number) {
    for (const d of ['K', 'D', 'G', 'B']) {
      const el = document.createElement('div');
      el.className = 'cmark dir';
      el.textContent = d;
      this.strip.appendChild(el);
      this.dirMarks.push(el);
    }
    for (let i = 0; i < seedCount; i++) {
      const el = document.createElement('div');
      el.className = 'cmark seed';
      this.strip.appendChild(el);
      this.seedMarks.push(el);
      const ico = document.createElement('div');
      ico.className = 'seed-ico';
      this.seedsEl.appendChild(ico);
      this.seedIcons.push(ico);
    }
    this.treeMark = document.createElement('div');
    this.treeMark.className = 'cmark tree';
    this.strip.appendChild(this.treeMark);
  }

  show(v: boolean) {
    this.root.classList.toggle('visible', v);
  }

  toast(title: string, sub = '', dur = 4) {
    this.toastEl.innerHTML = `<div class="t1"></div><div class="t2"></div>`;
    (this.toastEl.querySelector('.t1') as HTMLElement).textContent = title;
    (this.toastEl.querySelector('.t2') as HTMLElement).textContent = sub;
    this.toastEl.classList.add('visible');
    this.toastTimer = dur;
  }

  narrate(lines: string[], dur = 4.2) {
    for (const l of lines) this.narrativeQueue.push({ text: l, dur });
  }

  clearNarrative() {
    this.narrativeQueue = [];
    this.narrativeTimer = 0;
    this.narrativeEl.classList.remove('visible');
  }

  hint(text: string, dur = 6) {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('visible');
    this.hintTimer = dur;
  }

  setFps(text: string | null) {
    this.fpsEl.style.display = text ? 'block' : 'none';
    if (text) this.fpsEl.textContent = text;
  }

  update(dt: number, camYaw: number, px: number, pz: number, energy: number, seeds: Seed[]) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('visible');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.classList.remove('visible');
    }
    if (this.narrativeTimer > 0) {
      this.narrativeTimer -= dt;
      if (this.narrativeTimer <= 0.9 && this.narrativeEl.classList.contains('visible')) this.narrativeEl.classList.remove('visible');
    } else if (this.narrativeQueue.length) {
      const n = this.narrativeQueue.shift()!;
      this.narrativeEl.textContent = n.text;
      this.narrativeEl.classList.add('visible');
      this.narrativeTimer = n.dur + 1.0;
    }

    // Compass: heading = direction the camera faces.
    const heading = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
    const width = this.strip.clientWidth || 500;
    const fov = Math.PI * 0.9;
    const place = (el: HTMLElement, worldAngle: number) => {
      const d = angleDiff(worldAngle, heading);
      if (Math.abs(d) > fov / 2) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.left = `${(0.5 + d / fov) * width}px`;
    };
    // World angle convention: atan2(dx, dz). North = -z.
    const dirs = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
    this.dirMarks.forEach((el, i) => place(el, dirs[i]));
    seeds.forEach((s, i) => {
      const el = this.seedMarks[i];
      if (s.state !== 'idle') {
        el.style.display = 'none';
      } else place(el, Math.atan2(s.home.x - px, s.home.z - pz));
      this.seedIcons[i].className = 'seed-ico' + (s.state === 'carried' ? ' carried' : s.state === 'placed' || s.state === 'delivering' ? ' placed' : '');
    });
    const carrying = seeds.some((s) => s.state === 'carried');
    this.treeMark.style.opacity = carrying ? '1' : '0.45';
    place(this.treeMark, Math.atan2(-px, -pz));

    this.energyFill.style.width = `${Math.max(0, Math.min(1, energy)) * 100}%`;
    this.energyEl.classList.toggle('low', energy < 0.3);
  }
}
