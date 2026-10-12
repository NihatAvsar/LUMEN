import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera,
  PlaneGeometry, PointLight, ShaderMaterial, SphereGeometry, Vector3, DynamicDrawUsage,
} from 'three';
import { NOISE_GLSL } from '../shaders/chunks';

const TRAIL = 48;

/** Visual representation of the player: a small spirit of light. */
export class Spirit {
  readonly group = new Group();
  readonly light: PointLight;
  readonly lightColor = new Color(0.55, 0.95, 1.0);
  private core: Mesh;
  private coreMat: MeshBasicMaterial;
  private shellMat: ShaderMaterial;
  private haloMat: ShaderMaterial;
  private halo: Mesh;
  private motes: Mesh[] = [];
  private trailGeo: BufferGeometry;
  private trailPts: Vector3[] = [];
  private trailMat: ShaderMaterial;
  readonly trail: Mesh;
  private trailTimer = 0;
  private squash = 0;
  private tmpA = new Vector3();
  private tmpB = new Vector3();
  private tmpC = new Vector3();

  constructor() {
    this.coreMat = new MeshBasicMaterial({ color: new Color(4, 5, 5.5) });
    this.core = new Mesh(new SphereGeometry(0.22, 24, 16), this.coreMat);
    this.group.add(this.core);

    this.shellMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uEnergy: { value: 1 }, uDash: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        ${NOISE_GLSL}
        void main() {
          vec3 p = position;
          float n = snoise(normal * 2.2 + vec3(0.0, uTime * 1.4, 0.0));
          p += normal * n * 0.09;
          vP = position;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uDash;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vP;
        ${NOISE_GLSL}
        void main() {
          float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
          float swirl = snoise(vP * 4.0 + vec3(uTime * 0.8, -uTime * 1.2, 0.0)) * 0.5 + 0.5;
          vec3 c = mix(vec3(0.3, 0.9, 1.0), vec3(0.75, 0.55, 1.0), swirl);
          c = mix(c, vec3(1.0, 0.9, 0.7), uDash);
          float a = (f * 1.4 + swirl * 0.25) * (0.35 + 0.65 * uEnergy);
          gl_FragColor = vec4(c * a * 1.8, 1.0);
        }`,
    });
    const shell = new Mesh(new SphereGeometry(0.5, 48, 32), this.shellMat);
    this.group.add(shell);

    this.haloMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uIntensity: { value: 1 }, uColor: { value: new Color(0.4, 0.9, 1.0) } },
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
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = exp(-d * 4.0) * (1.0 - smoothstep(0.7, 1.0, d));
          gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
        }`,
    });
    this.halo = new Mesh(new PlaneGeometry(3.2, 3.2), this.haloMat);
    this.halo.frustumCulled = false;
    this.group.add(this.halo);

    const moteGeo = new SphereGeometry(0.045, 8, 6);
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(moteGeo, new MeshBasicMaterial({ color: i % 2 ? new Color(3, 4, 5) : new Color(4, 3, 5) }));
      this.motes.push(m);
      this.group.add(m);
    }

    this.light = new PointLight(this.lightColor, 14, 26, 1.5);
    this.light.position.y = 0.2;
    this.group.add(this.light);

    // Ribbon trail (world space).
    const verts = new Float32Array(TRAIL * 2 * 3);
    const uvs = new Float32Array(TRAIL * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL; i++) {
      uvs[i * 4] = 0;
      uvs[i * 4 + 1] = i / (TRAIL - 1);
      uvs[i * 4 + 2] = 1;
      uvs[i * 4 + 3] = i / (TRAIL - 1);
      if (i < TRAIL - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    this.trailGeo = new BufferGeometry();
    const pa = new BufferAttribute(verts, 3);
    pa.setUsage(DynamicDrawUsage);
    this.trailGeo.setAttribute('position', pa);
    this.trailGeo.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.trailGeo.setIndex(idx);
    this.trailMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uAlpha;
        varying vec2 vUv;
        void main() {
          float t = vUv.y;
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          edge = pow(edge, 1.5);
          float a = pow(1.0 - t, 1.6) * edge * uAlpha;
          float sh = 0.75 + 0.25 * sin(t * 30.0 - uTime * 12.0);
          vec3 c = mix(vec3(0.5, 1.0, 1.0), vec3(0.7, 0.4, 1.0), t);
          gl_FragColor = vec4(c * a * sh * 1.6, 1.0);
        }`,
    });
    this.trail = new Mesh(this.trailGeo, this.trailMat);
    this.trail.frustumCulled = false;
  }

  resetTrail(p: Vector3) {
    this.trailPts = [];
    for (let i = 0; i < TRAIL; i++) this.trailPts.push(p.clone());
  }

  land(strength: number) {
    this.squash = Math.min(1, strength);
  }

  update(dt: number, time: number, pos: Vector3, energy: number, speed: number, dash: number, camera: PerspectiveCamera) {
    const bob = Math.sin(time * 2.4) * 0.08;
    this.group.position.set(pos.x, pos.y + bob, pos.z);
    this.squash = Math.max(0, this.squash - dt * 4);
    const sq = Math.sin(this.squash * Math.PI) * 0.25;
    this.group.scale.set(1 + sq, 1 - sq, 1 + sq);

    const flicker = energy < 0.25 ? 0.6 + 0.4 * Math.sin(time * 23) * Math.sin(time * 7.3) : 1;
    const e = (0.35 + 0.65 * energy) * flicker;
    const pulse = 1 + 0.08 * Math.sin(time * 5);
    this.coreMat.color.setRGB(4 * e * pulse + dash * 4, 5 * e * pulse + dash * 3, 5.5 * e * pulse + dash * 2);
    this.shellMat.uniforms.uTime.value = time;
    this.shellMat.uniforms.uEnergy.value = e;
    this.shellMat.uniforms.uDash.value = dash;
    this.haloMat.uniforms.uIntensity.value = (0.55 + dash * 1.5) * e;
    this.light.intensity = 16 * e + dash * 20;
    this.light.distance = 18 + 12 * e;

    this.motes.forEach((m, i) => {
      const a = time * (1.6 + i * 0.35) + i * 1.7;
      const r = 0.75 + Math.sin(time * 1.3 + i) * 0.12;
      m.position.set(Math.cos(a) * r, Math.sin(a * 0.7 + i) * 0.35, Math.sin(a) * r);
    });

    // Trail.
    if (this.trailPts.length === 0) this.resetTrail(this.group.position);
    this.trailTimer += dt;
    const head = this.trailPts[0];
    head.copy(this.group.position);
    if (this.trailTimer > 0.016) {
      this.trailTimer = 0;
      const last = this.trailPts.pop()!;
      last.copy(head);
      this.trailPts.unshift(last);
    }
    const arr = this.trailGeo.attributes.position.array as Float32Array;
    const camPos = camera.position;
    for (let i = 0; i < TRAIL; i++) {
      const p = this.trailPts[i];
      const n = this.trailPts[Math.min(TRAIL - 1, i + 1)];
      const prev = this.trailPts[Math.max(0, i - 1)];
      const tangent = this.tmpA.subVectors(prev, n);
      if (tangent.lengthSq() < 1e-6) tangent.set(0, 1, 0);
      tangent.normalize();
      const toCam = this.tmpB.subVectors(camPos, p).normalize();
      const side = this.tmpC.crossVectors(tangent, toCam).normalize();
      const w = 0.32 * (1 - i / TRAIL) * (0.6 + 0.4 * e) + dash * 0.25;
      arr[i * 6] = p.x + side.x * w;
      arr[i * 6 + 1] = p.y + side.y * w;
      arr[i * 6 + 2] = p.z + side.z * w;
      arr[i * 6 + 3] = p.x - side.x * w;
      arr[i * 6 + 4] = p.y - side.y * w;
      arr[i * 6 + 5] = p.z - side.z * w;
    }
    this.trailGeo.attributes.position.needsUpdate = true;
    this.trailMat.uniforms.uTime.value = time;
    this.trailMat.uniforms.uAlpha.value = Math.min(1, 0.25 + speed / 10) * e;
  }
}
