import {
  AdditiveBlending, BufferGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, PointLight,
  ShaderMaterial, SphereGeometry, TorusGeometry, Vector3, DoubleSide,
} from 'three';
import { Rng } from '../core/math';
import { taperedTube, blob, merge } from './geometry';
import { awakenMaterial } from './materials';
import { getMaterials } from './palette';
import { PEDESTAL_RADIUS, SEED_COUNT, TREE_HEART_Y } from '../config';
import type { Heightfield } from './Heightfield';
import type { Colliders } from './Colliders';

export class AncientTree {
  readonly group = new Group();
  readonly heart: Mesh;
  readonly heartLight: PointLight;
  readonly pedestals: { pos: Vector3; ring: Mesh; lit: number; beam?: Mesh }[] = [];
  readonly progressUniform = { value: 0 };
  private heartMat: MeshBasicMaterial;
  private halo: Mesh;
  private beamMat: ShaderMaterial;
  /** 0..1 how many seeds were delivered (smoothed). */
  progress = 0;
  targetProgress = 0;
  flare = 0;

  constructor(hf: Heightfield, colliders: Colliders) {
    const rng = new Rng(777);
    const bark: BufferGeometry[] = [];
    const leaves: BufferGeometry[] = [];
    const vines: BufferGeometry[] = [];
    const bulbs: BufferGeometry[] = [];

    // Twisted trunk made of strands that split into the main branches.
    const strands = 7;
    const ys = [-1.5, 3, 7, 11, 15, 19, 23, 27, 31, 34];
    const rs = [5.8, 3.0, 2.3, 1.9, 1.8, 2.1, 3.4, 7.0, 11.5, 15.5];
    const branchEnds: Vector3[] = [];
    for (let k = 0; k < strands; k++) {
      const a0 = (k / strands) * Math.PI * 2;
      const pts = ys.map((y, i) => {
        const a = a0 + y * 0.075 + (i > 6 ? rng.range(-0.15, 0.15) : 0);
        const r = rs[i] * (i > 6 ? rng.range(0.8, 1.15) : 1);
        return new Vector3(Math.cos(a) * r, y + (i > 7 ? rng.range(-1.5, 1.5) : 0), Math.sin(a) * r);
      });
      bark.push(taperedTube(pts, 2.0, 0.4, 48, 10, 0.6));
      branchEnds.push(pts[pts.length - 1]);
      // Secondary branches.
      for (let b = 0; b < 2; b++) {
        const s = pts[7 + b].clone();
        const dir = s.clone().setY(0).normalize().applyAxisAngle(new Vector3(0, 1, 0), rng.range(-0.9, 0.9));
        const e = s.clone().addScaledVector(dir, rng.range(5, 8)).add(new Vector3(0, rng.range(2, 5), 0));
        const m = s.clone().lerp(e, 0.5).add(new Vector3(0, 1.2, 0));
        bark.push(taperedTube([s, m, e], 0.6, 0.18, 12, 7));
        branchEnds.push(e);
      }
    }
    // Roots.
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const len = rng.range(10, 16);
      const pts = [0, 0.25, 0.55, 0.8, 1].map((t, i) => {
        const r = 2.4 + t * len;
        const y = 2.2 - t * 3.6 + Math.sin(t * Math.PI) * rng.range(0.6, 1.6) * (i === 0 ? 0 : 1);
        const aa = a + Math.sin(t * 3) * 0.15;
        return new Vector3(Math.cos(aa) * r, y, Math.sin(aa) * r);
      });
      bark.push(taperedTube(pts, 1.1, 0.12, 24, 8));
    }

    // Canopy.
    for (const e of branchEnds) {
      const n = rng.int(1, 2);
      for (let i = 0; i < n; i++) {
        const b = blob(rng.range(4.2, 6.8), 3, rng.range(0, 100), 0.3, 0.62);
        b.translate(e.x + rng.range(-2, 2), e.y + rng.range(0, 2), e.z + rng.range(-2, 2));
        leaves.push(b);
      }
      // Hanging vines with glowing bulbs.
      const vn = rng.int(2, 4);
      for (let i = 0; i < vn; i++) {
        const sx = e.x + rng.range(-4, 4), sz = e.z + rng.range(-4, 4), sy = e.y - 1.5;
        const len = rng.range(5, 14);
        const sway = rng.range(-0.8, 0.8);
        const pts = [0, 0.33, 0.66, 1].map((t) => new Vector3(sx + Math.sin(t * 3) * sway, sy - t * len, sz + Math.cos(t * 2) * sway * 0.5));
        vines.push(taperedTube(pts, 0.08, 0.035, 10, 4));
        const end = pts[3];
        const bulb = new SphereGeometry(rng.range(0.18, 0.32), 10, 8);
        bulb.translate(end.x, end.y - 0.15, end.z);
        bulbs.push(bulb);
      }
    }
    for (let i = 0; i < 6; i++) {
      const b = blob(rng.range(6, 8), 3, rng.range(0, 100), 0.28, 0.55);
      const a = rng.range(0, Math.PI * 2), r = rng.range(0, 7);
      b.translate(Math.cos(a) * r, 36 + rng.range(0, 3), Math.sin(a) * r);
      leaves.push(b);
    }

    const prog = this.progressUniform;
    const barkMat = awakenMaterial(
      { color: new Color(0.085, 0.07, 0.065), roughness: 0.85, emissive: 0xffffff },
      {
        key: 'ancient-bark', occlude: true,
        uniforms: { uTreeProgress: prog },
        fragHead: 'uniform float uTreeProgress;',
        emissive: /* glsl */ `
          {
            float vein = pow(1.0 - abs(snoise(vec3(vAwLocal.x * 0.45, vAwLocal.y * 0.08 - uTime * 0.04, vAwLocal.z * 0.45))), 14.0);
            float lvl = uTreeProgress * 42.0;
            float climb = 1.0 - smoothstep(lvl - 1.0, lvl + 2.5, vAwLocal.y);
            float flow = 0.55 + 0.45 * sin(vAwLocal.y * 0.7 - uTime * 3.0);
            totalEmissiveRadiance = vec3(1.0, 0.72, 0.35) * vein * climb * flow * 3.2
              + vec3(0.25, 0.85, 1.0) * vein * 0.35;
          }`,
      },
    );
    const leafMat = awakenMaterial(
      { color: new Color(0.1, 0.12, 0.1), roughness: 0.7, emissive: 0xffffff, side: DoubleSide },
      {
        key: 'ancient-leaf', occlude: true,
        uniforms: { uTreeProgress: prog },
        fragHead: 'uniform float uTreeProgress;',
        emissive: /* glsl */ `
          {
            float sp = snoise(vAwPos * 0.32 + vec3(0.0, uTime * 0.05, 0.0));
            float spots = smoothstep(0.35, 0.85, sp);
            float under = smoothstep(-0.1, -0.85, vAwNrm.y);
            vec3 c = mix(vec3(0.2, 1.0, 0.8), vec3(1.0, 0.75, 0.35), uTreeProgress);
            c = mix(c, vec3(0.7, 0.4, 1.0), smoothstep(0.3, 0.9, snoise(vAwPos * 0.05)) * 0.6);
            totalEmissiveRadiance = c * (spots * 1.3 + under * 0.45 + 0.05) * mix(0.05, 1.0, aw) * (0.5 + uTreeProgress);
          }`,
      },
    );
    const bulbMat = awakenMaterial(
      { color: new Color(0.2, 0.18, 0.1), roughness: 0.4, emissive: 0xffffff },
      {
        key: 'ancient-bulb',
        drain: 0.3,
        emissive: /* glsl */ `
          totalEmissiveRadiance = vec3(1.0, 0.82, 0.5) * (2.2 + 1.0 * sin(uTime * 2.0 + vAwPos.x * 0.7 + vAwPos.y)) * mix(0.25, 1.3, aw);`,
      },
    );

    const barkMesh = new Mesh(merge(bark), barkMat);
    barkMesh.castShadow = barkMesh.receiveShadow = true;
    const leafMesh = new Mesh(merge(leaves), leafMat);
    leafMesh.castShadow = true;
    const vineMesh = new Mesh(merge(vines), getMaterials().stem);
    const bulbMesh = new Mesh(merge(bulbs), bulbMat);
    this.group.add(barkMesh, leafMesh, vineMesh, bulbMesh);
    const baseY = hf.height(0, 0);
    this.group.position.y = baseY - 0.3;

    // Heart of light.
    this.heartMat = new MeshBasicMaterial({ color: new Color(1.5, 1.2, 0.8) });
    this.heart = new Mesh(new SphereGeometry(1.3, 32, 16), this.heartMat);
    this.heart.position.y = TREE_HEART_Y;
    this.group.add(this.heart);

    const haloMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uIntensity: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          mv.xy += position.xy;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = exp(-d * 3.5) * (1.0 - smoothstep(0.8, 1.0, d));
          gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * a * uIntensity, 1.0);
        }`,
    });
    this.halo = new Mesh(new PlaneGeometry(12, 12), haloMat);
    this.halo.position.y = TREE_HEART_Y;
    this.halo.frustumCulled = false;
    this.group.add(this.halo);

    this.heartLight = new PointLight(new Color(1.0, 0.78, 0.5), 30, 60, 1.6);
    this.heartLight.position.y = TREE_HEART_Y;
    this.group.add(this.heartLight);

    colliders.add({ x: 0, z: 0, r: 5.0, bottom: -10, top: 40, walkable: false });

    // Pedestals.
    const pedMat = getMaterials().rune;
    const pedGeo = new CylinderGeometry(0.8, 1.15, 1.4, 8);
    const ringGeo = new TorusGeometry(0.95, 0.07, 8, 32);
    this.beamMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float flow = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 8.0);
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          gl_FragColor = vec4(vec3(1.0, 0.8, 0.45) * (0.6 + flow) * edge * 1.6, 1.0);
        }`,
    });
    for (let i = 0; i < SEED_COUNT; i++) {
      const a = (i / SEED_COUNT) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * PEDESTAL_RADIUS, z = Math.sin(a) * PEDESTAL_RADIUS;
      const h = hf.height(x, z);
      const ped = new Mesh(pedGeo, pedMat);
      ped.position.set(x, h + 0.55, z);
      ped.castShadow = ped.receiveShadow = true;
      const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: new Color(0.25, 0.2, 0.12) }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, h + 1.3, z);
      // Pedestals live in world space (the group is offset vertically).
      ped.position.y -= this.group.position.y;
      ring.position.y -= this.group.position.y;
      this.group.add(ped, ring);
      this.pedestals.push({ pos: new Vector3(x, h + 2.4, z), ring, lit: 0 });
      colliders.add({ x, z, r: 1.15, bottom: h - 1, top: h + 1.25, walkable: true });
    }
  }

  /** Heart world position. */
  heartWorld(out: Vector3) {
    return out.set(0, this.group.position.y + TREE_HEART_Y, 0);
  }

  lightPedestal(i: number) {
    const p = this.pedestals[i];
    p.lit = 0.001;
    const from = p.pos.clone();
    from.y -= this.group.position.y;
    const to = new Vector3(0, TREE_HEART_Y, 0);
    const len = from.distanceTo(to);
    const beam = new Mesh(new PlaneGeometry(0.35, len, 1, 1), this.beamMat);
    beam.position.copy(from).lerp(to, 0.5);
    beam.lookAt(to.clone().add(this.group.position));
    beam.rotateX(Math.PI / 2);
    beam.material.side = DoubleSide;
    beam.frustumCulled = false;
    beam.scale.x = 0.001;
    this.group.add(beam);
    // A second plane crossed at 90° so the beam reads from every angle.
    const beam2 = beam.clone();
    beam2.rotateY(Math.PI / 2);
    this.group.add(beam2);
    p.beam = beam;
    (p as { beam2?: Mesh }).beam2 = beam2;
  }

  update(dt: number, time: number) {
    this.progress += (this.targetProgress - this.progress) * Math.min(1, dt * 0.8);
    this.progressUniform.value = this.progress;
    this.flare = Math.max(0, this.flare - dt * 0.6);
    const pulse = 0.85 + 0.15 * Math.sin(time * 2.2) + 0.08 * Math.sin(time * 5.1);
    const k = (0.8 + this.progress * 5 + this.flare * 14) * pulse;
    this.heartMat.color.setRGB(1.5 * k, 1.15 * k, 0.75 * k);
    (this.halo.material as ShaderMaterial).uniforms.uIntensity.value = (0.35 + this.progress * 1.2 + this.flare * 4) * pulse;
    this.heartLight.intensity = (18 + this.progress * 80 + this.flare * 300) * pulse;
    this.heartLight.distance = 45 + this.progress * 40;
    this.beamMat.uniforms.uTime.value = time;
    for (const p of this.pedestals) {
      if (p.lit > 0) {
        p.lit = Math.min(1, p.lit + dt * 0.7);
        const c = (p.ring.material as MeshBasicMaterial).color;
        const g = 0.25 + p.lit * 3.5 * (0.85 + 0.15 * Math.sin(time * 3 + p.pos.x));
        c.setRGB(g, g * 0.78, g * 0.45);
        if (p.beam) {
          const s = Math.min(1, p.lit * 1.5);
          p.beam.scale.x = s;
          const b2 = (p as { beam2?: Mesh }).beam2;
          if (b2) b2.scale.x = s;
        }
      }
    }
  }
}
