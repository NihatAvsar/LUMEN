import {
  AdditiveBlending, Blending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, NormalBlending, Points, ShaderMaterial, Vector3,
} from 'three';

export interface EmitOptions {
  pos: Vector3;
  count: number;
  color: Color;
  colorVar?: number;
  speed?: [number, number];
  /** Bias direction added to the random velocity. */
  dir?: Vector3;
  spread?: number;
  life?: [number, number];
  size?: [number, number];
  gravity?: number;
  drag?: number;
  /** Random position jitter radius. */
  jitter?: number;
  /** Size multiplier at end of life. */
  endSize?: number;
  alpha?: number;
}

/** CPU simulated particle pool rendered as soft points. */
export class ParticlePool {
  readonly points: Points;
  private max: number;
  private alive = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private endSize: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private baseAlpha: Float32Array;
  private geo: BufferGeometry;
  readonly material: ShaderMaterial;

  constructor(max: number, blending: Blending = AdditiveBlending, dark = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.endSize = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);

    const geo = new BufferGeometry();
    const mk = (arr: Float32Array, n: number) => {
      const a = new BufferAttribute(arr, n);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    geo.setAttribute('position', mk(this.pos, 3));
    geo.setAttribute('color', mk(this.col, 3));
    geo.setAttribute('aSize', mk(this.size, 1));
    geo.setAttribute('aAlpha', mk(this.alpha, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: { uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(aSize * uScale / -mv.z, 0.0);
        }`,
      fragmentShader: dark
        ? /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = 1.0 - smoothstep(0.2, 1.0, d);
          gl_FragColor = vec4(vColor, a * a * vAlpha);
        }`
        : /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = exp(-d * d * 6.0);
          float a = (1.0 - smoothstep(0.5, 1.0, d)) * 0.35 + core;
          gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
        }`,
    });
    if (blending === NormalBlending) this.material.premultipliedAlpha = false;
    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
  }

  setScale(s: number) {
    this.material.uniforms.uScale.value = s;
  }

  emit(o: EmitOptions) {
    const sp = o.speed ?? [1, 3];
    const lf = o.life ?? [0.6, 1.2];
    const sz = o.size ?? [0.1, 0.25];
    const spread = o.spread ?? 1;
    for (let n = 0; n < o.count; n++) {
      if (this.alive >= this.max) return;
      const i = this.alive++;
      const j = o.jitter ?? 0;
      this.pos[i * 3] = o.pos.x + (Math.random() - 0.5) * 2 * j;
      this.pos[i * 3 + 1] = o.pos.y + (Math.random() - 0.5) * 2 * j;
      this.pos[i * 3 + 2] = o.pos.z + (Math.random() - 0.5) * 2 * j;
      // Random direction on a sphere.
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = sp[0] + Math.random() * (sp[1] - sp[0]);
      let vx = r * Math.cos(th) * spread, vy = u * spread, vz = r * Math.sin(th) * spread;
      if (o.dir) {
        vx += o.dir.x;
        vy += o.dir.y;
        vz += o.dir.z;
      }
      this.vel[i * 3] = vx * s;
      this.vel[i * 3 + 1] = vy * s;
      this.vel[i * 3 + 2] = vz * s;
      const cv = o.colorVar ?? 0.1;
      this.col[i * 3] = Math.max(0, o.color.r * (1 + (Math.random() - 0.5) * cv));
      this.col[i * 3 + 1] = Math.max(0, o.color.g * (1 + (Math.random() - 0.5) * cv));
      this.col[i * 3 + 2] = Math.max(0, o.color.b * (1 + (Math.random() - 0.5) * cv));
      this.maxLife[i] = this.life[i] = lf[0] + Math.random() * (lf[1] - lf[0]);
      this.baseSize[i] = sz[0] + Math.random() * (sz[1] - sz[0]);
      this.endSize[i] = o.endSize ?? 0.2;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      this.baseAlpha[i] = o.alpha ?? 1;
      this.size[i] = this.baseSize[i];
      this.alpha[i] = 0;
    }
  }

  private kill(i: number) {
    const last = --this.alive;
    if (i === last) return;
    const c3 = (a: Float32Array) => {
      a[i * 3] = a[last * 3];
      a[i * 3 + 1] = a[last * 3 + 1];
      a[i * 3 + 2] = a[last * 3 + 2];
    };
    c3(this.pos);
    c3(this.vel);
    c3(this.col);
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.baseSize[i] = this.baseSize[last];
    this.endSize[i] = this.endSize[last];
    this.grav[i] = this.grav[last];
    this.drag[i] = this.drag[last];
    this.baseAlpha[i] = this.baseAlpha[last];
  }

  update(dt: number) {
    for (let i = 0; i < this.alive; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        i--;
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const fadeIn = Math.min(1, t * 8);
      this.alpha[i] = this.baseAlpha[i] * fadeIn * (1 - t) * (1 - t * 0.3);
      this.size[i] = this.baseSize[i] * (1 + (this.endSize[i] - 1) * t);
    }
    this.geo.setDrawRange(0, this.alive);
    const a = this.geo.attributes;
    a.position.needsUpdate = true;
    a.color.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
    // Only upload what is alive.
    for (const name of ['position', 'color', 'aSize', 'aAlpha']) {
      const attr = a[name] as BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, this.alive * attr.itemSize));
    }
  }

  get count() {
    return this.alive;
  }
}
