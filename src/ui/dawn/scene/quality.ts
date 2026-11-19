/**
 * Render budgets for the dawn scene. A tier is picked from the device class
 * and the GPU name, then the engine steps down one tier at a time while the
 * measured frame time stays over budget. Phones never start above tier 1.
 */

export type QualityTier = 0 | 1 | 2 | 3;

export interface QualitySettings {
  tier: QualityTier;
  /** Device-pixel ratio used for the main HDR buffer. */
  pixelRatio: number;
  msaa: number;
  /** Volumetric light buffer scale relative to the main buffer. */
  volumeScale: number;
  volumeSteps: number;
  fireSteps: number;
  /** Planar floor reflection buffer scale (0 = environment reflections only). */
  reflectionScale: number;
  shadowSize: number;
  motes: number;
  embers: number;
  bloomLevels: number;
  /** Frame cap. */
  fps: number;
}

const TABLE: Record<QualityTier, Omit<QualitySettings, 'tier' | 'pixelRatio'> & { maxRatio: number }> = {
  0: { maxRatio: 0.6, msaa: 0, volumeScale: 0.25, volumeSteps: 18, fireSteps: 14, reflectionScale: 0, shadowSize: 1024, motes: 600, embers: 120, bloomLevels: 4, fps: 30 },
  1: { maxRatio: 0.85, msaa: 0, volumeScale: 0.33, volumeSteps: 26, fireSteps: 20, reflectionScale: 0.33, shadowSize: 1024, motes: 1400, embers: 220, bloomLevels: 5, fps: 30 },
  2: { maxRatio: 1.25, msaa: 4, volumeScale: 0.5, volumeSteps: 36, fireSteps: 28, reflectionScale: 0.5, shadowSize: 2048, motes: 2600, embers: 360, bloomLevels: 6, fps: 60 },
  3: { maxRatio: 1.75, msaa: 4, volumeScale: 0.5, volumeSteps: 52, fireSteps: 40, reflectionScale: 0.5, shadowSize: 4096, motes: 3600, embers: 480, bloomLevels: 6, fps: 60 },
};

/** At this render scale the buffer is already supersampled and MSAA only costs memory. */
const SUPERSAMPLED = 1.5;

export function settingsFor(tier: QualityTier): QualitySettings {
  const { maxRatio, ...rest } = TABLE[tier];
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const pixelRatio = Math.min(dpr, maxRatio);
  return { tier, pixelRatio, ...rest, msaa: pixelRatio >= SUPERSAMPLED ? 0 : rest.msaa };
}

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const MOBILE_GPU = /adreno|mali|powervr|apple gpu|apple a\d|immortalis|xclipse|videocore/i;
const STRONG_GPU = /nvidia|geforce|rtx|radeon rx|radeon pro|apple m\d|arc a\d/i;

/** Localhost-only override for screenshots and profiling: `?dwq=0..3`. */
function forcedTier(): QualityTier | null {
  if (typeof window === 'undefined') return null;
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname)) return null;
  const raw = new URLSearchParams(window.location.search).get('dwq');
  if (raw === null) return null;
  const tier = Number(raw);
  return tier === 0 || tier === 1 || tier === 2 || tier === 3 ? tier : null;
}

export function isTierForced() {
  return forcedTier() !== null;
}

export function detectTier(gpuName: string): QualityTier {
  const forced = forcedTier();
  if (forced !== null) return forced;
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const memory = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8 : 8;
  if (SOFTWARE_GPU.test(gpuName)) return 0;
  if (coarse || MOBILE_GPU.test(gpuName)) return memory <= 3 || cores <= 4 ? 0 : 1;
  if (STRONG_GPU.test(gpuName) && cores >= 6) return 3;
  return memory <= 4 || cores <= 4 ? 1 : 2;
}

/** Longest acceptable frame for a tier: 45 fps for the 60 fps tiers, 25 fps for the 30 fps tiers. */
export function frameBudgetMs(settings: QualitySettings) {
  return settings.fps >= 60 ? 22 : 40;
}

/** Warm-up: 30 frames, or 1.5 s once at least 8 frames are in (slow devices). */
const WARMUP_FRAMES = 30;
const WARMUP_MIN_FRAMES = 8;
const WARMUP_MS = 1500;
/** Verdicts as samples come in: [window size, how far over budget the median must be]. */
const VERDICTS: ReadonlyArray<readonly [number, number]> = [[12, 3], [30, 1.5], [90, 1]];
const LONG_WINDOW = 90;

/**
 * Watches frame times and reports a sustained miss of the budget. Warm-up
 * frames are skipped and the median ignores single hitches. The further over
 * budget a device is, the sooner it is reported, so a weak phone settles within
 * a few seconds instead of after a long heavy start.
 */
export class FrameBudget {
  private samples: number[] = [];
  private warmFrames = 0;
  private warmMs = 0;

  constructor(private readonly budgetMs: number) {}

  /** Returns the median frame time when the budget is missed, otherwise null. */
  push(frameMs: number): number | null {
    const ms = Math.min(frameMs, 1000);
    const warm = this.warmFrames >= WARMUP_FRAMES || (this.warmFrames >= WARMUP_MIN_FRAMES && this.warmMs >= WARMUP_MS);
    if (!warm) {
      this.warmFrames++;
      this.warmMs += ms;
      return null;
    }
    this.samples.push(ms);
    const n = this.samples.length;
    const verdict = VERDICTS.find(([size]) => size === n);
    if (!verdict) return null;
    const median = [...this.samples].sort((a, b) => a - b)[n >> 1];
    const missed = median > this.budgetMs * verdict[1];
    if (missed || n >= LONG_WINDOW) this.samples = [];
    return missed ? median : null;
  }
}

/**
 * What the frame budget learned on this device, kept for the tab session so a
 * return to the entry (e.g. leaving a game) starts at the settled tier.
 */
export interface LearnedPerformance {
  tier: QualityTier;
  /** Even tier 0 missed its budget: draw still frames only. */
  still: boolean;
}

const PERF_KEY = 'omni.dawn.perf';

export function recallPerformance(gpu: string): LearnedPerformance | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PERF_KEY) ?? 'null') as (LearnedPerformance & { gpu: string }) | null;
    if (!value || value.gpu !== gpu || ![0, 1, 2, 3].includes(value.tier)) return null;
    return { tier: value.tier, still: value.still === true };
  } catch {
    return null;
  }
}

export function rememberPerformance(gpu: string, learned: LearnedPerformance) {
  try {
    sessionStorage.setItem(PERF_KEY, JSON.stringify({ gpu, ...learned }));
  } catch { /* storage unavailable: the next visit learns again */ }
}
