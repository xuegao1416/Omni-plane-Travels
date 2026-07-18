// 变量管理器
import type { GameState } from '../schema/variables';
import { createDefaultGameState } from '../schema/variables';
import type { ApiConfig } from '../api/types';
import { requestCompletion } from '../api/client';
import { cloneDeep, get, set, merge, unset } from 'lodash-es';

/** 原型污染防护 — 过滤危险路径段 */
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
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

  // 规范化状态：确保NPC分类、事迹、结构默认值 + 笔记本容量限制 + 模块数值校验
  private normalizeState(): void {
    ensureNpcCategoryDefaults(this.state);
    ensureNpcChronicleDefaults(this.state);
    ensureNpcStructureDefaults(this.state);
    this.normalizeNotebook();
    this.validateAndClampModuleValues();
  }

  /**
   * 校验并修正模块数值（已简化 — 范围约束由世界书提示词控制）
   */
  private validateAndClampModuleValues(): void {
    // 世界系统已移除，属性范围约束由世界书条目中的提示词控制
  }

  // 笔记本容量限制：每个分区最多 20 条，超出删除最旧的
  private normalizeNotebook(): void {
    const NOTEBOOK_SECTION_CAP = 20;
    const notebook = this.state.玩家?.记事本;
    if (!notebook || typeof notebook !== 'object') return;

    for (const section of ['潜在危机', '当前机遇', '待办事项'] as const) {
      const entries = notebook[section];
      if (!entries || typeof entries !== 'object') continue;
      const keys = Object.keys(entries);
      if (keys.length > NOTEBOOK_SECTION_CAP) {
        // 删除最旧的条目（保留最后 N 个，按插入顺序）
        const toRemove = keys.slice(0, keys.length - NOTEBOOK_SECTION_CAP);
        for (const key of toRemove) {
          delete entries[key];
        }
      }
    }
  }

  // 批量应用补丁 (RFC 6902 风格) - NPC 感知版本
  applyPatches(patches: Array<{ op: string; path: string; value?: unknown }>) {
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
    try {
      const parsed = JSON.parse(updateText);

      // 数组 → RFC 6902 补丁
      if (Array.isArray(parsed)) {
        this.applyPatches(parsed);
        return true;
      }

      // 对象 → 深度合并（NPC 感知）
      if (typeof parsed === 'object' && parsed !== null) {
        this.applyMergeUpdate(parsed);
        return true;
      }
      return false;
    } catch {
      // 尝试解析为键值对格式
      try {
        const lines = updateText.split('\n').filter(l => l.includes('='));
        for (const line of lines) {
          const [path, ...rest] = line.split('=');
          const value = rest.join('=').trim();
          if (path && value) {
            this.setVar(path.trim(), value);
          }
        }
        this.normalizeState();
        return true;
      } catch {
        return false;
      }
    }
  }

  // NPC 感知的合并更新
  private applyMergeUpdate(patch: Record<string, unknown>): void {
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
