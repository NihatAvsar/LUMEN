import {
  AdditiveBlending, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, PlaneGeometry, ShaderMaterial,
  Vector3,
} from 'three';
import { SEED_SPOTS, SKY_STAIR_SEED, WATER_Y } from '../config';
import type { Heightfield } from '../world/Heightfield';

export type SeedState = 'idle' | 'carried' | 'delivering' | 'placed';

export interface Seed {
  index: number;
  name: string;
  home: Vector3;
  pos: Vector3;
  state: SeedState;
  group: Group;
  crystal: Mesh;
  beam: Mesh;
  beamMat: ShaderMaterial;
  awakened: boolean;
  /** For delivery animation. */
  t: number;
  from: Vector3;
  to: Vector3;
  pedestal: number;
}

const beamVS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const beamFS = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float h = vUv.y;
    float edge = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 2.0);
    float a = pow(1.0 - h, 1.4) * edge;
    float flow = 0.7 + 0.3 * sin(h * 60.0 - uTime * 4.0);
    gl_FragColor = vec4(vec3(1.0, 0.85, 0.55) * a * flow * uAlpha, 1.0);
  }`;

const haloVS = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy;
    gl_Position = projectionMatrix * mv;
  }`;
const haloFS = /* glsl */ `
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = exp(-d * 3.5) * (1.0 - smoothstep(0.75, 1.0, d));
    gl_FragColor = vec4(vec3(1.0, 0.82, 0.5) * a * uIntensity, 1.0);
  }`;

export class Seeds {
  readonly group = new Group();
  readonly list: Seed[] = [];
  private haloMat: ShaderMaterial;
  private crystalMat: MeshBasicMaterial;

  constructor(hf: Heightfield, stairTop: Vector3) {
    this.crystalMat = new MeshBasicMaterial({ color: new Color(3.2, 2.6, 1.6) });
    this.haloMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uIntensity: { value: 0.9 } },
      vertexShader: haloVS,
      fragmentShader: haloFS,
    });
    const crystalGeo = new OctahedronGeometry(0.45, 0);
    crystalGeo.scale(1, 1.7, 1);
    const beamGeo = new CylinderGeometry(0.7, 0.7, 160, 16, 1, true).translate(0, 80, 0);
    const haloGeo = new PlaneGeometry(4, 4);

    SEED_SPOTS.forEach((s, i) => {
      let y: number;
      if (i === SKY_STAIR_SEED) y = stairTop.y + 1 + s.lift;
      else y = Math.max(hf.height(s.x, s.z), WATER_Y) + 1 + s.lift;
      const x = i === SKY_STAIR_SEED ? stairTop.x : s.x;
      const z = i === SKY_STAIR_SEED ? stairTop.z : s.z;
      const home = new Vector3(x, y, z);
      const g = new Group();
      const crystal = new Mesh(crystalGeo, this.crystalMat);
      g.add(crystal);
      const inner = new Mesh(crystalGeo, new MeshBasicMaterial({ color: new Color(6, 5, 3.5) }));
      inner.scale.setScalar(0.45);
      g.add(inner);
      const halo = new Mesh(haloGeo, this.haloMat);
      halo.frustumCulled = false;
      g.add(halo);
      g.position.copy(home);

      const beamMat = new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false,
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
        vertexShader: beamVS,
        fragmentShader: beamFS,
      });
      const beam = new Mesh(beamGeo, beamMat);
      beam.position.copy(home);
      beam.position.y -= 1.5;
      beam.frustumCulled = false;
      this.group.add(g, beam);

      this.list.push({
        index: i, name: s.name, home, pos: home.clone(), state: 'idle', group: g, crystal, beam, beamMat,
        awakened: false, t: 0, from: new Vector3(), to: new Vector3(), pedestal: -1,
      });
    });
  }

  get carried() {
    return this.list.filter((s) => s.state === 'carried');
  }

  get placedCount() {
    return this.list.filter((s) => s.state === 'placed').length;
  }

  update(dt: number, time: number, player: Vector3, camPos: Vector3) {
    let carriedIdx = 0;
    const carried = this.carried.length;
    for (const s of this.list) {
      const g = s.group;
      s.crystal.rotation.y += dt * 1.2;
      if (s.state === 'idle') {
        s.pos.copy(s.home);
        s.pos.y += Math.sin(time * 1.6 + s.index) * 0.25;
        g.scale.setScalar(1);
        // Fade the beacon as the player gets close so it does not blind.
        const d = Math.hypot(camPos.x - s.home.x, camPos.z - s.home.z);
        s.beamMat.uniforms.uAlpha.value = Math.min(1, Math.max(0.08, (d - 6) / 40)) * 0.9;
        s.beam.visible = true;
      } else if (s.state === 'carried') {
        const a = time * 1.8 + (carriedIdx / Math.max(1, carried)) * Math.PI * 2;
        const target = new Vector3(player.x + Math.cos(a) * 1.3, player.y + 0.5 + Math.sin(time * 2 + carriedIdx) * 0.25, player.z + Math.sin(a) * 1.3);
        s.pos.lerp(target, Math.min(1, dt * 10));
        g.scale.setScalar(0.45);
        s.beam.visible = false;
        carriedIdx++;
      } else if (s.state === 'delivering') {
        s.t = Math.min(1, s.t + dt * 0.9);
        const t = s.t;
        const e = t * t * (3 - 2 * t);
        s.pos.lerpVectors(s.from, s.to, e);
        s.pos.y += Math.sin(t * Math.PI) * 6;
        g.scale.setScalar(0.45 + e * 0.35);
        s.beam.visible = false;
        if (t >= 1) s.state = 'placed';
      } else {
        s.pos.copy(s.to);
        s.pos.y += Math.sin(time * 1.6 + s.index) * 0.12;
        g.scale.setScalar(0.8);
      }
      g.position.copy(s.pos);
      s.beamMat.uniforms.uTime.value = time;
    }
  }
}
