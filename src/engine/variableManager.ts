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
        case 'add':
          set(this.state, resolvedPath, patch.value);
          break;
        case 'remove':
          unset(this.state, resolvedPath);
          break;
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
        merge(this.state.人物档案[npcId], npcData);
      }

      // 从 patch 中移除已单独处理的 人物档案
      const { 人物档案: _npcs, ...rest } = patch;
      if (Object.keys(rest).length > 0) {
        merge(this.state, rest);
      }
    } else {
      // 没有 NPC 数据，普通合并
      merge(this.state, patch);
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
