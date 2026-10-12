import type { Settings, QualityLevel } from '../core/Settings';

const $ = (id: string) => document.getElementById(id)!;
type ScreenId = 'loading' | 'menu' | 'pause' | 'settings' | 'controls' | 'end' | null;

export interface MenuHandlers {
  play(): void;
  resume(): void;
  restart(): void;
  free(): void;
  click(): void;
}

/** DOM screens: loading, main menu, pause, settings, controls, end. */
export class Menu {
  current: ScreenId = 'loading';
  private back: ScreenId = 'menu';

  constructor(private settings: Settings, private h: MenuHandlers) {
    document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.h.click();
        const a = b.dataset.action!;
        if (a === 'play') this.h.play();
        else if (a === 'resume') this.h.resume();
        else if (a === 'restart') this.h.restart();
        else if (a === 'free') this.h.free();
        else if (a === 'settings') this.open('settings', this.current);
        else if (a === 'controls') this.open('controls', this.current);
        else if (a === 'back') this.show(this.back);
      });
    });
    this.bindSettings();
  }

  private open(id: ScreenId, from: ScreenId) {
    this.back = from;
    this.show(id);
  }

  show(id: ScreenId) {
    for (const s of ['loading', 'menu', 'pause', 'settings', 'controls', 'end']) {
      $(s).classList.toggle('visible', s === id);
    }
    this.current = id;
  }

  setLoading(p: number, text: string) {
    $('loading-fill').style.width = `${Math.round(p * 100)}%`;
    $('loading-text').textContent = text;
  }

  setEndStats(html: string) {
    $('end-stats').innerHTML = html;
  }

  private bindSettings() {
    const d = this.settings.data;
    const seg = $('set-quality');
    const refreshSeg = () => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === this.settings.data.quality));
    };
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        this.h.click();
        this.settings.set('quality', b.dataset.v as QualityLevel);
        refreshSeg();
      }),
    );
    refreshSeg();

    const check = (id: string, key: 'dynamicRes' | 'invertY' | 'showFps') => {
      const el = $(id) as HTMLInputElement;
      el.checked = d[key];
      el.addEventListener('change', () => this.settings.set(key, el.checked));
    };
    check('set-dynres', 'dynamicRes');
    check('set-invert', 'invertY');
    check('set-fps', 'showFps');

    const range = (id: string, key: 'sensitivity' | 'master' | 'music' | 'sfx') => {
      const el = $(id) as HTMLInputElement;
      el.value = String(d[key]);
      el.addEventListener('input', () => this.settings.set(key, parseFloat(el.value)));
    };
    range('set-sens', 'sensitivity');
    range('set-master', 'master');
    range('set-music', 'music');
    range('set-sfx', 'sfx');
  }
}
