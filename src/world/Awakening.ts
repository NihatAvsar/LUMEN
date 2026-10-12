import { Vector3, Vector4 } from 'three';
import { clamp, easeOutCubic, smoothstep } from '../core/math';

interface Wave {
  x: number;
  z: number;
  from: number;
  to: number;
  t: number;
  duration: number;
  radius: number;
  front: number;
}

export const TREE_SLOT = 0;
export const TREE_BASE_RADIUS = 16;

/**
 * The world-wide "awakening" field. Every collected seed starts a wave of life that
 * spreads out; shaders read the same data through shared uniforms.
 */
export class Awakening {
  readonly waves: Wave[] = [];
  readonly uniforms = {
    uAwake: { value: Array.from({ length: 8 }, () => new Vector4()) },
    uGloom: { value: Array.from({ length: 12 }, () => new Vector4()) },
    uTime: { value: 0 },
    /** Point the camera looks at; geometry between camera and it is dithered away. */
    uViewTarget: { value: new Vector3() },
  };
  /** 0..1 global progress used for sky, fog and music. */
  progress = 0;

  constructor() {
    for (let i = 0; i < 8; i++) {
      this.waves.push({ x: 0, z: 0, from: 0, to: 0, t: 1, duration: 1, radius: 0, front: 0 });
    }
    const tree = this.waves[TREE_SLOT];
    tree.radius = tree.to = tree.from = TREE_BASE_RADIUS;
  }

  reset() {
    for (let i = 0; i < 8; i++) {
      const w = this.waves[i];
      w.radius = w.from = w.to = i === TREE_SLOT ? TREE_BASE_RADIUS : 0;
      w.t = w.duration = 1;
      w.front = 0;
    }
    this.progress = 0;
    this.sync();
  }

  /** Expand wave `slot` from its current radius to `to` over `duration` seconds. */
  trigger(slot: number, x: number, z: number, to: number, duration: number) {
    const w = this.waves[slot];
    w.x = x;
    w.z = z;
    w.from = w.radius;
    w.to = to;
    w.t = 0;
    w.duration = duration;
  }

  isExpanding(slot: number) {
    return this.waves[slot].t < 1;
  }

  update(dt: number, time: number) {
    for (const w of this.waves) {
      if (w.t < 1) {
        w.t = Math.min(1, w.t + dt / w.duration);
        w.radius = w.from + (w.to - w.from) * easeOutCubic(w.t);
        // Bright front while expanding, fading out near the end.
        w.front = (1 - smoothstep(0.7, 1.0, w.t)) * smoothstep(0, 0.04, w.t);
      } else {
        w.front = Math.max(0, w.front - dt * 2);
      }
    }
    this.uniforms.uTime.value = time;
    this.sync();
  }

  private sync() {
    const u = this.uniforms.uAwake.value;
    for (let i = 0; i < 8; i++) {
      const w = this.waves[i];
      u[i].set(w.x, w.z, w.radius, w.front);
    }
  }

  /** CPU mirror of awakeAmt() (without edge noise). */
  at(x: number, z: number) {
    let a = 0;
    for (const w of this.waves) {
      const d = Math.hypot(x - w.x, z - w.z);
      a = Math.max(a, (1 - smoothstep(w.radius - 10, w.radius, d)) * clamp(w.radius * 0.1, 0, 1));
    }
    return a;
  }

  /** Distance to the nearest active wave front, used for spark emission. */
  frontRadius(slot: number) {
    return this.waves[slot].radius;
  }
}
