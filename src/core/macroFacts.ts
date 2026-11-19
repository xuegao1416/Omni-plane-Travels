/**
 * 预设宏读游戏变量：{{getvar::player.currency}}、{{getvar::玩家.生存状态.血量}}、{{玩家.姓名}} 之类，
 * 经玩法宿主的变量表（含别名）解析。宏只读不写：拼装提示词不能改游戏状态，
 * 对游戏变量的 setvar/incvar 被忽略，预设自己的变量（无点、不在变量表里的名字）照旧。
 */
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { FactRegistry } from './facts';
import { createGameplayHost } from './registry';

const MAX_TEXT = 300;

export interface FactMacroAccess {
  /** 是游戏变量就返回它的文字；不是就返回 undefined，让宏引擎按预设变量处理。 */
  read(key: string): string | undefined;
  /** 这个名字指向游戏变量（宏不能写）。 */
  isFact(key: string): boolean;
}

export function formatMacroValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number.isInteger(value) ? value : Math.round(value * 100) / 100) : undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) return value.join('、');
  const text = JSON.stringify(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

export function factMacroAccess(facts: FactRegistry, state: GameState): FactMacroAccess {
  const resolve = (key: string) => {
    const resolved = facts.resolve(key.trim());
    if (!resolved) return null;
    if (resolved.via === 'raw' && !resolved.path.includes('.')) return null;
    if (resolved.spec?.visibility === 'hidden') return null;
    return resolved;
  };
  return {
    read: key => resolve(key) ? formatMacroValue(facts.read(state, key.trim())) ?? '' : undefined,
    isFact: key => resolve(key) !== null,
  };
}

/** 按当前世界与状态建一个只读的宏变量入口。 */
export function createFactMacroAccess(world: WorldDef | undefined, state: GameState): FactMacroAccess {
  return factMacroAccess(createGameplayHost(world, state).facts, state);
}
