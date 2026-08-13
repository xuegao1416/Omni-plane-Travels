// 变量管理器
import type { GameState } from '../schema/variables';
import { createDefaultGameState } from '../schema/variables';
import type { ApiConfig } from '../api/types';
import { requestCompletion } from '../api/client';
import { cloneDeep, get, set, merge, unset } from 'lodash-es';
import { formatWorldClock, normalizeWorldClockState, type WorldClockState } from '../time/worldClock';
import { toDisplayText } from '../utils/displayText';

/** 原型污染防护 — 过滤危险路径段 */
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const CORE_OBJECT_PATHS = new Set([
  '世界', '世界.时间系统', '世界.空间定位',
  '玩家', '玩家.生存状态', '玩家.身份信息', '玩家.技能系统', '玩家.货币资源', '玩家.物品栏',
  '人物档案',
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isSafePath(path: string): boolean {
  return !path.split('.').some(seg => DANGEROUS_PATH_SEGMENTS.has(seg));
}

/** 递归检测对象树（含嵌套）是否含原型污染危险键（L-19）。用于 merge 前的源头净化校验 */
function containsDangerousKey(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value as object)) return false; // 防循环引用死循环
  seen.add(value as object);
  for (const key of Object.keys(value as object)) {
    if (DANGEROUS_PATH_SEGMENTS.has(key)) return true;
    const child = (value as Record<string, unknown>)[key];
    if (child && typeof child === 'object' && containsDangerousKey(child, seen)) return true;
  }
  return false;
}
import {
  resolveNpcId,
  warnIgnoredNpcPatchUpdate,
  canCreateNpcFromPatch,
  getCreatableNpcIdentifier,
  isNpcCreationPayload,
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

  constructor(initial?: GameState) {
    this.state = initial ? cloneDeep(initial) : createDefaultGameState();
    this.normalizeState();
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
   * 初始化笔记本（第0轮自动注入）
   * 笔记本初始为空，由 AI 根据世界设定动态创建
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

  // 规范化状态：确保NPC分类、事迹、结构默认值 + 纪事迁移 + 任务系统迁移 + 模块数值校验
  private normalizeState(): void {
    this.repairCoreStateShape();
    const clock = (this.state.世界.时间系统 as any).时钟;
    if (clock && typeof clock === 'object') {
      const normalizedClock = normalizeWorldClockState(clock);
      this.state.世界.时间系统.时钟 = normalizedClock;
      // AI may still write the legacy display field. The structured clock always wins.
      this.state.世界.时间系统.当前时间 = formatWorldClock(normalizedClock);
    }
    ensureNpcCategoryDefaults(this.state);
    ensureNpcChronicleDefaults(this.state);
    ensureNpcStructureDefaults(this.state);
    this.migrateNotebookToChronicle();
    this.normalizeChronicle();
    this.migrateNotebookToTaskSystem();
    this.normalizeTaskSystem();
    this.validateAndClampModuleValues();
  }

  private captureAuthoritativeClock(): WorldClockState | undefined {
    const clock = (this.state as any)?.世界?.时间系统?.时钟;
    return clock && typeof clock === 'object' ? cloneDeep(normalizeWorldClockState(clock)) : undefined;
  }

  private restoreAuthoritativeClock(clock: WorldClockState | undefined): void {
    if (!clock) return;
    const state = this.state as any;
    if (!isRecord(state.世界)) state.世界 = {};
    if (!isRecord(state.世界.时间系统)) state.世界.时间系统 = {};
    state.世界.时间系统.时钟 = cloneDeep(clock);
    state.世界.时间系统.当前时间 = formatWorldClock(clock);
  }

  /** 修复旧存档或历史坏补丁留下的无效核心容器，避免后续轮次在构建快照时永久失败。 */
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
  }

  /**
   * 校验并修正模块数值（已简化 — 范围约束由世界书提示词控制）
   */
  private validateAndClampModuleValues(): void {
    // 世界系统已移除，属性范围约束由世界书条目中的提示词控制
  }


  private migrateNotebookToChronicle(): void {
    const notebook = this.state.玩家?.记事本 as any;
    if (!notebook || typeof notebook !== 'object') return;

    // 确保纪事系统存在
    if (!this.state.玩家.纪事系统) {
      this.state.玩家.纪事系统 = { 纪事: {} };
    }
    const chronicles = this.state.玩家.纪事系统.纪事;

    // 迁移潜在危机
    if (notebook.潜在危机 && typeof notebook.潜在危机 === 'object') {
      for (const [name, c] of Object.entries(notebook.潜在危机) as [string, any][]) {
        if (!chronicles[name]) {
          chronicles[name] = {
            标题: name,
            类型: '风险',
            描述: c.应对措施 || '',
            状态: '活跃',
            详情: {
              严重程度: c.严重程度 || '',
              预计影响时间: c.预计影响时间 || '',
            },
            $time: c.$time || Date.now(),
          };
        }
      }
      delete notebook.潜在危机;
    }

    // 迁移当前机遇
    if (notebook.当前机遇 && typeof notebook.当前机遇 === 'object') {
      for (const [name, o] of Object.entries(notebook.当前机遇) as [string, any][]) {
        if (!chronicles[name]) {
          chronicles[name] = {
            标题: name,
            类型: '机遇',
            描述: o.行动计划 || '',
            状态: '活跃',
            详情: {
              时效性: o.时效性 || '',
              所需资源: o.所需资源 || '',
            },
            $time: o.$time || Date.now(),
          };
        }
      }
      delete notebook.当前机遇;
    }

    // 迁移待办事项到任务系统（保留原有逻辑）
    if (notebook.待办事项 && typeof notebook.待办事项 === 'object') {
      const todos = notebook.待办事项;
      if (Object.keys(todos).length > 0) {
        if (!this.state.玩家.任务系统) {
          this.state.玩家.任务系统 = { 活跃任务: {}, 已完成任务: {}, 已失败任务: {} };
        }
        const taskSystem = this.state.玩家.任务系统;
        for (const [name, todo] of Object.entries(todos) as [string, any][]) {
          const status = todo.状态 === '已完成' ? '已完成' : todo.状态 === '已取消' ? '已放弃' : '进行中';
          const target = status === '已完成' ? '已完成任务' : status === '已放弃' ? '已失败任务' : '活跃任务';
          if (!taskSystem[target][name]) {
            taskSystem[target][name] = {
              任务名: name, 任务类型: '支线', 描述: name, 状态: status as any,
              优先级: todo.优先级 || '中', 目标: name, 截止时间: todo.截止时间, $time: todo.$time || Date.now(),
            };
          }
        }
      }
      delete notebook.待办事项;
    }

    // 清理空的旧记事本
    if (Object.keys(notebook).length === 0) {
      delete this.state.玩家.记事本;
    }

    console.log('[VariableManager] 已迁移旧记事本到纪事系统');
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

  /** 旧存档迁移：将 记事本.待办事项 迁移到 任务系统 */
  private migrateNotebookToTaskSystem(): void {
    const notebook = this.state.玩家?.记事本 as any;
    if (!notebook?.待办事项 || typeof notebook.待办事项 !== 'object') return;

    const todos = notebook.待办事项;
    if (Object.keys(todos).length === 0) {
      delete notebook.待办事项;
      return;
    }

    // 确保任务系统存在
    if (!this.state.玩家.任务系统) {
      this.state.玩家.任务系统 = { 活跃任务: {}, 已完成任务: {}, 已失败任务: {} };
    }
    const taskSystem = this.state.玩家.任务系统;

    for (const [name, todo] of Object.entries(todos) as [string, any][]) {
      const status = todo.状态 === '已完成' ? '已完成' : todo.状态 === '已取消' ? '已放弃' : '进行中';
      const target = status === '已完成' ? '已完成任务' : status === '已放弃' ? '已失败任务' : '活跃任务';
      if (!taskSystem[target][name]) {
        taskSystem[target][name] = {
          任务名: name,
          任务类型: '支线',
          描述: name,
          状态: status as any,
          优先级: todo.优先级 || '中',
          目标: name,
          截止时间: todo.截止时间,
          $time: todo.$time || Date.now(),
        };
      }
    }

    delete notebook.待办事项;
    console.log(`[VariableManager] 已迁移 ${Object.keys(todos).length} 条待办事项到任务系统`);
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

        // 早期提示词允许把“目标”写成 { 描述, 阶段 }。这种旧数据会被 React
        // 当作子节点直接渲染并触发 #31；在状态入口迁移为当前扁平结构。
        const legacyGoal = isRecord(task.目标) ? task.目标 : undefined;
        if (legacyGoal) {
          task.目标 = typeof legacyGoal.描述 === 'string'
            ? legacyGoal.描述
            : typeof legacyGoal.名称 === 'string'
              ? legacyGoal.名称
              : key;
          if (!Array.isArray(task.阶段) && Array.isArray(legacyGoal.阶段)) {
            task.阶段 = legacyGoal.阶段;
          }
        }

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

  // 批量应用补丁 (RFC 6902 风格) - NPC 感知版本
  applyPatches(patches: Array<{ op: string; path: string; value?: unknown }>) {
    const authoritativeClock = this.captureAuthoritativeClock();
    for (const patch of patches) {
      const rawPath = patch.path.replace(/^\//, '').replace(/\//g, '.');
      const pathParts = rawPath.split('.');

      // NPC 感知逻辑：当路径涉及 人物档案.XXX 时
      if (pathParts[0] === '人物档案' && pathParts.length >= 2) {
        const npcResolution = resolveNpcId(pathParts[1], this.state);

        if (!npcResolution.ok) {
          if (canCreateNpcFromPatch(pathParts, patch.op, patch.value)) {
            const creatableId = getCreatableNpcIdentifier(pathParts[1]);
            if (!creatableId) {
              warnIgnoredNpcPatchUpdate('RFC 补丁', pathParts[1], npcResolution);
              continue;
            }
            pathParts[1] = creatableId;
          } else {
            warnIgnoredNpcPatchUpdate('RFC 补丁', pathParts[1], npcResolution);
            continue;
          }
        } else {
          pathParts[1] = npcResolution.npcId!;
        }
      }

      const resolvedPath = pathParts.join('.');
      if (!isSafePath(resolvedPath)) continue;
      if (CORE_OBJECT_PATHS.has(resolvedPath)) {
        if (patch.op === 'remove' || !isRecord(patch.value)) {
          throw new Error(`拒绝破坏核心状态容器的变量补丁: ${resolvedPath}`);
        }
      }
      switch (patch.op) {
        case 'replace':
        case 'add': {
          // 好感度 delta 钳制（RFC 补丁路径）
          if (pathParts[0] === '人物档案' && pathParts.length >= 4 &&
              pathParts[2] === '关系数据' && pathParts[3] === '好感度' &&
              (patch.op === 'replace' || patch.op === 'add')) {
            const npcIdForClamp = pathParts[1];
            const currentFavor = (this.state.人物档案[npcIdForClamp] as any)?.关系数据?.好感度;
            if (typeof currentFavor === 'number' && Number.isFinite(currentFavor)) {
              const newFavor = Number(patch.value);
              if (Number.isFinite(newFavor)) {
                const delta = newFavor - currentFavor;
                if (Math.abs(delta) > 15) {
                  patch.value = safeClamp(Math.round(currentFavor + Math.sign(delta) * 15), -100, 100, currentFavor);
                  console.warn(`[VariableManager] RFC补丁好感度 delta ${delta} 超限，已钳制: ${currentFavor} → ${patch.value} (${npcIdForClamp})`);
                } else {
                  patch.value = safeClamp(newFavor, -100, 100, currentFavor);
                }
              }
            }
          }
          set(this.state, resolvedPath, patch.value);
          break;
        }
        case 'remove':
          unset(this.state, resolvedPath);
          break;
      }
    }

    // Variable AI is allowed to update weather and world axes, but not the
    // structured clock or its derived legacy display (including via parent replace).
    this.restoreAuthoritativeClock(authoritativeClock);

    // NPC 必填字段校验：在场 NPC 缺少当前想法/当前状态时警告
    for (const [id, npc] of Object.entries(this.state.人物档案)) {
      const npcRecord = npc as any;
      if (npcRecord.人物分类 !== '在场') continue;
      const missing: string[] = [];
      const thoughts = npcRecord.个人信息?.当前想法;
      if (!thoughts || thoughts === '暂无' || thoughts === '未知') missing.push('当前想法');
      const status = npcRecord.个人信息?.当前状态;
      if (!status || status === '暂无' || status === '未知') missing.push('当前状态');
      if (missing.length > 0) {
        console.warn(`[VariableManager] 在场NPC「${npcRecord.姓名 || id}」缺少必填字段: ${missing.join('、')}（辅助AI可能未返回完整更新）`);
      }
    }

    this.normalizeState();
  }

  // 从AI响应中的UpdateVariable标签解析并应用更新
  applyUpdateVariable(updateText: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(updateText);
    } catch {
      return this.applyLegacyKeyValueUpdate(updateText);
    }

    const previousState = cloneDeep(this.state);
    try {
      // 数组 → RFC 6902 补丁
      if (Array.isArray(parsed)) {
        this.applyPatches(parsed);
        if (!this.hasValidCoreStateShape()) throw new Error('变量补丁破坏了核心状态结构');
        return true;
      }

      // 对象 → 深度合并（NPC 感知）
      if (typeof parsed === 'object' && parsed !== null) {
        this.applyMergeUpdate(parsed as Record<string, unknown>);
        if (!this.hasValidCoreStateShape()) throw new Error('变量更新破坏了核心状态结构');
        return true;
      }
      return false;
    } catch {
      this.state = previousState;
      return false;
    }
  }

  /** 兼容旧版 path=value 输出；同样以整批事务方式应用。 */
  private applyLegacyKeyValueUpdate(updateText: string): boolean {
    const lines = updateText.split('\n').filter(l => l.includes('='));
    if (lines.length === 0) return false;

    const previousState = cloneDeep(this.state);
    const authoritativeClock = this.captureAuthoritativeClock();
    try {
      let appliedCount = 0;
      for (const line of lines) {
        const [path, ...rest] = line.split('=');
        const value = rest.join('=').trim();
        if (path && value) {
          this.setVar(path.trim(), value);
          appliedCount++;
        }
      }
      if (appliedCount === 0) return false;
      this.restoreAuthoritativeClock(authoritativeClock);
      this.normalizeState();
      if (!this.hasValidCoreStateShape()) throw new Error('旧版变量更新破坏了核心状态结构');
      return true;
    } catch {
      this.state = previousState;
      return false;
    }
  }

  /** 防止一次坏补丁把存档写成后续轮次无法读取的半损坏状态。 */
  private hasValidCoreStateShape(): boolean {
    const state = this.state as unknown as Record<string, unknown>;
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

  // NPC 感知的合并更新
  private applyMergeUpdate(patch: Record<string, unknown>): void {
    const authoritativeClock = this.captureAuthoritativeClock();
    // ★ 经营资产.资产列表 必须替换而非合并（lodash merge 会按索引覆盖而非追加）
    let pendingAssetList: unknown[] | undefined;
    const playerPatch = patch.玩家 as Record<string, unknown> | undefined;
    const bizPatch = playerPatch?.经营资产 as Record<string, unknown> | undefined;
    if (Array.isArray(bizPatch?.资产列表)) {
      pendingAssetList = bizPatch.资产列表;
      delete bizPatch.资产列表;
      if (Object.keys(bizPatch).length === 0) {
        delete playerPatch!.经营资产;
      }
      if (Object.keys(playerPatch!).length === 0) {
        delete patch.玩家;
      }
    }

    // 处理 人物档案 中的 NPC 数据
    if (patch.人物档案 && typeof patch.人物档案 === 'object' && !Array.isArray(patch.人物档案)) {
      const npcUpdates = patch.人物档案 as Record<string, unknown>;
      for (const [identifier, data] of Object.entries(npcUpdates)) {
        const npcResolution = resolveNpcId(identifier, this.state);

        let npcId = npcResolution.npcId;
        if (!npcResolution.ok) {
          if (!isNpcCreationPayload(data)) {
            warnIgnoredNpcPatchUpdate('合并补丁', identifier, npcResolution);
            continue;
          }
          npcId = getCreatableNpcIdentifier(identifier);
          if (!npcId) {
            warnIgnoredNpcPatchUpdate('合并补丁', identifier, npcResolution);
            continue;
          }
        }

        if (!npcId) continue;
        if (!isSafePath(npcId)) continue; // 防御原型污染：拒绝危险键作为 NPC 标识
        if (!this.state.人物档案[npcId]) {
          (this.state.人物档案 as any)[npcId] = {};
        }
        // 人物事迹：支持精细操作（chronicleOperations）或追加模式
        const npcData = data as Record<string, unknown>;

        // 优先处理 chronicleOperations（精细操作：add/replace/merge/remove）
        const chronicleOps = (npcData as any).chronicleOperations;
        if (Array.isArray(chronicleOps)) {
          delete (npcData as any).chronicleOperations;
          const existing = (this.state.人物档案[npcId] as any).人物事迹;
          const working = Array.isArray(existing) ? [...existing] : [];

          for (const op of chronicleOps) {
            if (!op || typeof op !== 'object') continue;
            const type = String(op.type || '').toLowerCase();

            if (type === 'add' && op.value && !working.includes(String(op.value))) {
              working.push(String(op.value));
            } else if (type === 'replace' && typeof op.index === 'number' && op.value) {
              if (op.index >= 0 && op.index < working.length) {
                working[op.index] = String(op.value);
              }
            } else if (type === 'merge' && Array.isArray(op.indexes) && op.value) {
              const indexes = op.indexes.map((i: unknown) => Number(i)).filter((i: number) => i >= 0 && i < working.length).sort((a: number, b: number) => a - b);
              if (indexes.length > 0) {
                working[indexes[0]] = String(op.value);
                // 从后往前删除被合并的条目
                for (let i = indexes.length - 1; i >= 1; i--) {
                  working.splice(indexes[i], 1);
                }
              }
            } else if (type === 'remove' && typeof op.index === 'number') {
              if (op.index >= 0 && op.index < working.length) {
                working.splice(op.index, 1);
              }
            }
          }

          // 去重（不截断，全量保留）
          const deduped = working.filter((item, i) => working.indexOf(item) === i);
          (this.state.人物档案[npcId] as any).人物事迹 = deduped;
        }

        // 兼容模式：人物事迹数组追加（去重，不截断）
        const incomingChronicles = npcData.人物事迹;
        if (Array.isArray(incomingChronicles)) {
          delete npcData.人物事迹;
          const existing = (this.state.人物档案[npcId] as any).人物事迹;
          const existingArr = Array.isArray(existing) ? existing : [];
          const newEntries = incomingChronicles.filter(c => !existingArr.includes(c));
          (this.state.人物档案[npcId] as any).人物事迹 = [...existingArr, ...newEntries];
        }
        // 好感度 delta 钳制：防止 AI 输出极端值导致好感度乱跳
        const MAX_FAVORABILITY_DELTA = 15;
        const incomingRelation = (npcData as any).关系数据;
        if (incomingRelation && typeof incomingRelation === 'object' && incomingRelation.好感度 !== undefined) {
          const currentFavor = (this.state.人物档案[npcId] as any)?.关系数据?.好感度;
          if (typeof currentFavor === 'number' && Number.isFinite(currentFavor)) {
            const newFavor = Number(incomingRelation.好感度);
            if (Number.isFinite(newFavor)) {
              const delta = newFavor - currentFavor;
              if (Math.abs(delta) > MAX_FAVORABILITY_DELTA) {
                const clamped = Math.round(currentFavor + Math.sign(delta) * MAX_FAVORABILITY_DELTA);
                incomingRelation.好感度 = safeClamp(clamped, -100, 100, currentFavor);
                console.warn(`[VariableManager] 好感度 delta ${delta} 超限，已钳制: ${currentFavor} → ${incomingRelation.好感度} (${identifier})`);
              } else {
                incomingRelation.好感度 = safeClamp(newFavor, -100, 100, currentFavor);
              }
            }
          }
        }

        // 原型污染防护（L-19）：源头含危险键则跳过合并，避免污染 this.state
        if (!containsDangerousKey(npcData)) {
          merge(this.state.人物档案[npcId], npcData);
        }
      }

      // NPC 必填字段校验：在场 NPC 缺少当前想法/当前状态时警告
      for (const [id, npc] of Object.entries(this.state.人物档案)) {
        const npcRecord = npc as any;
        if (npcRecord.人物分类 !== '在场') continue;
        const missing: string[] = [];
        const thoughts = npcRecord.个人信息?.当前想法;
        if (!thoughts || thoughts === '暂无' || thoughts === '未知') missing.push('当前想法');
        const status = npcRecord.个人信息?.当前状态;
        if (!status || status === '暂无' || status === '未知') missing.push('当前状态');
        if (missing.length > 0) {
          console.warn(`[VariableManager] 在场NPC「${npcRecord.姓名 || id}」缺少必填字段: ${missing.join('、')}（辅助AI可能未返回完整更新）`);
        }
      }

      // 从 patch 中移除已单独处理的 人物档案
      const { 人物档案: _npcs, ...rest } = patch;
      if (Object.keys(rest).length > 0) {
        if (!containsDangerousKey(rest)) {
          merge(this.state, rest);
        }
      }
    } else {
      // 没有 NPC 数据，普通合并
      if (!containsDangerousKey(patch)) {
        merge(this.state, patch);
      }
    }

    // ★ 应用资产列表替换（已在前面从 patch 中提取）
    if (pendingAssetList) {
      if (!this.state.玩家.经营资产) {
        this.state.玩家.经营资产 = { 资金: 0, 资产列表: [], 交易日志: [] };
      }
      this.state.玩家.经营资产.资产列表 = pendingAssetList as any;
    }

    this.restoreAuthoritativeClock(authoritativeClock);
    this.normalizeState();
  }

  // 创建供系统提示使用的安全快照
  createSafeSnapshotForPrompt(): GameState {
    const snapshot = cloneDeep(this.state);
    // 对每个 NPC 创建安全快照
    const safeNpcs: Record<string, unknown> = {};
    for (const [id, npc] of Object.entries(snapshot.人物档案)) {
      safeNpcs[id] = createPromptSafeNpcSnapshot(npc, id);
    }
    (snapshot as any).人物档案 = safeNpcs;
    return snapshot;
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
    const log: import('../modules/schema').EffectLogEntry[] = [];
    const tick = this.state.simulationRuntime?.tick ?? 0;

    // 模块开关检查辅助函数
    const isModuleEnabled = (moduleId: string) => {
      if (!enabledModules) return true; // 未传入则默认启用（兼容旧调用）
      return enabledModules.includes(moduleId);
    };

    // 应用生存资源效果（需要启用 survival 模块）
    if (effects.survival?.resources && isModuleEnabled('survival')) {
      if (!this.state.玩家.生存资源) {
        this.state.玩家.生存资源 = {};
      }
      const resources = this.state.玩家.生存资源;

      for (const [id, change] of Object.entries(effects.survival.resources)) {
        // 存在性校验：只对已有的资源 id 应用，防止创建幽灵资源
        if (!(id in resources)) {
          console.warn(`[applyModuleEffects] 跳过未知生存资源 id: ${id}`);
          log.push({
            tick, source, module: 'survival', variable: id,
            before: 'N/A' as any, after: 'N/A' as any,
            reason: `跳过：资源 ${id} 不存在于当前世界`,
          });
          continue;
        }

        const before = resources[id]?.数量 ?? 0;
        let after = before;

        if (change.set !== undefined) {
          after = change.set;
        } else if (change.delta !== undefined) {
          after = before + change.delta;
        }

        // 应用 min 下限
        if (change.min !== undefined) {
          after = Math.max(after, change.min);
        }

        // 确保不为负数
        after = Math.max(0, after);

        // 保留已有字段（动态新增资源的 name/symbol/最大值 等元数据），只更新数量
        resources[id] = { ...resources[id], 数量: after };

        log.push({
          tick, source, module: 'survival', variable: id,
          before, after, reason: `机械层结算`,
        });
      }
    }

    // ── 动态添加新资源（资源发现/演化解锁）──
    if (effects.survival?.addResources && isModuleEnabled('survival')) {
      if (!this.state.玩家.生存资源) {
        this.state.玩家.生存资源 = {};
      }
      const resources = this.state.玩家.生存资源;

      for (const res of effects.survival.addResources) {
        if (resources[res.id]) {
          // 已存在，跳过（不重复添加）
          continue;
        }
        // 写入完整元数据，保证 UI 能正确显示（而非匿名 ❓）
        resources[res.id] = {
          数量: res.amount ?? 0,
          name: res.name,
          symbol: res.symbol,
          最大值: res.max,
          scarce: res.scarce,
          ...(res.description ? { description: res.description } : {}),
          ...(res.gatherRate ? { gatherRate: res.gatherRate } : {}),
          ...(res.usage ? { usage: res.usage } : {}),
        };
        log.push({
          tick, source, module: 'survival', variable: res.id,
          before: 'N/A' as any, after: res.amount ?? 0,
          reason: `新资源发现：${res.name || res.id}`,
        });
      }
    }

    // ── 动态移除资源（枯竭/被替代）──
    if (effects.survival?.removeResources && isModuleEnabled('survival')) {
      const resources = this.state.玩家.生存资源;
      if (resources) {
        for (const { id } of effects.survival.removeResources) {
          if (id in resources) {
            const before = resources[id]?.数量 ?? 0;
            delete resources[id];
            log.push({
              tick, source, module: 'survival', variable: id,
              before, after: '已移除' as any,
              reason: `资源淘汰/枯竭`,
            });
          }
        }
      }
    }

    // ── 动态修改资源属性 ──
    if (effects.survival?.updateResources && isModuleEnabled('survival')) {
      const resources = this.state.玩家.生存资源;
      if (resources) {
        for (const upd of effects.survival.updateResources) {
          if (upd.id in resources) {
            log.push({
              tick, source, module: 'survival', variable: upd.id,
              before: JSON.stringify(resources[upd.id]),
              after: JSON.stringify(upd),
              reason: `资源属性变更`,
            });
          }
        }
      }
    }

    // 应用经营资产效果（需要启用 business 模块）
    if (effects.business && isModuleEnabled('business')) {
      if (!this.state.玩家.经营资产) {
        this.state.玩家.经营资产 = { 资金: 0, 资产列表: [] };
      }
      const business = this.state.玩家.经营资产;

      if (effects.business.fundsDelta !== undefined) {
        const before = business.资金;
        business.资金 = Math.max(0, before + effects.business.fundsDelta);

        log.push({
          tick, source, module: 'business', variable: 'funds',
          before, after: business.资金, reason: `机械层结算`,
        });
      }
    }

    // 应用数值属性效果（需要启用 stat 模块）
    if (effects.stats?.changes && isModuleEnabled('stat')) {
      const stats = this.state.玩家.生存状态;

      for (const [id, change] of Object.entries(effects.stats.changes)) {
        // 存在性校验：只对已有的属性 key 应用
        if (!(id in stats)) {
          console.warn(`[applyModuleEffects] 跳过未知属性 id: ${id}`);
          log.push({
            tick, source, module: 'stats', variable: id,
            before: 'N/A' as any, after: 'N/A' as any,
            reason: `跳过：属性 ${id} 不存在于当前世界`,
          });
          continue;
        }

        const before = stats[id] ?? 0;
        let after = before;

        if (change.set !== undefined) {
          after = change.set;
        } else if (change.delta !== undefined) {
          after = before + change.delta;
        }

        // 应用 min 下限
        if (change.min !== undefined) {
          after = Math.max(after, change.min);
        }

        // 确保不为负数
        after = Math.max(0, after);

        stats[id] = after;

        log.push({
          tick, source, module: 'stats', variable: id,
          before, after, reason: `机械层结算`,
        });
      }
    }

    // 应用成长体系效果（需要启用 progression 模块）
    if (effects.progression && isModuleEnabled('progression')) {
      if (effects.progression.xpDelta !== undefined) {
        const before = this.state.玩家.当前经验值 ?? 0;
        this.state.玩家.当前经验值 = Math.max(0, before + effects.progression.xpDelta);

        log.push({
          tick, source, module: 'progression', variable: 'xp',
          before, after: this.state.玩家.当前经验值, reason: `机械层结算`,
        });
      }

      if (effects.progression.tierIndex !== undefined) {
        const before = this.state.玩家.当前段位索引 ?? 0;
        this.state.玩家.当前段位索引 = effects.progression.tierIndex;

        log.push({
          tick, source, module: 'progression', variable: 'tierIndex',
          before, after: this.state.玩家.当前段位索引, reason: `机械层结算`,
        });
      }
    }

    // 更新 simulationRuntime 的 effectLog
    if (this.state.simulationRuntime && log.length > 0) {
      this.state.simulationRuntime.effectLog.push(...log);
      // 限制日志数量（最多保留 100 条）
      if (this.state.simulationRuntime.effectLog.length > 100) {
        this.state.simulationRuntime.effectLog = this.state.simulationRuntime.effectLog.slice(-100);
      }
    }

    return log;
  }

  /**
   * 应用世界状态更新（泛化结构）
   * 按"轴名 → 字段 → 新值"写入
   *
   * @param updates 世界状态更新
   */
  applyWorldStateUpdate(updates: Record<string, Record<string, string>>): void {
    if (!this.state.世界.状态轴) {
      this.state.世界.状态轴 = {};
    }

    const axes = this.state.世界.状态轴;

    for (const [axisName, fields] of Object.entries(updates)) {
      if (!axes[axisName]) {
        axes[axisName] = {};
      }

      for (const [fieldName, value] of Object.entries(fields)) {
        axes[axisName][fieldName] = value;
      }
    }
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
    const slim = this._slimForSnapshot(this.state);
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
    const currentState = cloneDeep(this.state);
    this.state = cloneDeep(snapshot);
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
  static fromJSON(data: { state: GameState }) {
    return new VariableManager(data.state);
  }
}
