// 变量管理器
import type { GameState } from '../schema/variables';
import { createDefaultGameState } from '../schema/variables';
import type { ApiConfig } from '../api/types';
import { requestCompletion } from '../api/client';
import { cloneDeep, get, set, merge } from 'lodash-es';
import { formatWorldClock, normalizeTimeSystemConfig, normalizeWorldClockState, reconcileEditedWorldClock, type WorldClockConfig, type WorldClockState } from '../time/worldClock';
import { toDisplayText } from '../utils/displayText';
import {
  ensureGameplayRuntime,
  executeGameplayTransaction,
  type GameplayTransaction,
  type GameplayEffect,
} from '../gameplay/kernel';
import type { GameplayValue } from '../gameplay/types';
import { extractModulePartitions, materializeModulePartitions } from '../gameplay/moduleRuntime/facade';
import { ModuleRuntimeRegistry } from '../gameplay/moduleRuntime/registry';
import type { ModuleStateRecord } from '../gameplay/moduleRuntime/types';
import { canRollbackCombat } from '../gameplay/protocols';
import { ensureKnowledgeState } from '../director/knowledge';
import { selectPlayerKnownNPCs } from './playerKnowledge';
import { enforcePlayerIdentity } from '../director/initialIdentity';

/** 原型污染防护 — 过滤危险路径段 */
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const AI_STATE_ROOTS = new Set(['世界', '玩家', '人物档案']);
const AI_TRANSACTION_KEYS = new Set(['id', 'moduleId', 'source', 'label', 'conditions', 'costs', 'effects', 'rewards', 'events']);
const AI_FORBIDDEN_FIELDS = new Set(['before', 'after']);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isSafePath(path: string): boolean {
  return !path.split('.').some(seg => DANGEROUS_PATH_SEGMENTS.has(seg));
}

function isAllowedAiStatePath(path: unknown): boolean {
  if (typeof path !== 'string' || !path.trim()) return false;
  const normalized = path.trim().replace(/^\//, '').replaceAll('/', '.');
  const segments = normalized.split('.');
  return isSafePath(normalized)
    && AI_STATE_ROOTS.has(segments[0])
    && !segments.some(segment => AI_FORBIDDEN_FIELDS.has(segment));
}

function containsForbiddenAiField(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (AI_FORBIDDEN_FIELDS.has(key)) return true;
    if (containsForbiddenAiField(child, seen)) return true;
  }
  return false;
}

function areAllowedAiEffects(value: unknown): boolean {
  if (!Array.isArray(value)) return value === undefined;
  return value.every(effect => {
    if (!isRecord(effect)) return false;
    for (const operation of ['set', 'add', 'append', 'remove'] as const) {
      if (operation in effect) {
        const payload = effect[operation];
        return isRecord(payload)
          && isAllowedAiStatePath(payload.path)
          && !containsForbiddenAiField(payload.value);
      }
    }
    return isRecord(effect.emit) || isRecord(effect.schedule);
  });
}

function areAllowedAiConditions(value: unknown): boolean {
  if (!Array.isArray(value)) return value === undefined;
  const check = (condition: unknown): boolean => {
    if (!isRecord(condition)) return false;
    if (isRecord(condition.state)) return isAllowedAiStatePath(condition.state.path);
    if (Array.isArray(condition.all)) return condition.all.every(check);
    if (Array.isArray(condition.any)) return condition.any.every(check);
    if (condition.not !== undefined) return check(condition.not);
    return isRecord(condition.event);
  };
  return value.every(check);
}

function isAllowedAiTransaction(value: Record<string, unknown>): boolean {
  if (!Object.keys(value).every(key => AI_TRANSACTION_KEYS.has(key))) return false;
  if (!areAllowedAiConditions(value.conditions)) return false;
  if (value.costs !== undefined && (!Array.isArray(value.costs) || !value.costs.every(cost => isRecord(cost) && isAllowedAiStatePath(cost.path)))) return false;
  if (!areAllowedAiEffects(value.effects)) return false;
  if (value.rewards !== undefined && (!Array.isArray(value.rewards) || !value.rewards.every(reward => isRecord(reward) && areAllowedAiEffects(reward.effects)))) return false;
  return true;
}

import {
  resolveNpcId,
  warnIgnoredNpcPatchUpdate,
  canCreateNpcFromPatch,
  getCreatableNpcIdentifier,
  ensureNpcCategoryDefaults,
  ensureNpcChronicleDefaults,
  ensureNpcStructureDefaults,
  createPromptSafeNpcSnapshot,
} from '../utils/npcHelpers';

/** 安全数值转换 + 区间钳制，防止 NaN 传播 */
function safeClamp(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

export class VariableManager {
  private state: GameState;
  private readonly moduleRegistry: ModuleRuntimeRegistry;
  private worldClockConfig: WorldClockConfig;

  constructor(initial?: GameState, moduleRuntime?: {
    saveId: string;
    current: readonly ModuleStateRecord[];
    checkpoints?: readonly ModuleStateRecord[];
  }, worldClockConfig?: Partial<WorldClockConfig>) {
    this.worldClockConfig = normalizeTimeSystemConfig(worldClockConfig);
    this.moduleRegistry = new ModuleRuntimeRegistry(moduleRuntime?.saveId ?? 'runtime');
    for (const record of moduleRuntime?.checkpoints ?? []) this.moduleRegistry.importHistoryRecord(record);
    for (const record of moduleRuntime?.current ?? []) this.moduleRegistry.importRecord(record);
    const source = initial ? cloneDeep(initial) : createDefaultGameState();
    this.state = moduleRuntime?.current.length
      ? materializeModulePartitions(source, moduleRuntime.current)
      : source;
    this.normalizeState();
    this.syncModuleRuntime();
  }

  setWorldClockConfig(config: Partial<WorldClockConfig>): void {
    this.worldClockConfig = normalizeTimeSystemConfig(config);
    this.normalizeState();
  }

  private syncModuleRuntime(): GameState {
    const extracted = extractModulePartitions(this.state, 'runtime');
    for (const record of extracted.records) {
      this.moduleRegistry.syncState(record.moduleId, record.state, record.schemaVersion);
    }
    extracted.coreState.moduleRevisions = this.moduleRegistry.checkpoint();
    return extracted.coreState;
  }

  createModulePersistenceBundle(saveId: string): {
    coreState: GameState;
    current: ModuleStateRecord[];
    checkpoints: ModuleStateRecord[];
  } {
    const coreState = this.syncModuleRuntime();
    const rebind = (record: ModuleStateRecord): ModuleStateRecord => ({ ...record, saveId });
    return {
      coreState,
      current: this.moduleRegistry.listCurrentRecords().map(rebind),
      checkpoints: this.moduleRegistry.listCheckpointRecords().map(rebind),
    };
  }

  getState(): GameState {
    this.normalizeState();
    return cloneDeep(this.state);
  }

  setState(state: GameState) {
    this.state = cloneDeep(state);
    this.normalizeState();
  }

  /**
   * 初始化当前世界状态容器。
   */
  initializeWorldAndNotebook(): void {
    this.normalizeState();
  }

  // 获取嵌套变量值
  getVar(path: string, defaultValue?: unknown): unknown {
    return get(this.state, path, defaultValue);
  }

  // 设置嵌套变量值
  // forceReplace=false 时对象深度合并（避免部分更新丢失字段）
  // forceReplace=true 时直接替换（允许删除旧键）
  setVar(path: string, value: unknown, forceReplace = false) {
    if (!isSafePath(path)) return;
    if (!forceReplace && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const existing = get(this.state, path);
      if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
        set(this.state, path, merge({}, existing, value));
        return;
      }
    }
    set(this.state, path, value);
  }

  // 规范化状态：确保核心容器、NPC、纪事、任务与模块数值保持当前结构
  private normalizeState(): void {
    this.repairCoreStateShape();
    ensureGameplayRuntime(this.state);
    const clock = (this.state.世界.时间系统 as any).时钟;
    if (clock && typeof clock === 'object') {
      const normalizedClock = normalizeWorldClockState(clock, this.worldClockConfig);
      this.state.世界.时间系统.时钟 = normalizedClock;
      this.state.世界.时间系统.当前时间 = formatWorldClock(normalizedClock, this.worldClockConfig);
    }
    ensureNpcCategoryDefaults(this.state);
    ensureNpcChronicleDefaults(this.state);
    ensureNpcStructureDefaults(this.state);
    this.pruneEmptyInventoryEntries();
    this.normalizeChronicle();
    this.normalizeTaskSystem();
    this.validateAndClampModuleValues();
  }

  private captureAuthoritativeClock(): WorldClockState | undefined {
    const clock = (this.state as any)?.世界?.时间系统?.时钟;
    return clock && typeof clock === 'object' ? cloneDeep(normalizeWorldClockState(clock, this.worldClockConfig)) : undefined;
  }

  /** 防御性修复无效核心容器，避免异常输入让后续轮次永久失败。 */
  private repairCoreStateShape(): void {
    const defaults = createDefaultGameState();
    const state = this.state as unknown as Record<string, unknown>;

    if (!isRecord(state.世界)) state.世界 = cloneDeep(defaults.世界);
    const world = state.世界 as Record<string, unknown>;
    if (!isRecord(world.时间系统)) world.时间系统 = cloneDeep(defaults.世界.时间系统);
    if (!isRecord(world.空间定位)) world.空间定位 = cloneDeep(defaults.世界.空间定位);

    if (!isRecord(state.玩家)) state.玩家 = cloneDeep(defaults.玩家);
    const player = state.玩家 as Record<string, unknown>;
    const defaultPlayer = defaults.玩家 as unknown as Record<string, unknown>;
    for (const key of ['生存状态', '身份信息', '技能系统', '货币资源', '物品栏']) {
      if (!isRecord(player[key])) player[key] = cloneDeep(defaultPlayer[key]);
    }
    player.当前目标 = toDisplayText(player.当前目标);

    if (!isRecord(state.人物档案)) state.人物档案 = {};
    enforcePlayerIdentity(state as unknown as GameState);
    ensureKnowledgeState(this.state);
  }

  /**
   * 校验并修正模块数值（已简化 — 范围约束由世界书提示词控制）
   */
  private validateAndClampModuleValues(): void {
    // 世界系统已移除，属性范围约束由世界书条目中的提示词控制
  }

  /**
   * 清理数量归零的物品条目（玩家 + 全部 NPC 的 物品栏）。
   * - AI 变量提取常把消耗品写成 数量:0（add 效果 min:0 的自然结果），战斗扣减同理；
   *   若不清理会留下"空壳物品"，继续出现在下一回合快照与提示词中，污染叙事。
   * - 物品栏不变式：任何条目 数量 >= 1；数量缺失/非数字视为遗留数据，保留不动。
   */
  private pruneEmptyInventoryEntries(): void {
    const prune = (inventory: unknown): void => {
      if (!isRecord(inventory)) return;
      for (const [key, value] of Object.entries(inventory)) {
        if (isRecord(value) && typeof (value as Record<string, unknown>).数量 === 'number'
          && ((value as Record<string, unknown>).数量 as number) <= 0) {
          delete (inventory as Record<string, unknown>)[key];
        }
      }
    };
    prune((this.state.玩家 as unknown as Record<string, unknown> | undefined)?.物品栏);
    const roster = this.state.人物档案;
    if (isRecord(roster)) {
      for (const npc of Object.values(roster)) {
        prune((npc as unknown as Record<string, unknown> | undefined)?.物品栏);
      }
    }
  }


  /** 纪事系统容量限制：最多 30 条，超出删除最旧的 */
  private normalizeChronicle(): void {
    const chronicleSystem = this.state.玩家?.纪事系统;
    if (!chronicleSystem?.纪事) return;

    const CHRONICLE_CAP = 30;
    const entries = Object.entries(chronicleSystem.纪事)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([,a], [,b]) => (a.$time ?? 0) - (b.$time ?? 0));

    if (entries.length > CHRONICLE_CAP) {
      const toRemove = entries.slice(0, entries.length - CHRONICLE_CAP);
      for (const [key] of toRemove) {
        delete chronicleSystem.纪事[key];
      }
    }
  }

  /** 任务系统容量限制 */
  private normalizeTaskSystem(): void {
    const player = this.state.玩家 as unknown as Record<string, unknown>;
    if (!isRecord(player.任务系统)) {
      player.任务系统 = { 活跃任务: {}, 已完成任务: {}, 已失败任务: {} };
    }
    const taskSystem = player.任务系统 as unknown as Record<string, unknown>;

    const CAPS = { 活跃任务: 15, 已完成任务: 50, 已失败任务: 20 } as const;

    for (const [section, cap] of Object.entries(CAPS) as [keyof typeof CAPS, number][]) {
      if (!isRecord(taskSystem[section])) taskSystem[section] = {};
      const entries = taskSystem[section] as Record<string, unknown>;

      // AI 偶尔会把任务或整个任务分区返回为 null/None。坏条目不能进入排序和渲染层。
      for (const [key, task] of Object.entries(entries)) {
        if (!isRecord(task)) {
          delete entries[key];
          continue;
        }

        // AI 经常尝试按索引写入阶段状态；确保每个任务都有阶段数组，避免 set 失败。
        if (!Array.isArray(task.阶段)) task.阶段 = [];

        task.任务名 = toDisplayText(task.任务名, key);
        task.描述 = toDisplayText(task.描述, task.任务名 as string);
        task.目标 = toDisplayText(task.目标, task.描述 as string);
        if (task.来源 != null) task.来源 = toDisplayText(task.来源);
        if (task.截止时间 != null) task.截止时间 = toDisplayText(task.截止时间);
        if (Array.isArray(task.阶段)) {
          task.阶段 = task.阶段.filter(isRecord).map((stage, index) => ({
            ...stage,
            名称: toDisplayText(stage.名称, `阶段 ${index + 1}`),
            描述: toDisplayText(stage.描述),
          }));
        }
      }

      const sorted = Object.entries(entries)
        .sort(([, a], [, b]) => {
          const aTime = Number((a as Record<string, unknown>).$time);
          const bTime = Number((b as Record<string, unknown>).$time);
          return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
        });
      if (sorted.length > cap) {
        const toRemove = sorted.slice(0, sorted.length - cap);
        for (const [key] of toRemove) {
          delete entries[key];
        }
      }
    }
  }

  private commitGameplayTransaction(transaction: GameplayTransaction): boolean {
    const tick = this.state.simulationRuntime?.tick ?? 0;
    const isAiSource = transaction.source.startsWith('ai');
    const result = executeGameplayTransaction(this.state, transaction, { tick, bestEffort: isAiSource });
    if (result.status === 'applied' && !this.hasValidCoreStateShape(result.state as GameState)) {
      // AI transactions must not be able to replace a core container with a
      // scalar/null value. Keep the original state and report rejection.
      return false;
    }
    // Failed/blocked results still carry the kernel log; preserve that state.
    this.state = result.state as GameState;
    if (result.status === 'applied') {
      this.normalizeState();
    }
    return result.status === 'applied';
  }

  private applyGameplayTransactionPayload(payload: Record<string, unknown>): boolean {
    const hasProtectedClockPath = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(hasProtectedClockPath);
      if (!isRecord(value)) return false;
      if (typeof value.path === 'string' && (
        value.path === '世界.时间系统'
        || value.path.startsWith('世界.时间系统.时钟')
        || value.path.startsWith('世界.时间系统.当前时间')
      )) return true;
      return Object.values(value).some(hasProtectedClockPath);
    };
    if (hasProtectedClockPath(payload)) return false;
    const normalized = this.normalizeCanonicalTransaction(payload);
    if (!normalized) return false;
    const transaction: GameplayTransaction = {
      ...(normalized as unknown as GameplayTransaction),
      id: typeof payload.id === 'string' && payload.id
        ? payload.id
        : `ai-update:${this.state.simulationRuntime?.tick ?? 0}:${(this.state.gameplay?.sequence ?? 0) + 1}`,
      source: 'ai',
    };
    try {
      return this.commitGameplayTransaction(transaction);
    } catch {
      return false;
    }
  }

  /** Normalize display-name NPC paths before they enter the generic kernel. */
  private normalizeCanonicalTransaction(payload: Record<string, unknown>): Record<string, unknown> | null {
    const transaction = cloneDeep(payload) as Record<string, any>;
    const chronicleCache = new Map<string, string[]>();

    const normalizePath = (rawPath: unknown, operation: string, value?: unknown): string | null => {
      if (typeof rawPath !== 'string') return null;
      const parts = rawPath.split('.').map(part => part.trim()).filter(Boolean);
      if (parts.length === 0 || parts.some(part => !isSafePath(part))) return null;
      if (parts[0] === '人物档案' && parts.length >= 2) {
        const resolution = resolveNpcId(parts[1], this.state);
        if (resolution.ok) {
          parts[1] = resolution.npcId!;
        } else if (parts.length === 2 && canCreateNpcFromPatch(parts, operation === 'set' ? 'replace' : operation, value)) {
          const creatableId = getCreatableNpcIdentifier(parts[1]);
          if (!creatableId || !isSafePath(creatableId)) return null;
          parts[1] = creatableId;
        } else {
          warnIgnoredNpcPatchUpdate('Gameplay 事务', parts[1], resolution);
          return null;
        }
      }
      const normalized = parts.join('.');
      return isSafePath(normalized) ? normalized : null;
    };

    const isFavorabilityPath = (path: string): boolean => {
      const parts = path.split('.');
      return parts[0] === '人物档案' && parts[2] === '关系数据' && parts[3] === '好感度';
    };

    const normalizeEffect = (rawEffect: unknown): GameplayEffect | null => {
      if (!isRecord(rawEffect)) return null;
      if (isRecord(rawEffect.set)) {
        const path = normalizePath(rawEffect.set.path, 'set', rawEffect.set.value);
        if (!path) return null;
        let value = rawEffect.set.value as GameplayValue;
        if (isFavorabilityPath(path)) {
          const current = Number(get(this.state, path));
          const target = Number(value);
          if (!Number.isFinite(target)) return null;
          const baseline = Number.isFinite(current) ? current : 0;
          value = safeClamp(baseline + Math.sign(target - baseline) * Math.min(15, Math.abs(target - baseline)), -100, 100, baseline);
        }
        if (path.endsWith('.人物事迹') && Array.isArray(value)) {
          const normalizedItems = value.map(item => String(item ?? '').trim()).filter(Boolean);
          value = normalizedItems.filter((item, index) => normalizedItems.indexOf(item) === index) as unknown as GameplayValue;
        }
        return { set: { path, value } };
      }
      if (isRecord(rawEffect.add)) {
        const path = normalizePath(rawEffect.add.path, 'add', rawEffect.add.delta);
        if (!path) return null;
        const delta = Number(rawEffect.add.delta);
        if (!Number.isFinite(delta)) return null;
        const requestedMin = rawEffect.add.min === undefined ? undefined : Number(rawEffect.add.min);
        const requestedMax = rawEffect.add.max === undefined ? undefined : Number(rawEffect.add.max);
        if (requestedMin !== undefined && !Number.isFinite(requestedMin)) return null;
        if (requestedMax !== undefined && !Number.isFinite(requestedMax)) return null;
        const next: Extract<GameplayEffect, { add: unknown }>['add'] = {
          path,
          delta,
          ...(requestedMin === undefined ? {} : { min: requestedMin }),
          ...(requestedMax === undefined ? {} : { max: requestedMax }),
          ...(typeof rawEffect.add.create === 'boolean' ? { create: rawEffect.add.create } : {}),
        };
        if (isFavorabilityPath(path)) {
          next.delta = Math.max(-15, Math.min(15, delta));
          next.min = Math.max(-100, requestedMin ?? -100);
          next.max = Math.min(100, requestedMax ?? 100);
        }
        return { add: next };
      }
      if (isRecord(rawEffect.append)) {
        const path = normalizePath(rawEffect.append.path, 'append', rawEffect.append.value);
        if (!path) return null;
        if (path.endsWith('.人物事迹')) {
          const existing = chronicleCache.get(path) ?? (Array.isArray(get(this.state, path)) ? [...get(this.state, path)] : []);
          const value = String(rawEffect.append.value ?? '').trim();
          if (value && !existing.includes(value)) existing.push(value);
          chronicleCache.set(path, existing);
          return { set: { path, value: existing as unknown as GameplayValue } };
        }
        return { append: { ...rawEffect.append, path } } as GameplayEffect;
      }
      if (isRecord(rawEffect.remove)) {
        const path = normalizePath(rawEffect.remove.path, 'remove');
        return path ? { remove: { path } } : null;
      }
      if (isRecord(rawEffect.emit)) return rawEffect as GameplayEffect;
      if (isRecord(rawEffect.schedule)) return rawEffect as GameplayEffect;
      return null;
    };

    const normalizeEffectList = (effects: unknown): GameplayEffect[] | null => {
      if (effects === undefined) return [];
      if (!Array.isArray(effects)) return null;
      const normalized: GameplayEffect[] = [];
      for (const effect of effects) {
        const next = normalizeEffect(effect);
        if (!next) return null;
        normalized.push(next);
      }
      return normalized;
    };

    for (const cost of transaction.costs ?? []) {
      const path = normalizePath(cost.path, 'cost');
      if (!path) return null;
      cost.path = path;
    }
    const normalizeCondition = (condition: any): boolean => {
      if (!isRecord(condition)) return false;
      if ('state' in condition) {
        if (!isRecord(condition.state)) return false;
        const path = normalizePath(condition.state.path, 'condition');
        if (!path) return false;
        condition.state.path = path;
      }
      if (Array.isArray(condition.all) && !condition.all.every(normalizeCondition)) return false;
      if (Array.isArray(condition.any) && !condition.any.every(normalizeCondition)) return false;
      if (condition.not && !normalizeCondition(condition.not)) return false;
      return true;
    };
    if (Array.isArray(transaction.conditions) && !transaction.conditions.every(normalizeCondition)) return null;
    const effects = normalizeEffectList(transaction.effects);
    if (effects === null) return null;
    transaction.effects = effects;
    for (const reward of transaction.rewards ?? []) {
      const rewardEffects = normalizeEffectList(reward.effects);
      if (rewardEffects === null) return null;
      reward.effects = rewardEffects;
    }
    return transaction;
  }

  /**
   * 变量 AI 只接受当前 GameplayTransaction。提示词与运行时共用同一份
   * canonical 协议，历史 RFC/对象合并/path=value 不再形成第二套写入语义。
   */
  applyAiUpdateVariable(updateText: string): boolean {
    return this.applyUpdateVariable(updateText);
  }

  // 从 AI 响应中的更新标签解析并应用当前 GameplayTransaction。
  applyUpdateVariable(updateText: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(updateText);
    } catch {
      return false;
    }
    if (!isRecord(parsed)) return false;

    const canonical = ['conditions', 'costs', 'effects', 'rewards', 'events']
      .some(key => Array.isArray(parsed[key]));
    if (!canonical || !isAllowedAiTransaction(parsed)) return false;
    return this.applyGameplayTransactionPayload(parsed);
  }

  /** 防止一次坏补丁把存档写成后续轮次无法读取的半损坏状态。 */
  private hasValidCoreStateShape(input: GameState = this.state): boolean {
    const state = input as unknown as Record<string, unknown>;
    const world = state.世界 as Record<string, unknown> | undefined;
    const player = state.玩家 as Record<string, unknown> | undefined;

    return isRecord(state)
      && isRecord(world)
      && isRecord(world.时间系统)
      && isRecord(world.空间定位)
      && isRecord(player)
      && isRecord(player.生存状态)
      && isRecord(player.身份信息)
      && isRecord(player.技能系统)
      && isRecord(player.货币资源)
      && isRecord(player.物品栏)
      && isRecord(state.人物档案);
  }

  // 创建供系统提示使用的安全快照
  createSafeSnapshotForPrompt(): GameState {
    const snapshot = cloneDeep(this.state);
    const safeNpcs: Record<string, unknown> = {};
    for (const [id, npc] of Object.entries(selectPlayerKnownNPCs(snapshot))) {
      safeNpcs[id] = createPromptSafeNpcSnapshot(npc, id);
    }
    (snapshot as any).人物档案 = safeNpcs;
    delete (snapshot as any).人物已知资料;
    delete snapshot.playerKnowledge;
    return snapshot;
  }

  /**
   * 删除一个 NPC（从 人物档案 中移除该条所有数据）。
   * - 若该 NPC 不存在，返回 false。
   * - 删除后，世界书条目是按需由 人物档案 动态抽取关键词生成的，
   *   下一轮灌入世界书时会自动跳过已删除角色，无需手工清理世界书条目。
   * - 调用方负责做好后续的 bumpVersion / scheduleAutoSave / 引用头像清理。
   */
  removeNpc(npcId: string): boolean {
    if (!npcId) return false;
    const roster = this.state.人物档案;
    if (!roster || !Object.prototype.hasOwnProperty.call(roster, npcId)) return false;
    delete roster[npcId];
    if (this.state.playerKnowledge) delete this.state.playerKnowledge.characters[npcId];
    return true;
  }

  /**
   * 从主角物品栏中彻底删除一件物品（整条删除，含全部数量）。
   * - itemKey: 物品的名称（Record 的 key，即物品名）
   * - 若物品不存在或 key 为空，返回 false。
   * - 真删除：不留数量递减、不留空壳条目，下一回合快照中不再出现。
   * - 撤销途径：回滚到删除前的历史快照即可找回（快照包含 玩家.物品栏）。
   * - 调用方负责做好后续的 bumpVersion / scheduleAutoSave。
   */
  removeInventoryItem(itemKey: string): boolean {
    if (!itemKey) return false;
    const items = (this.state.玩家 as unknown as Record<string, unknown>)?.物品栏 as Record<string, unknown> | undefined;
    if (!items || !Object.prototype.hasOwnProperty.call(items, itemKey)) return false;

    delete items[itemKey];
    return true;
  }

  // 用主API总结NPC事迹，防止条目过多
  async summarizeNpcChronicles(npcId: string, apiConfig: ApiConfig): Promise<boolean> {
    const npc = this.state.人物档案[npcId];
    if (!npc) return false;
    const chronicles = (npc as any).人物事迹;
    if (!Array.isArray(chronicles) || chronicles.length <= 5) return false;

    const npcName = (npc as any).姓名 || npcId;
    const prompt = `你是叙事记录员。以下是NPC「${npcName}」的事迹记录，请按时间线合并总结为简洁条目（5-8条），保留关键事件和转折点，去除重复和琐碎内容。只输出总结后的条目，每条一行，不要编号以外的前缀。\n\n原始事迹：\n${chronicles.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;

    try {
      const result = await requestCompletion(apiConfig, [
        { role: 'user', content: prompt },
      ], { temperature: 0.3 });
      const lines = result.text.split('\n').map(l => l.replace(/^\d+[\.\)、]\s*/, '').trim()).filter(Boolean);
      if (lines.length > 0) {
        (npc as any).人物事迹 = lines;
        return true;
      }
    } catch (e) {
      console.warn('[VariableManager] 事迹总结失败:', e);
    }
    return false;
  }

  // 合并指定范围的事迹条目为一条
  async mergeNpcChronicles(npcId: string, startIndex: number, endIndex: number, apiConfig: ApiConfig): Promise<boolean> {
    const npc = this.state.人物档案[npcId];
    if (!npc) return false;
    const chronicles = (npc as any).人物事迹;
    if (!Array.isArray(chronicles)) return false;
    if (startIndex < 0 || endIndex >= chronicles.length || startIndex >= endIndex) return false;

    const npcName = (npc as any).姓名 || npcId;
    const selectedDeeds = chronicles.slice(startIndex, endIndex + 1);
    const prompt = `你是叙事记录员。以下是NPC「${npcName}」的${selectedDeeds.length}条事迹记录，请将它们合并总结为1条简洁的事迹摘要（30-60字），保留关键事件，去除冗余。只输出合并后的1条文本，不要编号或其他前缀。\n\n原始事迹：\n${selectedDeeds.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;

    try {
      const result = await requestCompletion(apiConfig, [
        { role: 'user', content: prompt },
      ], { temperature: 0.3 });
      const merged = result.text.replace(/^\d+[\.\)、]\s*/, '').trim();
      if (merged) {
        const newChronicles = [
          ...chronicles.slice(0, startIndex),
          merged,
          ...chronicles.slice(endIndex + 1),
        ];
        (npc as any).人物事迹 = newChronicles;
        return true;
      }
    } catch (e) {
      console.warn('[VariableManager] 事迹合并失败:', e);
    }
    return false;
  }

  /**
   * 校验 AI 叙事层声明的变量更新
   * 根据 narrativeGuardrails 裁剪或丢弃越界部分
   *
   * @param effects AI 声明的效果
   * @param guardrails 护栏配置
   * @returns 校验后的效果（可能被裁剪）
   */
  validateNarrativeEffects(
    effects: import('../modules/schema').ModuleEffects,
    guardrails: import('../modules/schema').NarrativeGuardrails | null,
  ): { valid: import('../modules/schema').ModuleEffects; rejected: string[] } {
    if (!guardrails) {
      return { valid: effects, rejected: [] };
    }

    const rejected: string[] = [];
    const valid: import('../modules/schema').ModuleEffects = {};

    // 校验生存资源
    if (effects.survival?.resources) {
      valid.survival = { ...valid.survival, resources: {} };
      const resources = valid.survival.resources!;
      for (const [id, change] of Object.entries(effects.survival.resources)) {
        // 检查是否是新资源（当前不存在）
        const isNewResource = !this.state.玩家.生存资源?.[id];

        if (isNewResource) {
          // 新资源：检查是否允许创建
          if (!guardrails.allowCreateResources) {
            rejected.push(`survival.resources.${id}: 不允许创建新资源`);
            continue;
          }
          // 允许创建新资源
          resources[id] = { ...change };
          continue;
        }

        // 已有资源：正常校验
        const maxDelta = guardrails.maxDeltaPerResource[id];

        if (change.delta !== undefined && maxDelta !== undefined) {
          if (Math.abs(change.delta) > maxDelta) {
            rejected.push(`survival.resources.${id}: delta ${change.delta} 超过限制 ${maxDelta}`);
            resources[id] = {
              delta: Math.sign(change.delta) * maxDelta,
              min: change.min,
            };
            continue;
          }
        }

        // set 操作受限（不在白名单中则拒绝）
        if (change.set !== undefined && !guardrails.setAllowedVars.includes(`survival.resources.${id}`)) {
          rejected.push(`survival.resources.${id}: set 操作不在白名单中`);
          continue;
        }

        resources[id] = { ...change };
      }
    }

    // 校验生存资源动态操作（add/remove/update）——直接放行，由引擎层处理
    if (effects.survival?.addResources || effects.survival?.removeResources || effects.survival?.updateResources) {
      if (!valid.survival) valid.survival = {};
      if (effects.survival.addResources) valid.survival.addResources = effects.survival.addResources;
      if (effects.survival.removeResources) valid.survival.removeResources = effects.survival.removeResources;
      if (effects.survival.updateResources) valid.survival.updateResources = effects.survival.updateResources;
    }

    // 校验经营资产
    if (effects.business) {
      valid.business = {};
      if (effects.business.fundsDelta !== undefined) {
        const maxDelta = guardrails.maxDeltaPerResource['funds'];
        if (maxDelta !== undefined && Math.abs(effects.business.fundsDelta) > maxDelta) {
          rejected.push(`business.fundsDelta: ${effects.business.fundsDelta} 超过限制 ${maxDelta}`);
          valid.business.fundsDelta = Math.sign(effects.business.fundsDelta) * maxDelta;
        } else {
          valid.business.fundsDelta = effects.business.fundsDelta;
        }
      }
    }

    // 校验数值属性
    if (effects.stats?.changes) {
      valid.stats = { changes: {} };
      const changes = valid.stats.changes!;
      for (const [id, change] of Object.entries(effects.stats.changes)) {
        const maxDelta = guardrails.maxDeltaPerStat[id];

        if (change.delta !== undefined && maxDelta !== undefined) {
          if (Math.abs(change.delta) > maxDelta) {
            rejected.push(`stats.changes.${id}: delta ${change.delta} 超过限制 ${maxDelta}`);
            changes[id] = {
              delta: Math.sign(change.delta) * maxDelta,
              min: change.min,
            };
            continue;
          }
        }

        // set 操作受限
        if (change.set !== undefined && !guardrails.setAllowedVars.includes(`stats.${id}`)) {
          rejected.push(`stats.changes.${id}: set 操作不在白名单中`);
          continue;
        }

        changes[id] = { ...change };
      }
    }

    // 校验成长体系
    if (effects.progression) {
      valid.progression = {};
      if (effects.progression.xpDelta !== undefined) {
        const maxDelta = guardrails.maxDeltaPerStat['xp'];
        if (maxDelta !== undefined && Math.abs(effects.progression.xpDelta) > maxDelta) {
          rejected.push(`progression.xpDelta: ${effects.progression.xpDelta} 超过限制 ${maxDelta}`);
          valid.progression.xpDelta = Math.sign(effects.progression.xpDelta) * maxDelta;
        } else {
          valid.progression.xpDelta = effects.progression.xpDelta;
        }
      }
      // tierIndex 变化总是允许的（升级/降级）
      if (effects.progression.tierIndex !== undefined) {
        valid.progression.tierIndex = effects.progression.tierIndex;
      }
    }

    return { valid, rejected };
  }

  /**
   * 应用模块效果（来自世界演化系统的机械层结算）
   * 校验模块开关 → 应用 delta/set（带 min 下限）→ 写 effectLog
   *
   * @param effects 模块效果
   * @param source 来源（用于日志）
   * @param enabledModules 当前启用的模块 ID 列表（用于校验模块开关）
   * @returns 效果日志
   */
  applyModuleEffects(
    effects: import('../modules/schema').ModuleEffects,
    source: 'rule' | 'periodic' | 'ai' | 'npc' = 'rule',
    enabledModules?: string[],
  ): import('../modules/schema').EffectLogEntry[] {
    type EffectLog = import('../modules/schema').EffectLogEntry;
    const tick = this.state.simulationRuntime?.tick ?? 0;
    const rejected: EffectLog[] = [];
    const transactionEffects: GameplayEffect[] = [];
    const enabled = (moduleId: string) => !enabledModules || enabledModules.includes(moduleId);
    const reject = (module: EffectLog['module'], variable: string, reason: string) => {
      console.warn(`[applyModuleEffects] ${reason}`);
      rejected.push({ tick, source, module, variable, before: 'N/A' as never, after: 'N/A' as never, reason });
    };

    const resources = this.state.玩家.生存资源 ?? {};
    if (effects.survival?.resources && enabled('survival')) {
      for (const [id, change] of Object.entries(effects.survival.resources)) {
        if (!(id in resources)) {
          reject('survival', id, `跳过：资源 ${id} 不存在于当前世界`);
          continue;
        }
        const path = `玩家.生存资源.${id}.数量`;
        if (change.set !== undefined) {
          transactionEffects.push({ set: { path, value: Math.max(change.min ?? 0, change.set) } });
        } else if (change.delta !== undefined) {
          transactionEffects.push({ add: { path, delta: change.delta, min: Math.max(0, change.min ?? 0) } });
        }
      }
    }
    if (effects.survival?.addResources && enabled('survival')) {
      for (const resource of effects.survival.addResources) {
        if (resources[resource.id]) continue;
        transactionEffects.push({ set: { path: `玩家.生存资源.${resource.id}`, value: {
          数量: Math.max(0, resource.amount ?? 0),
          name: resource.name,
          symbol: resource.symbol,
          最大值: resource.max,
          scarce: resource.scarce,
          ...(resource.description ? { description: resource.description } : {}),
          ...(resource.gatherRate ? { gatherRate: resource.gatherRate } : {}),
          ...(resource.usage ? { usage: resource.usage } : {}),
        } } });
      }
    }
    if (effects.survival?.removeResources && enabled('survival')) {
      for (const { id } of effects.survival.removeResources) {
        if (resources[id]) transactionEffects.push({ remove: { path: `玩家.生存资源.${id}` } });
      }
    }
    if (effects.survival?.updateResources && enabled('survival')) {
      for (const update of effects.survival.updateResources) {
        const current = resources[update.id];
        if (!current) continue;
        transactionEffects.push({ set: { path: `玩家.生存资源.${update.id}`, value: {
          ...current,
          ...(update.max !== undefined ? { 最大值: update.max } : {}),
          ...(update.scarce !== undefined ? { scarce: update.scarce } : {}),
          ...(update.gatherRate !== undefined ? { gatherRate: update.gatherRate } : {}),
        } } });
      }
    }

    if (effects.business && enabled('business')) {
      if (!this.state.玩家.经营资产) {
        transactionEffects.push({ set: { path: '玩家.经营资产', value: { 资金: 0, 资产列表: [] } } });
      }
      if (effects.business.fundsDelta !== undefined) {
        transactionEffects.push({ add: { path: '玩家.经营资产.资金', delta: effects.business.fundsDelta, min: 0, create: true } });
      }
      for (const asset of effects.business.newAssets ?? []) {
        if (isRecord(asset)) transactionEffects.push({ append: { path: '玩家.经营资产.资产列表', value: asset as never, create: true } });
      }
    }

    if (effects.stats?.changes && enabled('stat')) {
      const stats = this.state.玩家.生存状态;
      for (const [id, change] of Object.entries(effects.stats.changes)) {
        const stateKey = id === 'attrA' ? '血量' : id === 'attrB' ? '体力值' : id;
        if (!(stateKey in stats)) {
          reject('stats', id, `跳过：属性 ${id} 不存在于当前世界`);
          continue;
        }
        const path = `玩家.生存状态.${stateKey}`;
        if (change.set !== undefined) {
          transactionEffects.push({ set: { path, value: Math.max(change.min ?? 0, change.set) } });
        } else if (change.delta !== undefined) {
          transactionEffects.push({ add: { path, delta: change.delta, min: Math.max(0, change.min ?? 0) } });
        }
      }
    }

    if (effects.progression && enabled('progression')) {
      if (effects.progression.xpDelta !== undefined) {
        transactionEffects.push({ add: { path: '玩家.当前经验值', delta: effects.progression.xpDelta, min: 0, create: true } });
      }
      if (effects.progression.tierIndex !== undefined) {
        transactionEffects.push({ set: { path: '玩家.当前段位索引', value: Math.max(0, Math.trunc(effects.progression.tierIndex)) } });
      }
    }

    if (transactionEffects.length === 0) return rejected;
    const result = executeGameplayTransaction(this.state, {
      id: `module-effects:${source}:${tick}:${(this.state.gameplay?.sequence ?? 0) + 1}`,
      moduleId: 'system',
      source,
      label: '机械层统一结算',
      effects: transactionEffects,
      events: [{ type: 'modules.effects-applied', payload: { source, effectCount: transactionEffects.length } }],
    }, { tick });
    if (result.status === 'applied') this.state = result.state;

    const logs: EffectLog[] = result.changes.map(change => {
      const parts = change.path.split('.');
      const meta: Pick<EffectLog, 'module' | 'variable'> = change.path.startsWith('玩家.生存资源.')
        ? { module: 'survival', variable: parts[2] ?? 'resources' }
        : change.path.startsWith('玩家.经营资产.') || change.path === '玩家.经营资产'
          ? { module: 'business', variable: parts[2] ?? 'assets' }
          : change.path.startsWith('玩家.生存状态.')
            ? { module: 'stats', variable: parts[2] ?? 'stats' }
            : { module: 'progression', variable: change.path.endsWith('当前段位索引') ? 'tierIndex' : 'xp' };
      return { tick, source, module: meta.module, variable: meta.variable, before: change.before as never, after: change.after as never, reason: '机械层统一结算' };
    });
    logs.push(...rejected);
    if (this.state.simulationRuntime && logs.length > 0) {
      this.state.simulationRuntime.effectLog.push(...logs);
      if (this.state.simulationRuntime.effectLog.length > 100) {
        this.state.simulationRuntime.effectLog = this.state.simulationRuntime.effectLog.slice(-100);
      }
    }
    return logs;
  }

  /**
   * 应用世界状态更新（泛化结构）
   * 按"轴名 → 字段 → 新值"写入
   *
   * @param updates 世界状态更新
   */
  applyWorldStateUpdate(updates: Record<string, Record<string, string>>): void {
    const effects: GameplayEffect[] = [];
    for (const [axisName, fields] of Object.entries(updates)) {
      for (const [fieldName, value] of Object.entries(fields)) {
        const path = `世界.状态轴.${axisName}.${fieldName}`;
        if (isSafePath(path)) effects.push({ set: { path, value } });
      }
    }
    if (effects.length === 0) return;
    this.commitGameplayTransaction({
      id: `world-state:${this.state.simulationRuntime?.tick ?? 0}:${(this.state.gameplay?.sequence ?? 0) + 1}`,
      moduleId: 'system',
      source: 'ai',
      label: '世界状态轴更新',
      effects,
    });
  }

  /**
   * 获取世界状态轴
   */
  getWorldStateAxes(): Record<string, Record<string, string>> {
    return this.state.世界.状态轴 ?? {};
  }

  // 创建快照（挂载到消息上，用于回滚）
  // 使用 JSON 序列化替代 cloneDeep，避免超大对象导致 "Invalid string length"
  createSnapshot(): GameState {
    // 先瘦身：截断 NPC 长字段、限制事迹条数，防止序列化爆内存
    const slim = this._slimForSnapshot(this.syncModuleRuntime());
    try {
      return JSON.parse(JSON.stringify(slim));
    } catch {
      return cloneDeep(slim);
    }
  }

  /** 瘦身 state 用于快照：截断长文本、限制数组长度 */
  private _slimForSnapshot(state: GameState): GameState {
    const s = { ...state };
    if (s.人物档案) {
      const npcs: Record<string, unknown> = {};
      for (const [id, npc] of Object.entries(s.人物档案)) {
        if (!npc || typeof npc !== 'object') { npcs[id] = npc; continue; }
        const n = { ...npc } as any;
        // 截断长文本字段（超过 200 字截断）
        const longFields = ['背景', '外貌', '表性格', '里性格', '当前想法', '当前穿着', '当前状态', '内心想法', '备注'];
        for (const f of longFields) {
          if (typeof n[f] === 'string' && n[f].length > 200) n[f] = n[f].slice(0, 200) + '…';
        }
        // 事迹全量保留（仅发给 AI 时截取近期，存档不截断）
        // 移除大型缓存字段
        delete n.portraitUrl;
        npcs[id] = n;
      }
      s.人物档案 = npcs as any;
    }
    return s;
  }

  // 从快照恢复变量状态（保留 portraitBlobKey 等持久字段）
  restoreSnapshot(snapshot: GameState): void {
    if (!snapshot) return;
    const combatSession = this.state.v3?.combatSession;
    if (!canRollbackCombat(combatSession?.riskMode ?? 'normal', combatSession?.lifecycle ?? 'active')) return;
    const currentState = cloneDeep(this.state);
    const revisions = snapshot.moduleRevisions;
    if (revisions && Object.keys(revisions).length > 0) {
      this.moduleRegistry.restore(revisions);
      const records = this.moduleRegistry.listCurrentRecords()
        .filter(record => revisions[record.moduleId] !== undefined);
      const restoredCore = cloneDeep(snapshot);
      restoredCore.moduleRevisions = this.moduleRegistry.checkpoint();
      this.state = materializeModulePartitions(restoredCore, records);
    } else {
      this.state = cloneDeep(snapshot);
    }
    // 保留 portraitBlobKey，确保画像能从 IndexedDB 恢复
    if (currentState.人物档案 && this.state.人物档案) {
      for (const [id, npc] of Object.entries(currentState.人物档案)) {
        const target = this.state.人物档案[id];
        if (!target) continue;
        // 优先用快照中的 blobKey，其次用当前内存中的
        if (!(target as any).portraitBlobKey && (npc as any).portraitBlobKey) {
          (target as any).portraitBlobKey = (npc as any).portraitBlobKey;
        }
      }
    }
    this.normalizeState();
  }

  // 用 JSON 字符串覆盖当前状态（设置页编辑后保存）
  setStateFromJSON(json: string): boolean {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed === 'object' && parsed !== null) {
        const previousClock = this.captureAuthoritativeClock();
        const incomingTimeSystem = (parsed as any)?.世界?.时间系统;
        if (previousClock && isRecord(incomingTimeSystem)) {
          const incomingClock = isRecord(incomingTimeSystem.时钟)
            ? normalizeWorldClockState(incomingTimeSystem.时钟, this.worldClockConfig)
            : previousClock;
          const incomingDisplay = typeof incomingTimeSystem.当前时间 === 'string' ? incomingTimeSystem.当前时间.trim() : '';
          // The variables editor exposes 当前时间 as the human-editable field.
          // Reconcile it against the clock embedded in the same JSON every
          // time, making repeated Apply operations deterministic and avoiding
          // a stale hidden 时钟 object undoing the visible edit.
          incomingTimeSystem.时钟 = incomingDisplay
            ? reconcileEditedWorldClock(incomingClock, this.worldClockConfig, incomingDisplay)
            : incomingClock;
        }
        this.state = cloneDeep(parsed);
        this.normalizeState();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // 序列化为JSON（用于存档）
  toJSON() {
    return {
      state: this.state,
    };
  }

  // 从JSON恢复
  static fromJSON(data: {
    state: GameState;
    saveId?: string;
    moduleStates?: readonly ModuleStateRecord[];
    moduleCheckpoints?: readonly ModuleStateRecord[];
  }, worldClockConfig?: Partial<WorldClockConfig>) {
    return new VariableManager(data.state, data.saveId && data.moduleStates?.length ? {
      saveId: data.saveId,
      current: data.moduleStates,
      checkpoints: data.moduleCheckpoints,
    } : undefined, worldClockConfig);
  }
}
