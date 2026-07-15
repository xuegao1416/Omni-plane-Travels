// 选择卡（choice block）「路径 C」反馈 —— 待选状态存储与结算。
//
// 行为约定：
// - 单选（radio）：选中即覆盖同 key 记录 → 天然非累加（只保留最终选中项）。
// - 已是选中项再点 = 无操作（调用方判断，但即使重复写入也只是覆盖同值）。
// - 下一 tick 结算：仅把「最终选中项」的 delta 写入对应 stat，并把 aiNote 记入玩家决策日志。
//
// 待选状态为模块级 Map，key = `${saveId}:${eventPackId}:${cardId}:${blockId}`。
// blockId 用于区分同一张卡片内的多个选择块；单卡单选择块时 blockId 为空串。

import type { GameState } from '../schema/variables';
import type { ChoiceEffect } from './schema';
import { recordPlayerDecision } from './playerDecisionLog';

export interface PendingChoice {
  saveId: string;
  eventPackId: string;
  cardId: string;
  /** 该卡片内的选择块 id（puck.components.choice[].id），用于多选择块区分 */
  blockId: string;
  selectedIndex: number;
  effect?: ChoiceEffect;
  aiNote?: string;
  /** 选中那一刻的 stat 基准值，预览 = baseStatValue + delta（保证相对选中基准，不因切换累加） */
  baseStatValue: number;
}

interface PendingStore {
  pending: Map<string, PendingChoice>;
}

// 模块级单例（运行期有效；新存档隔离靠 saveId 前缀过滤）。
const store: PendingStore = { pending: new Map() };

export function choiceKey(saveId: string, eventPackId: string, cardId: string, blockId = ''): string {
  return `${saveId}:${eventPackId}:${cardId}:${blockId}`;
}

/** 选中（或切换）某个选项。覆盖同 key 记录 → 单选 + 非累加。 */
export function selectChoice(c: PendingChoice): void {
  store.pending.set(choiceKey(c.saveId, c.eventPackId, c.cardId, c.blockId), c);
}

/** 取某存档下所有待结算选择。 */
export function getPendingForSave(saveId: string): PendingChoice[] {
  const out: PendingChoice[] = [];
  for (const c of store.pending.values()) {
    if (c.saveId === saveId) out.push(c);
  }
  return out;
}

/** 清除某存档下所有待结算选择（结算后调用）。 */
export function clearPendingForSave(saveId: string): void {
  for (const key of [...store.pending.keys()]) {
    const c = store.pending.get(key);
    if (c && c.saveId === saveId) store.pending.delete(key);
  }
}

/**
 * 把 delta 施加到 GameState 的 stat（走 stats 体系：玩家.生存状态 扁平 key）。
 * 与 WorldSimulationEngine 机械层结算约定一致：取当前值 + delta，下限 0。
 * 未知 statId 静默跳过（仍存在其它合法选项不崩）。
 * @deprecated 新代码请使用 applyEffectTarget，它同时支持 statId 与 resourcePath。
 */
export function applyStatDelta(state: GameState, statId: string, delta: number): void {
  const stats = state?.玩家?.生存状态;
  if (!stats) return;
  if (!(statId in stats)) {
    console.warn(`[applyStatDelta] 跳过未知属性 id: ${statId}`);
    return;
  }
  const before = Number(stats[statId] ?? 0);
  const after = Math.max(0, before + delta);
  stats[statId] = after;
}

/**
 * 按资源路径施加 delta，支持三类世界自定义资源：
 *   经营资产.资金   → 玩家.经营资产.资金（无字段则初始化 {资金:0,...} 再应用，clamp >= 0）
 *   货币资源.主货币 → 玩家.货币资源.主货币.数量（clamp >= 0）
 *   生存资源.<key>  → 玩家.生存资源.<key>.数量（复用 skip-unknown：无该资源则 warn+跳过，
 *                    不创建幽灵资源、不崩）
 * 未知前缀 / 不支持的子键 → warn + 跳过。
 */
export function applyResourcePathDelta(state: GameState, path: string, delta: number): void {
  const player = state?.玩家;
  if (!player) return;
  const parts = path.split('.');
  const root = parts[0];
  const key = parts[1];

  if (root === '生存资源') {
    if (!key) {
      console.warn(`[applyResourcePathDelta] 资源路径缺少 key: ${path}`);
      return;
    }
    if (!player.生存资源) player.生存资源 = {};
    if (!(key in player.生存资源)) {
      // 复用 VariableManager 的 skip-unknown 机制：未知资源只 warn + 跳过，不创建幽灵资源
      console.warn(`[applyResourcePathDelta] 跳过未知生存资源: ${path}`);
      return;
    }
    const res = player.生存资源[key];
    const before = Number(res?.数量 ?? 0);
    const after = Math.max(0, before + delta);
    player.生存资源[key] = { ...res, 数量: after };
  } else if (root === '经营资产') {
    if (key !== '资金') {
      console.warn(`[applyResourcePathDelta] 暂不支持的经营资产子键: ${path}`);
      return;
    }
    if (!player.经营资产) player.经营资产 = { 资金: 0, 资产列表: [], 交易日志: [] };
    const before = Number(player.经营资产.资金 ?? 0);
    player.经营资产.资金 = Math.max(0, before + delta);
  } else if (root === '货币资源') {
    if (key !== '主货币') {
      console.warn(`[applyResourcePathDelta] 暂不支持的货币资源子键: ${path}`);
      return;
    }
    if (!player.货币资源) player.货币资源 = { 主货币: { 名称: '', 数量: 0 } };
    if (!player.货币资源.主货币) player.货币资源.主货币 = { 名称: '', 数量: 0 };
    const before = Number(player.货币资源.主货币.数量 ?? 0);
    player.货币资源.主货币.数量 = Math.max(0, before + delta);
  } else {
    console.warn(`[applyResourcePathDelta] 未知资源路径前缀: ${path}`);
  }
}

/**
 * 应用选择卡选项的 effect：优先 resourcePath（资源），否则 statId（属性）。
 * choice 与（未来）rule 共用此入口。两者均未提供则无操作。
 */
export function applyEffectTarget(state: GameState, effect: ChoiceEffect): void {
  if (effect.resourcePath && effect.resourcePath.trim().length > 0) {
    applyResourcePathDelta(state, effect.resourcePath.trim(), effect.delta ?? 0);
    return;
  }
  if (effect.statId && effect.statId.trim().length > 0) {
    applyStatDelta(state, effect.statId.trim(), effect.delta ?? 0);
  }
}

/**
 * 结算某存档下所有待选选择卡：应用最终选中项的 delta，并记录 aiNote。
 * 在 WorldSimulationEngine.tick 末尾（eventWorldEvolution.evaluateTick 之后）调用。
 */
export function resolvePendingChoices(state: GameState, saveId: string): void {
  const list = getPendingForSave(saveId);
  if (list.length === 0) return;
  for (const c of list) {
    if (c.effect) {
      applyEffectTarget(state, c.effect);
    }
    if (c.aiNote && c.aiNote.trim()) {
      recordPlayerDecision(c.aiNote.trim());
    }
  }
  clearPendingForSave(saveId);
}

/** 仅供测试 / 调试：清空全部待选。 */
export function _clearAllPending(): void {
  store.pending.clear();
}
