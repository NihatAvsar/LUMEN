import { Color, Group, Mesh, MeshBasicMaterial, ShaderMaterial, SphereGeometry, Vector3, NormalBlending } from 'three';
import { NOISE_GLSL } from '../shaders/chunks';
import { Rng } from '../core/math';
import { SEED_SPOTS, CLEARING_RADIUS, LAKE } from '../config';
import type { Heightfield } from '../world/Heightfield';
import type { Awakening } from '../world/Awakening';
import type { ParticlePool } from '../fx/Particles';

interface Shade {
  home: Vector3;
  pos: Vector3;
  vel: Vector3;
  group: Group;
  mat: ShaderMaterial;
  eyes: Mesh[];
  alive: boolean;
  respawn: number;
  wanderT: number;
  wanderTarget: Vector3;
  chasing: boolean;
  phase: number;
  fade: number;
  smokeAcc: number;
}

const BODY_VS = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNoise;
  ${NOISE_GLSL}
  void main() {
    vec3 p = position;
    float n = snoise(normal * 1.6 + vec3(uTime * 0.9 + uPhase, uTime * 0.6, 0.0));
    float tail = smoothstep(0.2, -1.0, normal.y);
    p += normal * n * 0.35;
    p.y -= tail * (0.6 + 0.4 * sin(uTime * 3.0 + uPhase + p.x * 3.0));
    vNoise = n;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const BODY_FS = /* glsl */ `
  uniform float uFade;
  uniform float uAnger;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNoise;
  void main() {
    float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
    vec3 core = vec3(0.004, 0.0, 0.012);
    vec3 rim = mix(vec3(0.35, 0.08, 0.75), vec3(0.9, 0.1, 0.4), uAnger);
    vec3 c = core + rim * f * (1.2 + vNoise * 0.6);
    float a = (0.92 - f * 0.25) * uFade;
    gl_FragColor = vec4(c, a);
  }`;

/** "Söndürücü" — shadow wisps that drain the player's light. */
export class Shadows {
  readonly group = new Group();
  readonly list: Shade[] = [];
  private bodyGeo = new SphereGeometry(0.85, 32, 20);
  private eyeGeo = new SphereGeometry(0.09, 8, 6);
  private tmp = new Vector3();
  private smokeColor = new Color(0.03, 0.0, 0.06);
  private burstColor = new Color(0.9, 0.4, 1.6);
  /** Smoothed danger level 0..1 for post FX and audio. */
  danger = 0;
  nearestDist = Infinity;
  time = 0;

  constructor(private hf: Heightfield, private awakening: Awakening, private smoke: ParticlePool, private sparks: ParticlePool) {
    const rng = new Rng(9001);
    SEED_SPOTS.forEach((s) => {
      for (let i = 0; i < s.guards; i++) {
        const a = rng.range(0, Math.PI * 2), d = rng.range(8, 16);
        this.spawnShade(new Vector3(s.x + Math.cos(a) * d, 0, s.z + Math.sin(a) * d), rng);
      }
    });
    let n = 0;
    while (n < 8) {
      const x = rng.range(-150, 150), z = rng.range(-150, 150);
      const r = Math.hypot(x, z);
      if (r < CLEARING_RADIUS + 25 || r > 160 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) continue;
      this.spawnShade(new Vector3(x, 0, z), rng);
      n++;
    }
  }

  private spawnShade(home: Vector3, rng: Rng) {
    home.y = this.hf.ground(home.x, home.z) + 1.6;
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: { uTime: { value: 0 }, uPhase: { value: rng.range(0, 100) }, uFade: { value: 1 }, uAnger: { value: 0 } },
      vertexShader: BODY_VS,
      fragmentShader: BODY_FS,
    });
    const g = new Group();
    const body = new Mesh(this.bodyGeo, mat);
    body.renderOrder = 2;
    g.add(body);
    const eyes: Mesh[] = [];
    for (const sx of [-0.22, 0.22]) {
      const e = new Mesh(this.eyeGeo, new MeshBasicMaterial({ color: new Color(3.5, 0.6, 2.2), transparent: true }));
      e.position.set(sx, 0.12, 0.7);
      e.scale.set(1.3, 0.7, 1);
      e.renderOrder = 3;
      g.add(e);
      eyes.push(e);
    }
    g.position.copy(home);
    this.group.add(g);
    this.list.push({
      home: home.clone(), pos: home.clone(), vel: new Vector3(), group: g, mat, eyes, alive: true, respawn: 0,
      wanderT: 0, wanderTarget: home.clone(), chasing: false, phase: rng.range(0, 10), fade: 1, smokeAcc: 0,
    });
  }

  /** Kill shades within a radius (used by awakening waves). */
  purge(x: number, z: number, radius: number) {
    for (const s of this.list) {
      if (s.alive && Math.hypot(s.pos.x - x, s.pos.z - z) < radius) this.kill(s, 40);
    }
  }

  private kill(s: Shade, respawn: number) {
    s.alive = false;
    s.respawn = respawn;
    this.sparks.emit({ pos: s.pos, count: 60, color: this.burstColor, speed: [2, 9], life: [0.5, 1.4], size: [0.1, 0.3], drag: 2.5, gravity: -1 });
    this.smoke.emit({ pos: s.pos, count: 40, color: this.smokeColor, speed: [1, 4], life: [0.8, 1.8], size: [0.8, 1.6], drag: 2, endSize: 2.2, alpha: 0.8 });
  }

  /**
   * Updates AI. Returns the energy drain per second applied to the player.
   * `dashing` lets the player destroy shades on contact.
   */
  update(dt: number, time: number, player: Vector3, dashing: boolean, onKill: (p: Vector3) => void): number {
    this.time = time;
    let drain = 0;
    let nearest = Infinity;
    for (const s of this.list) {
      if (!s.alive) {
        s.respawn -= dt;
        s.fade = Math.max(0, s.fade - dt * 3);
        if (s.respawn <= 0 && this.awakening.at(s.home.x, s.home.z) < 0.3 && player.distanceTo(s.home) > 30) {
          s.alive = true;
          s.pos.copy(s.home);
          s.vel.set(0, 0, 0);
        }
        s.group.visible = s.fade > 0.01;
        s.mat.uniforms.uFade.value = s.fade;
        continue;
      }
      s.fade = Math.min(1, s.fade + dt * 0.8);
      const toP = this.tmp.subVectors(player, s.pos);
      const dist = toP.length();
      const playerAwake = this.awakening.at(player.x, player.z);
      const homeDist = Math.hypot(s.pos.x - s.home.x, s.pos.z - s.home.z);

      s.chasing = dist < 22 && playerAwake < 0.6 && homeDist < 45;
      let desired: Vector3;
      let speed: number;
      if (s.chasing) {
        desired = player;
        speed = 6.2;
      } else {
        s.wanderT -= dt;
        if (s.wanderT <= 0) {
          s.wanderT = 3 + Math.random() * 4;
          const a = Math.random() * Math.PI * 2, d = Math.random() * 14;
          s.wanderTarget.set(s.home.x + Math.cos(a) * d, 0, s.home.z + Math.sin(a) * d);
        }
        desired = s.wanderTarget;
        speed = 2;
      }
      const dx = desired.x - s.pos.x, dz = desired.z - s.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      const k = Math.min(1, dt * 2.5);
      s.vel.x += ((dx / dl) * speed - s.vel.x) * k;
      s.vel.z += ((dz / dl) * speed - s.vel.z) * k;
      // Recoil from awakened ground.
      const awHere = this.awakening.at(s.pos.x + s.vel.x * 0.5, s.pos.z + s.vel.z * 0.5);
      if (awHere > 0.5) {
        s.vel.x *= -0.5;
        s.vel.z *= -0.5;
      }
      s.pos.x += s.vel.x * dt;
      s.pos.z += s.vel.z * dt;
      const gy = this.hf.ground(s.pos.x, s.pos.z);
      const targetY = s.chasing ? Math.max(gy + 1.3, player.y) : gy + 1.6;
      s.pos.y += (targetY + Math.sin(time * 1.7 + s.phase) * 0.35 - s.pos.y) * Math.min(1, dt * 3);
      s.group.position.copy(s.pos);
      s.group.lookAt(player.x, s.pos.y, player.z);

      const anger = s.chasing ? 1 : 0;
      s.mat.uniforms.uAnger.value += (anger - s.mat.uniforms.uAnger.value) * Math.min(1, dt * 3);
      s.mat.uniforms.uTime.value = time;
      s.mat.uniforms.uFade.value = s.fade;
      s.group.visible = true;
      const blink = Math.sin(time * 0.7 + s.phase * 3) > 0.97 ? 0.1 : 1;
      for (const e of s.eyes) e.scale.y = 0.7 * blink;

      // Smoke trail.
      s.smokeAcc += dt * (s.chasing ? 30 : 12);
      while (s.smokeAcc > 1) {
        s.smokeAcc -= 1;
        this.smoke.emit({
          pos: s.pos, count: 1, color: this.smokeColor, speed: [0.2, 0.8], life: [1.0, 2.0], size: [0.6, 1.2],
          dir: new Vector3(0, 0.3, 0), drag: 1, jitter: 0.5, endSize: 2.0, alpha: 0.55,
        });
      }

      if (dist < 2.6 && dashing) {
        this.kill(s, 30);
        onKill(s.pos);
        continue;
      }
      if (dist < 3.2) drain += 22 * (1 - dist / 3.2) + 6;
      nearest = Math.min(nearest, dist);
    }
    this.nearestDist = nearest;
    const target = 1 - Math.min(1, Math.max(0, (nearest - 2.5) / 12));
    this.danger += (target - this.danger) * Math.min(1, dt * 3);
    return drain;
  }

  /** Writes the closest shades into the gloom uniform array. */
  writeGloom(arr: { set(x: number, y: number, z: number, w: number): unknown }[], player: Vector3) {
    const alive = this.list
      .filter((s) => s.fade > 0.02)
      .sort((a, b) => a.pos.distanceToSquared(player) - b.pos.distanceToSquared(player));
    for (let i = 0; i < arr.length; i++) {
      const s = alive[i];
      if (s) arr[i].set(s.pos.x, s.pos.y - 0.8, s.pos.z, s.fade);
      else arr[i].set(0, -1000, 0, 0);
    }
  }
}
