export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  pixelRatio: number;
  grass: number;
  fireflies: number;
  dust: number;
  shadow: number;
  msaa: number;
  godrays: boolean;
  raySamples: number;
  reflection: number;
}

const dpr = Math.min(window.devicePixelRatio || 1, 2);

export const PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: Math.min(dpr, 1) * 0.75, grass: 35_000, fireflies: 900, dust: 500, shadow: 1024, msaa: 0, godrays: false, raySamples: 30, reflection: 0.25 },
  medium: { pixelRatio: Math.min(dpr, 1), grass: 65_000, fireflies: 1600, dust: 900, shadow: 2048, msaa: 2, godrays: true, raySamples: 40, reflection: 0.35 },
  high: { pixelRatio: Math.min(dpr, 1.5), grass: 100_000, fireflies: 2600, dust: 1400, shadow: 2048, msaa: 4, godrays: true, raySamples: 60, reflection: 0.5 },
  ultra: { pixelRatio: dpr, grass: 160_000, fireflies: 4000, dust: 2200, shadow: 4096, msaa: 4, godrays: true, raySamples: 80, reflection: 0.6 },
};

export interface SettingsData {
  quality: QualityLevel;
  dynamicRes: boolean;
  sensitivity: number;
  invertY: boolean;
  master: number;
  music: number;
  sfx: number;
  showFps: boolean;
}

const KEY = 'lumen-settings-v1';

function guessQuality(): QualityLevel {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 'high' : 'medium';
}

export class Settings {
  data: SettingsData = {
    quality: guessQuality(),
    dynamicRes: true,
    sensitivity: 1,
    invertY: false,
    master: 0.8,
    music: 0.7,
    sfx: 0.8,
    showFps: false,
  };
  private listeners: ((d: SettingsData) => void)[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch {
      /* storage unavailable */
    }
  }

  get preset() {
    return PRESETS[this.data.quality];
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    this.data[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable */
    }
    for (const l of this.listeners) l(this.data);
  }

  onChange(fn: (d: SettingsData) => void) {
    this.listeners.push(fn);
  }
}
