import {
  BackSide, Color, Mesh, MeshBasicMaterial, ShaderMaterial, SphereGeometry, Group, AdditiveBlending, PlaneGeometry,
} from 'three';
import { MOON_DIR, MOON_DISTANCE } from '../config';
import { NOISE_GLSL } from '../shaders/chunks';

export class Sky {
  readonly group = new Group();
  readonly moon: Mesh;
  readonly material: ShaderMaterial;

  constructor(fogColor: Color) {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uMoonDir: { value: MOON_DIR.clone() },
        uAurora: { value: 0.12 },
        uProgress: { value: 0 },
        uHorizon: { value: fogColor },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uMoonDir;
        uniform float uAurora;
        uniform float uProgress;
        uniform vec3 uHorizon;
        varying vec3 vDir;
        ${NOISE_GLSL}

        float hash13(vec3 p3) {
          p3 = fract(p3 * 0.1031);
          p3 += dot(p3, p3.zyx + 31.32);
          return fract((p3.x + p3.y) * p3.z);
        }
        vec3 hash33(vec3 p3) {
          p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
          p3 += dot(p3, p3.yxz + 33.33);
          return fract((p3.xxy + p3.yxx) * p3.zyx);
        }

        float stars(vec3 d, float scale, float thresh) {
          vec3 p = d * scale;
          vec3 id = floor(p);
          vec3 f = fract(p) - 0.5;
          float h = hash13(id);
          if (h < thresh) return 0.0;
          vec3 o = (hash33(id) - 0.5) * 0.7;
          float dist = length(f - o);
          float tw = 0.55 + 0.45 * sin(uTime * (1.5 + h * 4.0) + h * 80.0);
          float b = smoothstep(0.09, 0.0, dist) * tw;
          return b * (h > 0.997 ? 4.0 : 1.2);
        }

        float auroraFbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.07 + vec2(1.7, 9.2); a *= 0.5; }
          return s;
        }

        vec3 aurora(vec3 d) {
          if (d.y < 0.03) return vec3(0.0);
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 18; i++) {
            float fi = float(i);
            float hgt = 1.0 + fi * 0.045;
            vec2 p = d.xz * (hgt / (d.y + 0.08));
            p += vec2(0.0, uTime * 0.012);
            float band = auroraFbm(p * vec2(0.55, 1.6) + vec2(uTime * 0.02, 0.0));
            float curtain = sin(p.x * 1.4 + band * 6.0 + uTime * 0.08) * 0.5 + 0.5;
            float v = pow(curtain, 6.0) * smoothstep(0.35, 0.75, band);
            vec3 col = mix(vec3(0.1, 1.0, 0.55), vec3(0.2, 0.6, 1.0), fi / 18.0);
            col = mix(col, vec3(0.85, 0.25, 1.0), smoothstep(10.0, 18.0, fi));
            acc += col * v * (1.0 - fi / 18.0);
          }
          float fade = smoothstep(0.03, 0.25, d.y) * (1.0 - smoothstep(0.75, 0.98, d.y));
          return acc * 0.09 * fade;
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 zenith = mix(vec3(0.002, 0.004, 0.014), vec3(0.008, 0.01, 0.035), uProgress);
          vec3 col = mix(uHorizon, zenith, pow(clamp(h, 0.0, 1.0), 0.42));
          col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.1, h));

          // Milky way band.
          vec3 band = normalize(vec3(0.3, 0.85, 0.42));
          float bd = abs(dot(d, band));
          float mw = (1.0 - smoothstep(0.0, 0.32, bd)) * (snoise(d * 4.0) * 0.5 + 0.5) * (snoise(d * 11.0) * 0.3 + 0.7);
          col += vec3(0.05, 0.05, 0.11) * mw * smoothstep(0.0, 0.25, h);

          float st = stars(d, 260.0, 0.982) + stars(d, 560.0, 0.990) * 0.6;
          st *= smoothstep(-0.02, 0.22, h) * (1.0 - mw * 0.3);
          col += vec3(0.85, 0.9, 1.0) * st;

          // Moon halo.
          float md = max(dot(d, uMoonDir), 0.0);
          col += vec3(0.55, 0.65, 0.95) * pow(md, 90.0) * 0.8;
          col += vec3(0.18, 0.24, 0.48) * pow(md, 10.0) * 0.22;

          col += aurora(d) * uAurora;

          gl_FragColor = vec4(col, 1.0);
        }`,
    });

    const sky = new Mesh(new SphereGeometry(1000, 48, 24), this.material);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.group.add(sky);

    // Moon: a bright HDR disc that also drives the god rays.
    const moonMat = new MeshBasicMaterial({ color: new Color(2.4, 2.6, 3.0), fog: false, transparent: true, depthWrite: false });
    this.moon = new Mesh(new SphereGeometry(26, 32, 16), moonMat);
    this.moon.position.copy(MOON_DIR).multiplyScalar(MOON_DISTANCE);
    this.moon.frustumCulled = false;
    this.group.add(this.moon);

    // Soft glow disc behind the moon.
    const glowMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = exp(-d * 4.0) * 0.6;
          gl_FragColor = vec4(vec3(0.5, 0.65, 1.0) * a, 1.0);
        }`,
    });
    const glow = new Mesh(new PlaneGeometry(260, 260), glowMat);
    glow.position.copy(MOON_DIR).multiplyScalar(MOON_DISTANCE + 10);
    glow.lookAt(0, 0, 0);
    glow.frustumCulled = false;
    this.group.add(glow);
  }

  update(time: number, cameraPos: { x: number; y: number; z: number }) {
    this.material.uniforms.uTime.value = time;
    this.group.position.set(cameraPos.x, cameraPos.y, cameraPos.z);
  }
}
