import { HalfFloatType, Mesh, PerspectiveCamera, Scene, Uniform, Vector2, Vector3, WebGLRenderer } from 'three';
import {
  BlendFunction, BloomEffect, ChromaticAberrationEffect, DepthOfFieldEffect, Effect, EffectComposer, EffectPass, GodRaysEffect,
  KernelSize, NoiseEffect, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import type { QualityPreset } from './Settings';

const MOOD_FS = /* glsl */ `
uniform float uDanger;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDesat;
uniform float uTime;
uniform float uLetterbox;
uniform float uFade;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l) * vec3(0.8, 0.85, 1.0), uDesat);
  vec2 q = uv - 0.5;
  float r = length(q * vec2(1.0, 0.75));
  float edge = smoothstep(0.2, 0.7, r);
  float pulse = 0.8 + 0.2 * sin(uTime * 6.5);
  c = mix(c, c * vec3(0.12, 0.03, 0.2), edge * uDanger * pulse);
  c += uFlashColor * uFlash;
  // Subtle colour grade: cool shadows, warm highlights.
  c = mix(c, c * vec3(0.92, 1.0, 1.1), 1.0 - smoothstep(0.0, 0.4, l));
  float lb = uLetterbox * 0.11;
  if (uv.y < lb || uv.y > 1.0 - lb) c = vec3(0.0);
  c *= 1.0 - uFade;
  outputColor = vec4(c, inputColor.a);
}`;

export class PostFX {
  readonly composer: EffectComposer;
  private bloom: BloomEffect;
  private godRays: GodRaysEffect | null = null;
  readonly dof: DepthOfFieldEffect;
  private ca: ChromaticAberrationEffect;
  private tone: ToneMappingEffect;
  private vignette: VignetteEffect;
  private noise: NoiseEffect;
  readonly mood: Effect;
  private dofPass: EffectPass;
  private mainPass!: EffectPass;
  private caPass: EffectPass;
  private smaaPass: EffectPass;
  private renderPass: RenderPass;

  danger = 0;
  flash = 0;
  flashColor = new Vector3(1, 1, 1);
  desat = 0;
  letterbox = 0;
  fade = 0;
  dash = 0;
  private dofAmount = 0;
  dofTarget: Vector3 | null = null;

  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    private camera: PerspectiveCamera,
    private moon: Mesh,
    preset: QualityPreset,
  ) {
    // Note: composer MSAA renders black with three r186, so anti-aliasing uses SMAA instead.
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 30, focusRange: 18, bokehScale: 0 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: 1.35,
      luminanceThreshold: 0.55,
      luminanceSmoothing: 0.3,
      radius: 0.82,
      levels: 8,
    });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.vignette = new VignetteEffect({ darkness: 0.62, offset: 0.28 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.09;
    this.mood = new Effect('MoodEffect', MOOD_FS, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uDanger', new Uniform(0)],
        ['uFlash', new Uniform(0)],
        ['uFlashColor', new Uniform(new Vector3(1, 1, 1))],
        ['uDesat', new Uniform(0)],
        ['uTime', new Uniform(0)],
        ['uLetterbox', new Uniform(0)],
        ['uFade', new Uniform(0)],
      ]),
    });
    this.ca = new ChromaticAberrationEffect({ offset: new Vector2(0.0005, 0.0005), radialModulation: true, modulationOffset: 0.25 });

    this.buildMainPass(preset);
    this.smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
    this.smaaPass.enabled = preset.msaa > 0;
    this.composer.addPass(this.smaaPass);
    this.caPass = new EffectPass(camera, this.ca);
    this.composer.addPass(this.caPass);
  }

  private buildMainPass(preset: QualityPreset) {
    if (this.mainPass) {
      this.composer.removePass(this.mainPass);
      this.mainPass.dispose();
    }
    if (this.godRays) {
      this.godRays.dispose();
      this.godRays = null;
    }
    const effects: Effect[] = [];
    if (preset.godrays) {
      this.godRays = new GodRaysEffect(this.camera, this.moon, {
        density: 0.97,
        decay: 0.93,
        weight: 0.42,
        exposure: 0.62,
        samples: preset.raySamples,
        clampMax: 1.0,
        resolutionScale: 0.5,
        blur: true,
        kernelSize: KernelSize.SMALL,
      });
      effects.push(this.godRays);
    }
    effects.push(this.bloom, this.tone, this.mood, this.vignette, this.noise);
    this.mainPass = new EffectPass(this.camera, ...effects);
    // Insert after the DOF pass (order: render, dof, main, smaa, ca).
    this.composer.addPass(this.mainPass, 2);
  }

  setQuality(preset: QualityPreset) {
    this.smaaPass.enabled = preset.msaa > 0;
    this.buildMainPass(preset);
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  update(dt: number, time: number) {
    const u = this.mood.uniforms;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    u.get('uDanger')!.value = this.danger;
    u.get('uFlash')!.value = this.flash * this.flash;
    (u.get('uFlashColor')!.value as Vector3).copy(this.flashColor);
    u.get('uDesat')!.value = this.desat;
    u.get('uTime')!.value = time;
    u.get('uLetterbox')!.value = this.letterbox;
    u.get('uFade')!.value = this.fade;

    const caAmt = 0.0005 + this.danger * 0.003 + this.dash * 0.004 + this.flash * 0.002;
    this.ca.offset.set(caAmt, caAmt * 0.6);
    this.bloom.intensity = 1.35 + this.flash * 2.5;

    // Depth of field fades in/out.
    const want = this.dofTarget ? 1 : 0;
    this.dofAmount += (want - this.dofAmount) * Math.min(1, dt * 2);
    this.dofPass.enabled = this.dofAmount > 0.01;
    this.dof.bokehScale = this.dofAmount * 3.5;
    if (this.dofTarget) this.dof.target = this.dofTarget;
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
