import { AdditiveBlending, Color, CylinderGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Vector3 } from 'three';
import type { Awakening } from '../world/Awakening';
import type { Heightfield } from '../world/Heightfield';
import type { ParticlePool } from './Particles';

interface Ring {
  slot: number;
  mesh: Mesh;
  mat: ShaderMaterial;
  baseY: number;
  sparkAcc: number;
}

/** Expanding walls of light that follow the awakening wave fronts. */
export class Shockwaves {
  readonly group = new Group();
  private rings: Ring[] = [];
  private geo = new CylinderGeometry(1, 1, 1, 160, 1, true).translate(0, 0.5, 0);
  private tmp = new Vector3();
  private sparkColor = new Color(0.6, 1.4, 1.2);
  private sparkColor2 = new Color(1.6, 1.2, 0.6);

  constructor(private awakening: Awakening, private hf: Heightfield, private sparks: ParticlePool) {}

  spawn(slot: number, baseY: number) {
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uFade: { value: 1 }, uTime: { value: 0 }, uRadius: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uFade;
        uniform float uTime;
        uniform float uRadius;
        varying vec2 vUv;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float h = vUv.y;
          float graze = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float fres = 0.12 + 0.88 * pow(graze, 3.0);
          float a = pow(1.0 - h, 3.0) * smoothstep(0.0, 0.12, h);
          float rays = 0.6 + 0.4 * sin(vUv.x * 6.2831 * 40.0 + uTime * 3.0) * sin(vUv.x * 6.2831 * 13.0 - uTime * 2.0);
          vec3 c = mix(vec3(0.45, 1.0, 0.85), vec3(1.0, 0.85, 0.5), h);
          gl_FragColor = vec4(c * a * rays * uFade * fres * 1.3, 1.0);
        }`,
    });
    const mesh = new Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.rings.push({ slot, mesh, mat, baseY, sparkAcc: 0 });
  }

  update(dt: number, time: number, sparkRate: number, cam: Vector3) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const w = this.awakening.waves[r.slot];
      const radius = Math.max(0.1, w.radius);
      r.mesh.position.set(w.x, r.baseY - 8, w.z);
      r.mesh.scale.set(radius, 26, radius);
      // Fade out when the camera is about to pass through the wall.
      const camD = Math.abs(Math.hypot(cam.x - w.x, cam.z - w.z) - radius);
      const near = Math.min(1, Math.max(0, (camD - 2) / 16));
      r.mat.uniforms.uFade.value = w.front * near * near;
      r.mat.uniforms.uTime.value = time;
      r.mat.uniforms.uRadius.value = radius;

      // Throw sparks along the circumference as the front passes.
      r.sparkAcc += dt * sparkRate * w.front * Math.min(1, radius / 20);
      while (r.sparkAcc > 1) {
        r.sparkAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const x = w.x + Math.cos(a) * radius, z = w.z + Math.sin(a) * radius;
        this.tmp.set(x, this.hf.ground(x, z) + 0.3, z);
        this.sparks.emit({
          pos: this.tmp,
          count: 1,
          color: Math.random() < 0.7 ? this.sparkColor : this.sparkColor2,
          speed: [1, 4],
          dir: new Vector3(Math.cos(a) * 0.4, 1.6, Math.sin(a) * 0.4),
          spread: 0.4,
          life: [1.0, 2.2],
          size: [0.12, 0.3],
          gravity: -0.6,
          drag: 0.8,
          jitter: 0.6,
          endSize: 0.3,
        });
      }

      if (w.t >= 1 && w.front <= 0.001) {
        this.group.remove(r.mesh);
        r.mat.dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}
