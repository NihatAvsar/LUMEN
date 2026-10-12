import {
  Color, DirectionalLight, FogExp2, HemisphereLight, NormalBlending, NoToneMapping, PCFShadowMap,
  PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CLEARING_RADIUS, HOVER, LAKE, MOON_DIR, PEDESTAL_RADIUS, SEED_COUNT } from '../config';
import { Rng, clamp, damp, easeInOutCubic, lerp } from '../core/math';
import { Input } from '../core/Input';
import { PostFX } from '../core/PostFX';
import { Settings } from '../core/Settings';
import { Heightfield } from '../world/Heightfield';
import { Awakening, TREE_BASE_RADIUS, TREE_SLOT } from '../world/Awakening';
import { setAwakening } from '../world/materials';
import { installFog } from '../world/Fog';
import { createTerrain } from '../world/Terrain';
import { Sky } from '../world/Sky';
import { createWater } from '../world/Water';
import { Grass, GRASS_LAYER } from '../world/Grass';
import { Colliders } from '../world/Colliders';
import { createTrees } from '../world/Trees';
import { createFlora } from '../world/Flora';
import { createLandmarks } from '../world/Landmarks';
import { AncientTree } from '../world/AncientTree';
import { ParticlePool } from '../fx/Particles';
import { Fireflies } from '../fx/Fireflies';
import { Shockwaves } from '../fx/Shockwave';
import { Spirit } from '../player/Spirit';
import { Controller } from '../player/Controller';
import { ThirdPersonCamera } from '../player/ThirdPersonCamera';
import { Seeds, Seed } from './Seeds';
import { Shadows } from './Shadows';
import { AudioEngine } from '../audio/AudioEngine';
import { Music } from '../audio/Music';
import { Sfx } from '../audio/Sfx';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';

type State = 'loading' | 'menu' | 'intro' | 'playing' | 'paused' | 'dying' | 'final' | 'end';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly settings = new Settings();
  readonly input: Input;
  readonly debug = new URLSearchParams(location.search).has('debug');

  private state: State = 'loading';
  private stateBeforePause: State = 'playing';
  private time = 0;
  private stateT = 0;
  private last = performance.now();

  private hf = new Heightfield();
  private awakening = new Awakening();
  private colliders = new Colliders();
  private fog!: FogExp2;
  private hemi!: HemisphereLight;
  private moonLight!: DirectionalLight;
  private sky!: Sky;
  private water!: Reflector;
  private grass!: Grass;
  private tree!: AncientTree;
  private sparks!: ParticlePool;
  private smoke!: ParticlePool;
  private fireflies!: Fireflies;
  private dust!: Fireflies;
  private shock!: Shockwaves;
  private spirit!: Spirit;
  private ctrl!: Controller;
  private tpc!: ThirdPersonCamera;
  private seeds!: Seeds;
  private shadows!: Shadows;
  private post!: PostFX;
  private audio = new AudioEngine();
  private music = new Music(this.audio);
  private sfx = new Sfx(this.audio);
  private hud!: Hud;
  private menu: Menu;

  private energy = 100;
  private awakenedCount = 0;
  private placedHandled = new Set<number>();
  private deliverTimer = 0;
  private finished = false;
  private hadLock = false;
  private deaths = 0;
  private startTime = 0;
  private spawn = new Vector3();
  private introFrom = { pos: new Vector3(), quat: new Quaternion() };
  private finaleFired = new Set<string>();
  private dynScale = 1;
  private frameTimes: number[] = [];
  private dynTimer = 0;
  private fpsAcc = { frames: 0, t: 0, fps: 0 };
  private heartPos = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private v2 = new Vector2();
  private hurtTimer = 0;
  private sparkAcc = 0;
  private hintsShown = new Set<string>();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, stencil: false, depth: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setPixelRatio(this.settings.preset.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.info.autoReset = false;

    this.camera = new PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 2200);
    this.camera.layers.enable(GRASS_LAYER);
    this.input = new Input(canvas);

    this.menu = new Menu(this.settings, {
      play: () => this.play(),
      resume: () => this.resume(),
      restart: () => location.reload(),
      free: () => this.freeRoam(),
      click: () => this.sfx.ui(),
    });
    this.settings.onChange(() => this.applySettings());
    window.addEventListener('resize', () => this.onResize());
    canvas.addEventListener('click', () => {
      if ((this.state === 'playing' || this.state === 'intro') && !this.input.locked) this.input.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked) this.hadLock = true;
      else if (this.hadLock && (this.state === 'playing' || this.state === 'intro')) this.pause();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'paused' && this.menu.current === 'pause') this.resume();
    });
  }

  // ------------------------------------------------------------------ setup

  async init() {
    const step = async (p: number, text: string) => {
      this.menu.setLoading(p, text);
      await nextFrame();
      await nextFrame();
    };
    await step(0.02, 'Işık toplanıyor…');
    installFog();
    setAwakening(this.awakening);
    const preset = this.settings.preset;

    this.fog = new FogExp2(new Color(0.016, 0.024, 0.05), 0.0115);
    this.scene.fog = this.fog;
    this.scene.background = null;

    await step(0.08, 'Arazi şekilleniyor…');
    this.hf.build();
    this.scene.add(createTerrain(this.hf));

    this.hemi = new HemisphereLight(new Color(0.32, 0.4, 0.72), new Color(0.03, 0.03, 0.06), 0.5);
    this.scene.add(this.hemi);
    this.moonLight = new DirectionalLight(new Color(0.62, 0.72, 1.0), 0.95);
    this.moonLight.castShadow = true;
    const sc = this.moonLight.shadow.camera;
    sc.left = sc.bottom = -55;
    sc.right = sc.top = 55;
    sc.near = 1;
    sc.far = 320;
    this.moonLight.shadow.mapSize.set(preset.shadow, preset.shadow);
    this.moonLight.shadow.bias = -0.0004;
    this.moonLight.shadow.normalBias = 0.04;
    this.moonLight.shadow.radius = 3;
    this.scene.add(this.moonLight, this.moonLight.target);

    this.sky = new Sky(this.fog.color);
    this.scene.add(this.sky.group);

    await step(0.2, 'Kadim Ağaç uyanıyor…');
    this.tree = new AncientTree(this.hf, this.colliders);
    this.scene.add(this.tree.group);
    this.tree.heartWorld(this.heartPos);

    await step(0.3, 'Taşlar yerleşiyor…');
    const rng = new Rng(2024);
    const landmarks = createLandmarks(this.hf, this.colliders, rng);
    this.scene.add(landmarks.group);

    await step(0.42, 'Ağaçlar büyüyor…');
    const trees = createTrees(this.hf, this.colliders, rng, 1);
    this.scene.add(trees.group);

    await step(0.55, 'Mantarlar ve çiçekler açıyor…');
    this.scene.add(createFlora(this.hf, this.colliders, rng, 1));

    await step(0.64, 'Göl doluyor…');
    this.water = createWater(this.awakening, this.hf, this.camera, preset.reflection);
    this.scene.add(this.water);

    await step(0.7, 'Çimenler filizleniyor…');
    this.spirit = new Spirit();
    this.grass = new Grass(this.awakening, this.hf, this.spirit.lightColor, 100);
    this.grass.setCount(preset.grass);
    this.scene.add(this.grass.mesh);

    await step(0.78, 'Ateş böcekleri uçuşuyor…');
    this.fireflies = new Fireflies(this.awakening, this.hf, { max: 4000, tile: 90, size: 0.2, heightRange: [0.4, 6], dim: 0.12, bright: 2.2, speed: 1 }, 11);
    this.fireflies.setCount(preset.fireflies);
    this.dust = new Fireflies(this.awakening, this.hf, { max: 2200, tile: 36, size: 0.045, heightRange: [0.2, 7], dim: 0.35, bright: 0.7, speed: 0.35, dust: true }, 12);
    this.dust.setCount(preset.dust);
    this.scene.add(this.fireflies.points, this.dust.points);
    this.sparks = new ParticlePool(5000);
    this.smoke = new ParticlePool(2500, NormalBlending, true);
    this.scene.add(this.smoke.points, this.sparks.points);
    this.shock = new Shockwaves(this.awakening, this.hf, this.sparks);
    this.scene.add(this.shock.group);

    await step(0.86, 'Ruh şekilleniyor…');
    this.ctrl = new Controller(this.hf, this.colliders);
    this.spawn.set(0, 0, PEDESTAL_RADIUS + 15);
    this.spawn.y = this.hf.ground(this.spawn.x, this.spawn.z) + HOVER;
    this.ctrl.teleport(this.spawn);
    this.ctrl.canDash = () => this.energy > 6;
    this.ctrl.events = {
      onJump: (dbl) => {
        this.sfx.jump(dbl);
        this.sparks.emit({ pos: this.ctrl.pos, count: dbl ? 40 : 14, color: new Color(0.6, 1.4, 1.6), speed: [1, dbl ? 5 : 3], life: [0.4, 0.9], size: [0.06, 0.16], drag: 3, dir: new Vector3(0, -0.5, 0) });
      },
      onLand: (impact) => {
        this.sfx.land(impact);
        this.spirit.land(impact / 25);
        if (impact > 14) this.tpc.shake(0.15 * Math.min(1, impact / 30));
        this.tmp.copy(this.ctrl.pos);
        this.tmp.y -= HOVER - 0.1;
        this.sparks.emit({ pos: this.tmp, count: Math.floor(impact), color: new Color(0.4, 1.0, 1.1), speed: [2, 5], life: [0.3, 0.7], size: [0.05, 0.12], drag: 4, dir: new Vector3(0, 0.2, 0), spread: 1 });
      },
      onDash: () => {
        this.energy -= 7;
        this.sfx.dash();
        this.tpc.punch(10);
        this.tpc.shake(0.12);
        this.post.flash = Math.max(this.post.flash, 0.25);
        this.post.flashColor.set(0.5, 0.9, 1.0);
      },
    };
    this.scene.add(this.spirit.group, this.spirit.trail);
    this.tpc = new ThirdPersonCamera(this.camera, this.hf);
    this.tpc.yaw = 0;
    this.tpc.snap(this.ctrl.pos);

    this.seeds = new Seeds(this.hf, landmarks.stairTop);
    this.scene.add(this.seeds.group);
    this.shadows = new Shadows(this.hf, this.awakening, this.smoke, this.sparks);
    this.scene.add(this.shadows.group);

    this.hud = new Hud(SEED_COUNT);

    await step(0.92, 'Işık hüzmeleri hizalanıyor…');
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.sky.moon, preset);
    this.onResize();

    await step(0.96, 'Gölgeler derleniyor…');
    this.setMenuCamera(0);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* compileAsync may be unsupported */
    }
    // Warm up a few frames behind the loading screen.
    for (let i = 0; i < 3; i++) {
      this.frame(1 / 60, true);
      await nextFrame();
    }
    await step(1, 'Hazır');

    this.state = 'menu';
    this.menu.show('menu');
    (window as unknown as { __lumen: Game }).__lumen = this;
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  // ------------------------------------------------------------- settings

  private applySettings() {
    const d = this.settings.data;
    const p = this.settings.preset;
    this.audio.setVolumes({ master: d.master, music: d.music, sfx: d.sfx });
    if (!this.post) return;
    this.grass.setCount(p.grass);
    this.fireflies.setCount(p.fireflies);
    this.dust.setCount(p.dust);
    if (this.moonLight.shadow.mapSize.x !== p.shadow) {
      this.moonLight.shadow.mapSize.set(p.shadow, p.shadow);
      this.moonLight.shadow.map?.dispose();
      (this.moonLight.shadow as { map: unknown }).map = null;
    }
    this.post.setQuality(p);
    if (!d.dynamicRes) this.dynScale = 1;
    this.onResize();
  }

  private onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.settings.preset.pixelRatio * this.dynScale);
    this.renderer.setSize(w, h);
    if (this.post) this.post.setSize(w, h);
    if (this.water) {
      const r = this.settings.preset.reflection;
      this.water.getRenderTarget().setSize(Math.max(256, Math.floor(w * r)), Math.max(256, Math.floor(h * r)));
    }
  }

  // --------------------------------------------------------------- states

  private play() {
    this.audio.start();
    this.audio.setVolumes(this.settings.data);
    this.music.start();
    this.sfx.start(this.seeds.list.map((s) => s.home));
    this.input.requestLock();
    this.menu.show(null);
    this.state = 'intro';
    this.stateT = 0;
    this.introFrom.pos.copy(this.camera.position);
    this.introFrom.quat.copy(this.camera.quaternion);
    this.tpc.yaw = 0;
    this.tpc.pitch = 0.28;
    this.tpc.snap(this.ctrl.pos);
    this.startTime = this.time;
    this.hud.narrate(['Orman ışığını kaybetti…', 'Yedi tohum, yedi ışık, ormanın dört bir yanına saçıldı.', 'Onları bul. Kadim Ağaç\'ı uyandır.'], 3.6);
  }

  private pause() {
    if (this.state !== 'playing' && this.state !== 'intro') return;
    this.stateBeforePause = this.state;
    this.state = 'paused';
    this.menu.show('pause');
    this.input.releaseLock();
    if (this.audio.started) this.audio.ctx.suspend();
  }

  private resume() {
    if (this.state !== 'paused') return;
    this.state = this.stateBeforePause;
    this.menu.show(null);
    this.input.requestLock();
    if (this.audio.started) this.audio.ctx.resume();
    this.last = performance.now();
  }

  private freeRoam() {
    this.menu.show(null);
    this.state = 'playing';
    this.post.letterbox = 0;
    this.post.dofTarget = null;
    this.ctrl.enabled = true;
    this.hud.show(true);
    this.input.requestLock();
  }

  // ------------------------------------------------------------- gameplay

  private collect(s: Seed) {
    s.state = 'carried';
    this.sfx.stopHum(s.index);
    this.sfx.collect();
    this.sparks.emit({ pos: s.pos, count: 160, color: new Color(1.8, 1.4, 0.8), speed: [3, 12], life: [0.6, 1.6], size: [0.08, 0.25], drag: 2.2, gravity: 1.5 });
    this.post.flash = 0.7;
    this.post.flashColor.set(1.0, 0.85, 0.55);
    this.tpc.shake(0.45);
    this.tpc.punch(9);
    if (!s.awakened) {
      s.awakened = true;
      this.awakenedCount++;
      const slot = s.index + 1;
      this.awakening.trigger(slot, s.home.x, s.home.z, 78, 7.5);
      this.shock.spawn(slot, this.hf.ground(s.home.x, s.home.z));
      setTimeout(() => this.sfx.wave(), 250);
      this.music.level = this.awakenedCount;
    }
    this.hud.toast(s.name, 'Işık Tohumu bulundu — Kadim Ağaç\'a geri götür', 4.5);
    if (!this.hintsShown.has('return')) {
      this.hintsShown.add('return');
      setTimeout(() => this.hud.hint('Pusuladaki halka Kadim Ağaç\'ı gösterir', 6), 4500);
    }
  }

  private deliverNext() {
    const carried = this.seeds.carried;
    if (!carried.length) return;
    const s = carried[0];
    const used = new Set(this.seeds.list.filter((x) => x.pedestal >= 0).map((x) => x.pedestal));
    let p = 0;
    while (used.has(p)) p++;
    s.pedestal = p;
    s.state = 'delivering';
    s.t = 0;
    s.from.copy(s.pos);
    s.to.copy(this.tree.pedestals[p].pos);
  }

  private onPlaced(s: Seed) {
    const placed = this.seeds.placedCount;
    this.tree.lightPedestal(s.pedestal);
    this.tree.targetProgress = placed / SEED_COUNT;
    this.tree.flare = 1;
    this.awakening.trigger(TREE_SLOT, 0, 0, TREE_BASE_RADIUS + placed * 9, 4);
    this.shock.spawn(TREE_SLOT, this.hf.height(0, 0));
    this.sfx.deliver();
    this.post.flash = 0.5;
    this.post.flashColor.set(1.0, 0.8, 0.5);
    this.tpc.shake(0.25);
    this.sparks.emit({ pos: s.to, count: 90, color: new Color(1.8, 1.3, 0.6), speed: [2, 8], life: [0.6, 1.4], size: [0.08, 0.22], drag: 2 });
    if (placed >= SEED_COUNT) {
      setTimeout(() => this.startFinale(), 1800);
    } else {
      this.hud.toast(`${placed} / ${SEED_COUNT}`, 'Kadim Ağaç biraz daha uyandı', 3.5);
    }
  }

  private extinguish() {
    this.state = 'dying';
    this.stateT = 0;
    this.deaths++;
    this.sfx.extinguished();
    this.ctrl.enabled = false;
    this.sparks.emit({ pos: this.ctrl.pos, count: 120, color: new Color(0.5, 0.9, 1.2), speed: [1, 6], life: [0.8, 1.8], size: [0.06, 0.2], drag: 1.5, gravity: -1 });
  }

  private respawn() {
    for (const s of this.seeds.list) {
      if (s.state === 'carried') {
        s.state = 'idle';
        s.pos.copy(s.home);
      }
    }
    this.ctrl.teleport(this.spawn);
    this.ctrl.enabled = true;
    this.tpc.yaw = 0;
    this.tpc.snap(this.ctrl.pos);
    this.spirit.resetTrail(this.ctrl.pos);
    this.energy = 100;
    this.state = 'playing';
    this.hud.toast('Işığın söndü', 'Taşıdığın tohumlar evlerine döndü', 4);
  }

  private startFinale() {
    if (this.state === 'final' || this.finished) return;
    this.finished = true;
    this.state = 'final';
    this.stateT = 0;
    this.finaleFired.clear();
    this.ctrl.enabled = false;
    this.hud.show(false);
    this.hud.clearNarrative();
    this.introFrom.pos.copy(this.camera.position);
    this.introFrom.quat.copy(this.camera.quaternion);
  }

  private updateFinale(dt: number) {
    const t = this.stateT;
    const fire = (key: string, at: number, fn: () => void) => {
      if (t >= at && !this.finaleFired.has(key)) {
        this.finaleFired.add(key);
        fn();
      }
    };
    this.post.letterbox = Math.min(1, t / 1.5);
    fire('music', 0.5, () => {
      this.music.finale();
      this.sfx.finale();
    });
    fire('burst', 2.0, () => {
      this.tree.flare = 3;
      this.post.flash = 1.0;
      this.post.flashColor.set(1.0, 0.9, 0.7);
      this.tpc.shake(0.6);
      this.awakening.trigger(TREE_SLOT, 0, 0, 430, 16);
      this.shock.spawn(TREE_SLOT, this.hf.height(0, 0));
      this.shadows.purge(0, 0, 1000);
      this.music.level = 7;
    });
    fire('dof', 3.0, () => (this.post.dofTarget = this.heartPos));
    fire('n1', 7.5, () => this.hud.narrate(['Orman uyandı.'], 3.5));
    fire('n2', 12.5, () => this.hud.narrate(['Işık, onu taşıyanla yaşar.'], 3.5));
    fire('end', 18.5, () => {
      this.state = 'end';
      const mins = Math.floor((this.time - this.startTime) / 60);
      const secs = Math.floor((this.time - this.startTime) % 60);
      this.menu.setEndStats(`Süre: ${mins} dk ${secs} sn<br/>Sönme sayısı: ${this.deaths}<br/>Uyanan bölgeler: ${this.awakenedCount} / ${SEED_COUNT}`);
      this.menu.show('end');
      this.input.releaseLock();
    });
    if (t > 2 && t < 10) {
      // Fountain of light from the heart.
      this.sparks.emit({
        pos: this.heartPos, count: Math.ceil(dt * 260), color: Math.random() < 0.5 ? new Color(1.8, 1.4, 0.7) : new Color(0.6, 1.5, 1.4),
        speed: [6, 16], dir: new Vector3(0, 2.2, 0), spread: 0.9, life: [1.5, 3], size: [0.15, 0.4], gravity: 3, drag: 0.6, endSize: 0.4,
      });
    }
    this.cinematicCamera(t, dt);
  }

  private cinematicCamera(t: number, dt: number) {
    const k = easeInOutCubic(Math.min(1, t / 18));
    const angle = 0.6 + t * 0.12;
    const radius = lerp(30, 55, k);
    const height = lerp(6, 34, k) + this.heartPos.y;
    const pos = this.tmp.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
    const ground = this.hf.ground(pos.x, pos.z) + 2;
    pos.y = Math.max(pos.y, ground);
    const look = this.tmp2.set(0, lerp(this.heartPos.y, this.heartPos.y + 18, k), 0);
    const blend = Math.min(1, t / 3);
    const cam = this.camera;
    const target = new PerspectiveCamera();
    target.position.copy(pos);
    target.lookAt(look);
    cam.position.lerpVectors(this.introFrom.pos, pos, easeInOutCubic(blend));
    cam.quaternion.slerpQuaternions(this.introFrom.quat, target.quaternion, easeInOutCubic(blend));
    if (Math.abs(cam.fov - 60) > 0.05) {
      cam.fov += (60 - cam.fov) * damp(2, dt);
      cam.updateProjectionMatrix();
    }
  }

  private setMenuCamera(t: number) {
    const a = t * 0.045 + 2.2;
    const r = 42 + Math.sin(t * 0.07) * 4;
    this.camera.position.set(Math.sin(a) * r, this.heartPos.y + 9 + Math.sin(t * 0.1) * 2.5, Math.cos(a) * r);
    this.camera.lookAt(0, this.heartPos.y + 7, 0);
    this.camera.fov = 55;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ loop

  private loop() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame(dt, false);
  }

  private frame(dt: number, warmup: boolean) {
    const d = this.settings.data;
    if (this.state === 'paused') {
      this.post.render(dt);
      return;
    }
    this.time += dt;
    this.stateT += dt;
    const time = this.time;

    this.input.poll(dt, d.sensitivity, d.invertY);
    if (this.input.pausePressed && (this.state === 'playing' || this.state === 'intro')) this.pause();
    if (this.debug) this.debugKeys();

    const playing = this.state === 'playing' || this.state === 'intro';
    const p = this.ctrl.pos;

    // ---- player
    if (playing || this.state === 'dying') {
      if (this.state === 'intro') this.ctrl.enabled = this.stateT > 1.2;
      let yawKeys = 0;
      if (this.input.isDown('KeyQ')) yawKeys += 1;
      if (this.input.isDown('KeyE')) yawKeys -= 1;
      this.tpc.yaw += yawKeys * dt * 2.2;
      this.ctrl.update(dt, this.input, this.tpc.yaw);
    }

    // ---- energy & shadows
    const playerAwake = this.awakening.at(p.x, p.z);
    const distTree = Math.hypot(p.x, p.z);
    let drain = 0;
    if (this.state !== 'loading') {
      drain = this.shadows.update(dt, time, p, this.ctrl.dashing && playing, (pos) => {
        this.sfx.shadowKill();
        this.tpc.shake(0.3);
        this.post.flash = Math.max(this.post.flash, 0.35);
        this.post.flashColor.set(0.8, 0.5, 1.0);
        this.sparks.emit({ pos, count: 50, color: new Color(1.2, 1.4, 1.8), speed: [3, 10], life: [0.4, 1.0], size: [0.08, 0.2], drag: 3 });
        if (!this.hintsShown.has('kill')) {
          this.hintsShown.add('kill');
          this.hud.hint('Işık atılması Söndürücüleri dağıtır', 5);
        }
      });
    }
    if (playing) {
      if (drain > 0) {
        this.energy -= drain * dt;
        this.hurtTimer -= dt;
        if (this.hurtTimer <= 0) {
          this.hurtTimer = 0.35;
          this.sfx.hurt();
        }
        if (!this.hintsShown.has('dash')) {
          this.hintsShown.add('dash');
          this.hud.hint('Shift — Işık atılması ile Söndürücüyü dağıt', 6);
        }
      } else {
        const regen = 3 + playerAwake * 8 + (distTree < CLEARING_RADIUS ? 25 : 0);
        this.energy += regen * dt;
      }
      this.energy = clamp(this.energy, 0, 100);
      if (this.energy <= 0 && this.state === 'playing') this.extinguish();

      // Seeds pickup & delivery.
      for (const s of this.seeds.list) {
        if (s.state === 'idle' && s.pos.distanceTo(p) < 2.6) this.collect(s);
      }
      this.deliverTimer -= dt;
      if (distTree < PEDESTAL_RADIUS + 11 && this.seeds.carried.length && this.deliverTimer <= 0) {
        this.deliverTimer = 0.7;
        this.deliverNext();
      }
    }
    for (const s of this.seeds.list) {
      if (s.state === 'placed' && !this.placedHandled.has(s.index)) {
        this.placedHandled.add(s.index);
        this.onPlaced(s);
      }
    }

    if (this.state === 'dying') {
      this.post.fade = Math.min(1, this.stateT / 1.4);
      if (this.stateT > 2.2) this.respawn();
    } else if (this.state !== 'final' && this.state !== 'end') {
      this.post.fade = Math.max(0, this.post.fade - dt * 1.2);
    }

    // ---- world
    this.awakening.update(dt, time);
    for (let i = 1; i < 8; i++) {
      const w = this.awakening.waves[i];
      if (w.t < 1) this.shadows.purge(w.x, w.z, w.radius - 6);
    }
    const target = (this.awakenedCount + this.seeds.placedCount) / (SEED_COUNT * 2);
    const goal = this.finished ? 1 : target;
    this.awakening.progress += (goal - this.awakening.progress) * Math.min(1, dt * (this.finished ? 0.25 : 0.5));
    const prog = this.awakening.progress;
    this.fog.color.setRGB(lerp(0.016, 0.03, prog), lerp(0.024, 0.05, prog), lerp(0.05, 0.08, prog));
    this.fog.density = lerp(0.0115, 0.0082, prog);
    this.hemi.intensity = lerp(0.5, 0.85, prog);
    this.moonLight.intensity = lerp(0.95, 1.25, prog);
    this.sky.material.uniforms.uAurora.value = 0.12 + prog * 1.1;
    this.sky.material.uniforms.uProgress.value = prog;
    this.sky.update(time, this.camera.position);
    this.tree.update(dt, time);
    this.shadows.writeGloom(this.awakening.uniforms.uGloom.value, p);

    // ---- player visuals
    const dash = this.ctrl.dashing ? 1 : 0;
    this.post.dash += (dash - this.post.dash) * Math.min(1, dt * 10);
    this.spirit.group.visible = this.state !== 'dying' || this.stateT < 0.2;
    this.spirit.trail.visible = this.spirit.group.visible;
    this.spirit.update(dt, time, p, this.energy / 100, this.ctrl.speed, this.post.dash, this.camera);
    this.seeds.update(dt, time, p, this.camera.position);

    // Sparkles shed by the spirit.
    this.sparkAcc += dt * (4 + this.ctrl.speed * 2.5 + (this.ctrl.gliding ? 30 : 0) + dash * 120);
    while (this.sparkAcc > 1 && this.spirit.group.visible) {
      this.sparkAcc -= 1;
      this.sparks.emit({
        pos: p, count: 1, color: dash ? new Color(1.6, 1.5, 1.2) : new Color(0.5, 1.3, 1.5), speed: [0.2, 1.2], life: [0.5, 1.2],
        size: [0.05, 0.12], drag: 2, gravity: -0.3, jitter: 0.25,
      });
    }

    // ---- camera
    if (this.state === 'menu' || this.state === 'loading') {
      this.setMenuCamera(time);
      this.post.dofTarget = this.heartPos;
    } else if (this.state === 'intro' || this.state === 'playing' || this.state === 'dying') {
      this.post.dofTarget = null;
      this.tpc.update(dt, p, this.input.look, this.input.wheel, this.ctrl.speed, time);
      if (this.state === 'intro') {
        const k = easeInOutCubic(Math.min(1, this.stateT / 3.2));
        const goalQuat = this.camera.quaternion.clone();
        this.camera.position.lerpVectors(this.introFrom.pos, this.camera.position, k);
        this.camera.quaternion.slerpQuaternions(this.introFrom.quat, goalQuat, k);
        if (this.stateT > 3.2) {
          this.state = 'playing';
          this.hud.show(true);
          this.hud.hint('WASD hareket · Boşluk zıpla / basılı tut: süzül · Shift: ışık atılması', 8);
        }
      }
    } else if (this.state === 'final' || this.state === 'end') {
      this.updateFinale(dt);
    }

    // ---- fx & world uniforms
    const cinematic = this.state === 'menu' || this.state === 'loading' || this.state === 'final' || this.state === 'end';
    this.awakening.uniforms.uViewTarget.value.copy(cinematic ? this.heartPos : this.tpc.target);
    this.moonLight.position.copy(p).addScaledVector(MOON_DIR, 150);
    this.moonLight.target.position.copy(p);
    const grassCenter = this.state === 'menu' || this.state === 'final' || this.state === 'end' ? this.tmp.set(this.camera.position.x * 0.4, 0, this.camera.position.z * 0.4) : p;
    const heartLight = 0.25 + this.tree.progress * 1.2 + this.tree.flare * 0.8;
    this.grass.update(grassCenter, p, (0.35 + 0.65 * this.energy / 100) * (this.spirit.group.visible ? 1 : 0), heartLight);
    this.renderer.getDrawingBufferSize(this.v2);
    const scale = this.v2.y / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const ffCenter = this.state === 'menu' || this.state === 'final' || this.state === 'end' ? this.camera.position : p;
    this.fireflies.update(ffCenter, scale);
    this.fireflies.material.uniforms.uBoost.value = this.finished ? 1 : 0;
    this.dust.update(this.camera.position, scale);
    this.sparks.setScale(scale);
    this.smoke.setScale(scale);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.shock.update(dt, time, 140, this.camera.position);
    const waterU = (this.water.material as import('three').ShaderMaterial).uniforms;
    waterU.uPlayer.value.copy(p);

    // ---- post
    const danger = playing ? this.shadows.danger : 0;
    this.post.danger = danger;
    this.post.desat = danger * 0.6 + (this.energy < 25 && playing ? (1 - this.energy / 25) * 0.4 : 0);
    this.post.update(dt, time);

    // ---- audio
    if (this.audio.started) {
      const fwd = this.camera.getWorldDirection(this.tmp2);
      this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, fwd.x, fwd.y, fwd.z);
      this.music.update(danger, prog);
      this.sfx.update(dt, {
        awake: playerAwake,
        lakeDist: Math.max(0, Math.hypot(p.x - LAKE.x, p.z - LAKE.z) - LAKE.r * 0.6),
        glide: this.ctrl.gliding ? 1 : 0,
        speed: this.ctrl.speed,
        time,
      });
    }

    // ---- hud
    if (this.hud && !warmup) {
      this.hud.update(dt, this.tpc.yaw, p.x, p.z, this.energy / 100, this.seeds.list);
      this.fpsAcc.frames++;
      this.fpsAcc.t += dt;
      if (this.fpsAcc.t >= 0.5) {
        this.fpsAcc.fps = this.fpsAcc.frames / this.fpsAcc.t;
        this.fpsAcc.frames = 0;
        this.fpsAcc.t = 0;
        const info = this.renderer.info.render;
        this.hud.setFps(
          d.showFps || this.debug
            ? `${this.fpsAcc.fps.toFixed(0)} fps · ${this.settings.data.quality} · çöz ${(this.dynScale * 100).toFixed(0)}%\n${info.calls} çizim · ${(info.triangles / 1000).toFixed(0)}k üçgen`
            : null,
        );
      }
      this.dynamicResolution(dt);
    }

    // ---- render
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.info.reset();
    this.post.render(dt);
    this.input.endFrame();
  }

  private dynamicResolution(dt: number) {
    if (!this.settings.data.dynamicRes || (this.state !== 'playing' && this.state !== 'menu')) return;
    this.frameTimes.push(dt);
    this.dynTimer += dt;
    if (this.dynTimer < 2) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    this.dynTimer = 0;
    const fps = 1 / avg;
    let next = this.dynScale;
    if (fps < 48) next = Math.max(0.55, this.dynScale - 0.1);
    else if (fps > 58 && this.dynScale < 1) next = Math.min(1, this.dynScale + 0.05);
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.onResize();
    }
  }

  private debugKeys() {
    const i = this.input;
    if (i.wasPressed('KeyN')) {
      const s = this.seeds.list.find((x) => x.state === 'idle');
      if (s) {
        this.ctrl.teleport(this.tmp.copy(s.home).add(new Vector3(0, 0, 6)));
        this.tpc.snap(this.ctrl.pos);
      }
    }
    if (i.wasPressed('KeyG')) {
      for (const s of this.seeds.list) if (s.state === 'idle') this.collect(s);
      this.ctrl.teleport(this.spawn);
      this.tpc.snap(this.ctrl.pos);
    }
    if (i.wasPressed('KeyK')) this.startFinale();
    if (i.wasPressed('KeyT')) {
      const qs = ['low', 'medium', 'high', 'ultra'] as const;
      const idx = qs.indexOf(this.settings.data.quality);
      this.settings.set('quality', qs[(idx + 1) % qs.length]);
    }
  }
}
