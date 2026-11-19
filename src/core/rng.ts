/**
 * 存档内的种子随机数。
 *
 * 所有玩法随机（骰子、事件抽取、市场波动、事故）都从这里取数。计数随存档保存，
 * 回滚到旧快照后再走一遍会得到同样的结果，测试也能复现。
 */
export interface RngState {
  seed: string;
  counter: number;
}

function hashString(input: string): number {
  let hash = 1779033703 ^ input.length;
  for (let index = 0; index < input.length; index++) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^= hash >>> 16) >>> 0;
}

function mulberry32(seed: number): number {
  let value = (seed + 0x6D2B79F5) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function createRngState(seed?: string): RngState {
  const fallback = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return { seed: seed?.trim() || fallback, counter: 0 };
}

export function normalizeRngState(value: unknown, fallbackSeed?: string): RngState {
  if (value && typeof value === 'object') {
    const record = value as Partial<RngState>;
    if (typeof record.seed === 'string' && record.seed) {
      const counter = Number(record.counter);
      return { seed: record.seed, counter: Number.isInteger(counter) && counter >= 0 ? counter : 0 };
    }
  }
  return createRngState(fallbackSeed);
}

/** 读一个 [0, 1) 的数并推进计数（原地修改 state）。 */
export function nextRandom(state: RngState): number {
  const value = mulberry32(hashString(`${state.seed}:${state.counter}`));
  state.counter += 1;
  return value;
}

export class Rng {
  constructor(readonly state: RngState) {}

  next(): number {
    return nextRandom(this.state);
  }

  /** 闭区间整数。 */
  int(min: number, max: number): number {
    const low = Math.ceil(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    return low + Math.floor(this.next() * (high - low + 1));
  }

  chance(probability: number): boolean {
    if (!(probability > 0)) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  /** 按权重抽一个下标；全部权重非正时返回 -1。 */
  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((sum, weight) => sum + (weight > 0 ? weight : 0), 0);
    if (total <= 0) return -1;
    let cursor = this.next() * total;
    for (let index = 0; index < weights.length; index++) {
      const weight = weights[index] > 0 ? weights[index] : 0;
      if (cursor < weight) return index;
      cursor -= weight;
    }
    return weights.length - 1;
  }

  /** 以当前状态派生一个独立序列（不推进主序列），用于预览。 */
  fork(label: string): Rng {
    return new Rng({ seed: `${this.state.seed}/${label}:${this.state.counter}`, counter: 0 });
  }

  /** 供旧接口注入的 () => number。 */
  asFunction(): () => number {
    return () => this.next();
  }
}
