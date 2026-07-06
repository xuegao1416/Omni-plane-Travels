/**
 * 后台世界推演引擎 — 核心逻辑
 *
 * 职责：
 *   1. 管理世界事件的级联传导
 *   2. 管理角色离场后的暗线推进
 *   3. 管理 NPC 主动交互队列
 *   4. 事迹增量操作（chronicleOps）
 *   5. 陈旧事件自动清理
 *   6. 根据游戏时间触发推演
 *   7. 生成可注入系统提示的上下文
 */

import type {
  SimEvent, SimConfig, SimulationState, CharacterStoryline,
  StoryBeat, PlayerHook, GameTime, StorylineUpdate,
  SimGenerationResult, OffscreenNpcSummary, SimContext,
  NpcProactiveInteraction, ChronicleOperation, SimPreset,
  SimWorldContext, SimulationSnapshot,
} from './types';
import type {
  SimulationRules, ModuleEffects, EffectLogEntry,
  SimulationRuntimeState,
} from '../modules/schema';
import { createEmptySimState, createDefaultWorldContext } from './types';
import type { GameState, NPCData } from '../schema/variables';
import type { ApiConfig } from '../api/types';
import { requestCompletion } from '../api/client';
import { buildSimulationPrompt, parseSimulationResponse } from './llmIntegration';
import { SIM_STORAGE_KEY } from './storage';

/** 规范化 activePresetId：过滤空/垃圾值，回退到 'default' */
function sanitizeActivePresetId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw === 'null' || raw === 'undefined' || raw === 'default') {
    return 'default';
  }
  return raw;
}
import { DEFAULT_SIM_PRESET } from './presets';

// ─── 引擎类 ───

export class WorldSimulationEngine {
  state: SimulationState;
  private apiConfig: ApiConfig | null = null;
  /** 推演专用 API 配置（完整独立，不继承主 API 的任何字段），未设置则回退主 API */
  private simApiOverride: ApiConfig | null = null;
  /** 缓存最近一次 tick 的 gameState（供 applyChronicleOps 使用） */
  private _lastGameState: GameState | null = null;
  /** 当前世界的语义上下文（含自适应层级标签） */
  private _worldContext: SimWorldContext | null = null;
  /** 状态变更回调（供 UI store 同步用） */
  onStateChange: ((state: SimulationState) => void) | null = null;

  /** tag → rule 索引（性能优化，预建索引避免每轮遍历） */
  private _tagRuleIndex: Map<string, SimulationRules['eventEffects']> = new Map();
  /** keyword → rule 索引 */
  private _keywordRuleIndex: Map<string, SimulationRules['eventEffects']> = new Map();
  /** 当前规则的版本（用于检测规则变化，重建索引） */
  private _rulesVersion: number = 0;

  constructor(state?: SimulationState) {
    this.state = state ?? createEmptySimState();
  }

  /** 设置主 API 配置（回退用） */
  setApiConfig(config: ApiConfig) {
    this.apiConfig = config;
  }

  /** 设置推演专用 API 配置（完整独立，不继承主 API） */
  setSimApiOverride(override: ApiConfig | null) {
    this.simApiOverride = override;
  }

  /** 获取当前有效的 API 配置（推演独立 > 主 API 回退，不 merge） */
  get effectiveApiConfig(): ApiConfig | null {
    return this.simApiOverride ?? this.apiConfig;
  }

  /** 设置世界语义上下文（推演时使用自适应层级标签） */
  setWorldContext(ctx: SimWorldContext | null) {
    this._worldContext = ctx;
  }

  /** 获取当前世界的层级标签（供 UI 使用） */
  getLevelLabels(): Record<string, string> {
    const ctx = this._worldContext;
    if (ctx) return ctx.levelLabels;
    return createDefaultWorldContext('', '').levelLabels;
  }

  // ─── 状态管理 ───

  /** 更新配置 */
  updateConfig(patch: Partial<SimConfig>) {
    this.state.config = { ...this.state.config, ...patch };
    this.saveState();
  }

  /** 获取某个事件的完整级联树 */
  getEventTree(rootEventId: string): SimEvent[] {
    const result: SimEvent[] = [];
    const root = this.state.events[rootEventId];
    if (!root) return result;

    const collect = (evt: SimEvent) => {
      result.push(evt);
      for (const childId of evt.childEventIds) {
        const child = this.state.events[childId];
        if (child) collect(child);
      }
    };
    collect(root);
    return result;
  }

  /** 获取所有活跃事件的玩家切入点 */
  getPlayerHooks(): PlayerHook[] {
    const hooks: PlayerHook[] = [];
    for (const evt of Object.values(this.state.events)) {
      if (evt.status === 'active' || evt.status === 'brewing') {
        hooks.push(...evt.playerHooks);
      }
    }
    const urgencyOrder = { urgent: 0, near_term: 1, ongoing: 2 };
    hooks.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
    return hooks;
  }

  /** 获取角色暗线上下文（用于注入系统提示） */
  getStorylineContext(npcId: string): string | null {
    const storyline = this.state.storylines[npcId];
    if (!storyline || storyline.beats.length === 0) return null;

    const recentBeats = storyline.beats
      .filter(b => !b.merged)
      .slice(-3);

    if (recentBeats.length === 0) return null;

    const lines = ['【暗线推进 — 后台发生的事】'];
    for (const beat of recentBeats) {
      lines.push(`- ${beat.time}: ${beat.title} — ${beat.narrative}`);
    }
    if (storyline.summary) {
      lines.push(`\n${storyline.summary}`);
    }
    return lines.join('\n');
  }

  /** 获取所有角色暗线摘要 */
  getAllStorylineSummaries(): string {
    const parts: string[] = [];
    for (const [npcId] of Object.entries(this.state.storylines)) {
      const ctx = this.getStorylineContext(npcId);
      if (ctx) parts.push(ctx);
    }
    return parts.join('\n\n');
  }

  /** 获取世界新闻摘要 */
  getWorldNewsBrief(): string {
    if (this.state.worldNewsSummary) {
      return this.state.worldNewsSummary;
    }
    const activeEvents = Object.values(this.state.events).filter(
      e => e.status === 'active' || e.status === 'brewing',
    );
    if (activeEvents.length === 0) return '';

    const lines = ['【世界动态 — 正在进行的大事】'];
    for (const evt of activeEvents.slice(0, 5)) {
      const labels = this._worldContext?.levelLabels ?? createDefaultWorldContext('', '').levelLabels;
      const levelTag = labels[evt.level] ?? evt.level;
      lines.push(`[${levelTag}] ${evt.title}：${evt.description}`);
      if (evt.playerHooks.length > 0) {
        for (const hook of evt.playerHooks.slice(0, 2)) {
          lines.push(`  ↳ 可介入：${hook.title}`);
        }
      }
    }
    return lines.join('\n');
  }

  // ─── NPC 主动交互队列 ───

  /** 获取待消费的 NPC 交互列表 */
  getPendingInteractions(): NpcProactiveInteraction[] {
    return [...this.state.pendingInteractions];
  }

  /** 消费队首交互（取出并移除） */
  consumeInteraction(): NpcProactiveInteraction | undefined {
    return this.state.pendingInteractions.shift();
  }

  /** 按优先级获取最紧急的交互（不移除） */
  peekNextInteraction(): NpcProactiveInteraction | undefined {
    if (this.state.pendingInteractions.length === 0) return undefined;
    return [...this.state.pendingInteractions]
      .sort((a, b) => a.priority - b.priority)[0];
  }

  /** 移除指定 NPC 交互 */
  removeInteraction(interactionId: string) {
    const idx = this.state.pendingInteractions.findIndex(i => i.id === interactionId);
    if (idx >= 0) {
      this.state.pendingInteractions.splice(idx, 1);
      this.saveState();
    }
  }

  /** 清除所有待处理交互 */
  clearAllInteractions() {
    this.state.pendingInteractions = [];
    this.saveState();
  }

  /** 移除指定世界事件（从活跃或已解决中删除） */
  removeEvent(eventId: string) {
    if (this.state.events[eventId]) {
      delete this.state.events[eventId];
    } else if (this.state.resolvedEvents[eventId]) {
      delete this.state.resolvedEvents[eventId];
    }
    this.saveState();
  }

  /** 清除所有世界事件（活跃 + 已解决） */
  clearAllEvents() {
    this.state.events = {};
    this.state.resolvedEvents = {};
    this.state.worldNewsSummary = undefined;
    this.saveState();
  }

  /** 移除指定角色暗线 */
  removeStoryline(npcId: string) {
    delete this.state.storylines[npcId];
    this.saveState();
  }

  /** 清除所有角色暗线 */
  clearAllStorylines() {
    this.state.storylines = {};
    this.saveState();
  }

  // ─── 推演核心 ───

  /**
   * 检查是否应该推演
   */
  shouldTick(gameTime: GameTime, round: number): boolean {
    if (!this.state.config.enabled) return false;

    const cfg = this.state.config;
    if (cfg.autoTickInterval > 0) {
      const roundsSinceLastTick = round - cfg.lastAutoTickRound;
      if (roundsSinceLastTick < cfg.autoTickInterval) return false;
    }
    if (gameTime.current === cfg.lastSimulatedTime && cfg.lastSimulatedTime !== '') {
      return false;
    }
    return true;
  }

  /**
   * 执行一次推演（带 AI 生成）
   */
  async tick(
    gameState: GameState,
    gameTime: GameTime,
    round: number,
    worldSetting: string,
    preset?: SimPreset,
    simRules?: SimulationRules | null,
  ): Promise<SimGenerationResult | null> {
    if (!this.effectiveApiConfig) {
      console.warn('[WorldSim] 没有 API 配置，跳过推演');
      return null;
    }

    // 缓存 gameState 供 applyChronicleOps 使用
    this._lastGameState = gameState;

    // 1. 推进现有事件（自动级联 + 陈旧清理）
    this.advanceExistingEvents(gameState);

    // 2. 机械层结算（周期事件 + 事件效果匹配）
    const { effects: mechanicalEffects, log: effectLog } = this.resolveMechanicalEffects(gameState, simRules ?? null);

    // 3. 构建推演上下文
    const context = this.buildSimContext(gameState, gameTime, worldSetting);

    // 4. 调用 LLM 生成新的事件和暗线
    const activePreset = this.resolvePreset(preset);
    const prompt = buildSimulationPrompt(context, activePreset, this._worldContext ?? undefined);
    try {
      const result = await requestCompletion(this.effectiveApiConfig!, [
        { role: 'system', content: prompt },
        { role: 'user', content: '请根据当前世界状态推演接下来的发展。' },
      ], {
        temperature: 0.8,
        maxTokens: 4096,
        responseFormat: 'json',
      });

      const generation = parseSimulationResponse(result.text);
      if (!generation) {
        console.warn('[WorldSim] 解析 AI 响应失败');
        return null;
      }

      // 5. 应用生成结果（叙事层：事件/暗线/交互/NPC 事迹）
      this.applyGeneration(generation, gameState);

      // 6. 应用世界状态更新（如果规则定义了 worldStateRules）
      if (simRules?.worldStateRules) {
        const worldStateUpdate = this.applyWorldStateRules(generation, simRules.worldStateRules);
        if (worldStateUpdate && Object.keys(worldStateUpdate).length > 0) {
          generation.worldStateUpdate = worldStateUpdate;
        }
      }

      // 7. 机械层效果传递给变量提取（不直接应用）
      if (Object.keys(mechanicalEffects).length > 0) {
        generation.mechanicalEffects = mechanicalEffects;
      }

      // 8. 更新状态
      this.state.config.lastAutoTickRound = round;
      this.state.config.lastSimulatedTime = gameTime.current;
      this.state.tickCount++;
      this.state.lastTickTimestamp = Date.now();

      // 9. 更新运行时状态（周期计数器、效果日志）
      if (gameState.simulationRuntime) {
        gameState.simulationRuntime.tick = this.state.tickCount;
        if (effectLog.length > 0) {
          gameState.simulationRuntime.effectLog.push(...effectLog);
          // 限制日志数量
          if (gameState.simulationRuntime.effectLog.length > 100) {
            gameState.simulationRuntime.effectLog = gameState.simulationRuntime.effectLog.slice(-100);
          }
        }
      }

      this.saveState();
      return generation;
    } catch (err) {
      console.error('[WorldSim] 推演失败:', err);
      return null;
    }
  }

  /**
   * 应用世界状态规则
   * 根据生成的事件匹配 worldStateRules，返回需要更新的世界状态
   */
  private applyWorldStateRules(
    generation: SimGenerationResult,
    rules: import('../modules/schema').WorldStateRule[],
  ): Record<string, Record<string, string>> {
    const updates: Record<string, Record<string, string>> = {};

    // 检查新生成的事件
    const allEvents = [...generation.newEvents, ...generation.updatedEvents];

    for (const event of allEvents) {
      for (const rule of rules) {
        // 匹配条件
        const trigger = rule.trigger;
        const eventText = `${event.title} ${event.description}`.toLowerCase();

        let matched = false;

        // keyword 匹配
        if (trigger.keywords && trigger.keywords.length > 0) {
          matched = trigger.keywords.some(kw => eventText.includes(kw.toLowerCase()));
        }

        // tag 匹配（如果事件有 tag）
        if (!matched && trigger.tags && trigger.tags.length > 0) {
          // 暂时用 keyword 兜底
        }

        // eventType 匹配
        if (!matched && trigger.eventType) {
          matched = event.batchId === trigger.eventType;
        }

        if (matched) {
          // 合并更新
          for (const [axis, fields] of Object.entries(rule.updates)) {
            if (!updates[axis]) updates[axis] = {};
            Object.assign(updates[axis], fields);
          }
        }
      }
    }

    return updates;
  }

  /** 解析当前使用的预设 */
  private resolvePreset(override?: SimPreset): SimPreset {
    if (override) return override;
    const cfgId = this.state.config.activePresetId;
    if (cfgId === 'default') return DEFAULT_SIM_PRESET;
    // 未来可扩展：从 config.presets 中查找
    return DEFAULT_SIM_PRESET;
  }

  /**
   * 推进现有事件（不调 AI，纯逻辑推进）
   */
  private advanceExistingEvents(_gameState: GameState) {
    const currentTick = this.state.tickCount;
    for (const evt of Object.values(this.state.events)) {
      if (evt.status === 'brewing') {
        // brewing 事件至少存活 1 tick 才升级为 active，让玩家有机会看到"酝酿中"状态
        const age = currentTick - (evt.lastUpdatedTick ?? 0);
        if (age >= 1) {
          evt.status = 'active';
          evt.startedAtTime = evt.createdAtTime;
        }
      }
      if (evt.status === 'active' && evt.childEventIds.length > 0) {
        const allChildrenResolved = evt.childEventIds.every(
          cid => this.state.resolvedEvents[cid] || (
            this.state.events[cid]?.status === 'resolved'
          ),
        );
        if (allChildrenResolved && evt.childEventIds.length > 0) {
          evt.status = 'resolved';
          this.state.resolvedEvents[evt.id] = evt;
          delete this.state.events[evt.id];
        }
      }
    }

    this.enforceEventLimit();
    this.pruneStaleEvents();
  }

  /** 应用 AI 生成结果 */
  private applyGeneration(result: SimGenerationResult, gameState: GameState) {
    const currentTick = this.state.tickCount;

    // 应用新事件
    for (const evt of result.newEvents) {
      evt.lastUpdatedTick = currentTick;
      this.state.events[evt.id] = evt;
    }

    // 更新已有事件
    for (const evt of result.updatedEvents) {
      const existing = this.state.events[evt.id];
      if (existing) {
        // 保留原始创建时间
        evt.createdAtTime = existing.createdAtTime;
        evt.createdAtTick = existing.createdAtTick;
      }
      evt.lastUpdatedTick = currentTick;
      this.state.events[evt.id] = evt;
    }

    // 应用暗线更新（含 chronicleOps）
    for (const update of result.storylineUpdates) {
      this.applyStorylineUpdate(update, gameState);
    }

    // 应用 NPC 主动交互
    for (const interaction of result.npcInteractions) {
      this.applyNpcInteraction(interaction);
    }

    // 更新世界新闻
    if (result.worldNews) {
      this.state.worldNewsSummary = result.worldNews;
    }
  }

  /** 应用暗线更新 */
  private applyStorylineUpdate(update: StorylineUpdate, gameState: GameState) {
    let storyline = this.state.storylines[update.npcId];
    if (!storyline) {
      storyline = {
        npcId: update.npcId,
        beats: [],
        lastSimulatedTick: 0,
      };
      this.state.storylines[update.npcId] = storyline;
    }

    // 合并新节拍
    for (const beat of update.newBeats) {
      storyline.beats.push(beat);
    }
    storyline.lastSimulatedTick = this.state.tickCount;
    storyline.summary = update.summary;

    // 只保留最近 20 个节拍
    if (storyline.beats.length > 20) {
      storyline.beats = storyline.beats.slice(-20);
    }

    // 应用事迹增量操作
    if (update.chronicleOps && update.chronicleOps.length > 0) {
      this.applyChronicleOps(update.npcId, update.chronicleOps, gameState);
    }
  }

  /**
   * 应用事迹增量操作 — 让 LLM 能精确修改 NPC 大事记
   *
   * 支持四种操作：
   * - add: 追加新事迹
   * - replace: 按索引或旧值替换
   * - merge: 合并多条为一条
   * - remove: 删除指定事迹
   */
  private applyChronicleOps(
    npcId: string,
    ops: ChronicleOperation[],
    gameState: GameState,
  ) {
    const npc = gameState.人物档案[npcId];
    if (!npc) return;

    // 创建副本再修改，避免直接 mutate 游戏状态（与 VariableManager 的不可变模式一致）
    const chronicles: string[] = [...(npc.人物事迹 ?? [])];

    for (const op of ops) {
      try {
        switch (op.op) {
          case 'add': {
            if (op.value && !chronicles.includes(op.value)) {
              chronicles.push(op.value);
            }
            break;
          }
          case 'replace': {
            const idx = this.resolveChronicleIndex(chronicles, op);
            if (idx >= 0 && op.value) {
              chronicles[idx] = op.value;
            }
            break;
          }
          case 'merge': {
            const indices = this.resolveAllChronicleIndices(chronicles, op);
            if (indices.length > 0 && op.value) {
              chronicles[indices[0]] = op.value;
              // 从后往前删除，避免索引偏移
              for (let i = indices.length - 1; i > 0; i--) {
                chronicles.splice(indices[i], 1);
              }
            }
            break;
          }
          case 'remove': {
            const idx = this.resolveChronicleIndex(chronicles, op);
            if (idx >= 0) {
              chronicles.splice(idx, 1);
            }
            break;
          }
        }
      } catch (err) {
        console.warn(`[WorldSim] 事迹操作失败 (npc=${npcId}):`, op, err);
      }
    }

    npc.人物事迹 = chronicles;
  }

  /** 解析事迹索引（优先 index，其次 oldValue 匹配） */
  private resolveChronicleIndex(
    chronicles: string[],
    op: ChronicleOperation,
  ): number {
    if (op.index !== undefined && op.index >= 0 && op.index < chronicles.length) {
      return op.index;
    }
    if (op.oldValue) {
      return chronicles.findIndex(c => c === op.oldValue);
    }
    return -1;
  }

  /** 解析所有匹配索引（merge 操作用） */
  private resolveAllChronicleIndices(
    chronicles: string[],
    op: ChronicleOperation,
  ): number[] {
    if (op.index !== undefined) {
      return [op.index];
    }
    if (op.oldValue) {
      return chronicles
        .map((c, i) => c === op.oldValue ? i : -1)
        .filter(i => i >= 0);
    }
    return [];
  }

  /** 应用 NPC 主动交互（按 dedupeKey 去重） */
  private applyNpcInteraction(interaction: NpcProactiveInteraction) {
    const exists = this.state.pendingInteractions.some(
      i => i.dedupeKey === interaction.dedupeKey,
    );
    if (exists) return;

    this.state.pendingInteractions.push(interaction);

    // 按优先级排序
    this.state.pendingInteractions.sort((a, b) => a.priority - b.priority);

    // 最多保留 10 条
    if (this.state.pendingInteractions.length > 10) {
      this.state.pendingInteractions = this.state.pendingInteractions.slice(0, 10);
    }
  }

  // ─── 上下文构建 ───

  /** 构建推演上下文（传给 LLM） */
  private buildSimContext(
    gameState: GameState,
    gameTime: GameTime,
    worldSetting: string,
  ): SimContext {
    const activeEvents = Object.values(this.state.events)
      .filter(e => e.status === 'active' || e.status === 'brewing');
    const activeEventsSummary = activeEvents.length > 0
      ? activeEvents.map(e =>
          `[${e.level}] ${e.title}: ${e.description} (严重度:${e.severity}/10)`
        ).join('\n')
      : '当前世界暂无重大事件在推进。';

    const offscreenNpcs = this.extractOffscreenNpcs(gameState);
    const offscreenSummaries = offscreenNpcs.map(npc => this.buildOffscreenSummary(npc));

    const regionStates: Record<string, string> = {};
    for (const npc of Object.values(gameState.人物档案)) {
      const loc = npc.个人信息?.当前位置;
      if (loc && !regionStates[loc]) {
        regionStates[loc] = `有角色在此区域`;
      }
    }

    return {
      worldSetting,
      gameTime,
      activeEventsSummary,
      offscreenNpcSummaries: offscreenSummaries,
      regionStates,
      coreConflict: this.extractCoreConflict(gameState),
    };
  }

  /** 提取离场 NPC 摘要 */
  private extractOffscreenNpcs(gameState: GameState): NPCData[] {
    return Object.values(gameState.人物档案)
      .filter(npc => {
        const category = npc.人物分类;
        return (category === '离场' || category === '重点') && npc.重要NPC;
      })
      .slice(0, this.state.config.maxStorylineCharacters);
  }

  /** 构建单个 NPC 的摘要 */
  private buildOffscreenSummary(npc: NPCData): OffscreenNpcSummary {
    return {
      npcId: npc.姓名,
      name: npc.姓名,
      race: npc.种族 || '人类',
      personality: `${npc.个人信息?.表性格 ?? ''} / ${npc.个人信息?.里性格 ?? ''}`,
      currentLocation: npc.个人信息?.当前位置 ?? '未知',
      currentStatus: npc.个人信息?.当前状态 ?? '未知',
      shortTermGoal: npc.短期目标 ?? '未知',
      longTermGoal: npc.长期目标 ?? '未知',
      lastKnownChronicles: (Array.isArray(npc.人物事迹) ? npc.人物事迹 : []).slice(-5),
      relationship: `${npc.关系数据?.好感度 ?? 0}好感 / ${npc.关系数据?.关系类型 ?? '陌生人'}`,
    };
  }

  /** 提取核心冲突 */
  private extractCoreConflict(gameState: GameState): string {
    // 从世界演化引擎的活跃事件中提取核心冲突
    const activeEvents = Object.values(this.state.events)
      .filter(e => e.status === 'active' || e.status === 'brewing')
      .sort((a, b) => b.severity - a.severity);
    const topEvent = activeEvents[0];

    const crises = Object.keys(gameState.玩家?.记事本?.潜在危机 ?? {});
    const parts: string[] = [];
    if (topEvent) parts.push(`重大事件: ${topEvent.title}`);
    if (crises.length > 0) parts.push(`玩家面临的危机: ${crises.join(', ')}`);
    return parts.join(' | ') || '未知';
  }

  // ─── 辅助 ───

  /** 强制执行最大事件数 */
  private enforceEventLimit() {
    const activeEvents = Object.values(this.state.events).filter(
      e => e.status === 'active' || e.status === 'brewing',
    );
    if (activeEvents.length <= this.state.config.maxActiveEvents) return;

    activeEvents.sort((a, b) => b.severity - a.severity);
    const toRemove = activeEvents.slice(this.state.config.maxActiveEvents);
    for (const evt of toRemove) {
      evt.status = 'resolved';
      this.state.resolvedEvents[evt.id] = evt;
      delete this.state.events[evt.id];
    }
  }

  /**
   * 清理陈旧事件 — 长期无变化的事件自动降级直至归档
   *
   * 逻辑：
   * - 计算事件距上次更新的 tick 数
   * - 超过 staleTickThreshold 的事件，严重度每轮衰减 2
   * - 严重度降至 0 时自动归档
   */
  private pruneStaleEvents() {
    const threshold = this.state.config.staleTickThreshold;
    if (threshold <= 0) return;

    const currentTick = this.state.tickCount;
    const toArchive: string[] = [];

    for (const evt of Object.values(this.state.events)) {
      if (evt.status !== 'active') continue;

      const staleTicks = currentTick - evt.lastUpdatedTick;
      if (staleTicks > threshold) {
        evt.severity = Math.max(0, evt.severity - 2);
        if (evt.severity <= 0) {
          toArchive.push(evt.id);
        }
      }
    }

    // 归档严重度降为 0 的事件
    for (const id of toArchive) {
      const evt = this.state.events[id];
      if (evt) {
        evt.status = 'resolved';
        this.state.resolvedEvents[id] = evt;
        delete this.state.events[id];
      }
    }
  }

  /** 持久化到 localStorage + 通知 UI */
  saveState() {
    try {
      localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn('[WorldSim] 保存状态失败:', err);
    }
    // 通知 Zustand store 同步（避免 require 在 ESM 中失败）
    if (this.onStateChange) {
      try { this.onStateChange(this.state); } catch { /* ignore */ }
    }
  }

  /** 从 localStorage 加载 */
  static loadState(): SimulationState {
    try {
      const raw = localStorage.getItem(SIM_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SimulationState;
        // 兼容旧存档：补全缺失字段
        if (!parsed.pendingInteractions) parsed.pendingInteractions = [];
        if (!parsed.snapshots) parsed.snapshots = [];
        if (!parsed.config.staleTickThreshold) parsed.config.staleTickThreshold = 10;
        if (!parsed.config.activePresetId) parsed.config.activePresetId = 'default';
        parsed.config.activePresetId = sanitizeActivePresetId(parsed.config.activePresetId);
        return parsed;
      }
    } catch (err) {
      console.warn('[WorldSim] 加载状态失败:', err);
    }
    return createEmptySimState();
  }

  /** 替换整个状态（从存档恢复） */
  replaceState(state: SimulationState) {
    this.state = state;
    // 兼容旧存档：补全 snapshots 字段
    if (!this.state.snapshots) {
      this.state.snapshots = [];
    }
    this.saveState();
  }

  // ─── 规则索引管理 ───

  /**
   * 构建 tag/keyword → rule 索引
   * 当规则变化时调用，避免每轮遍历所有规则
   */
  buildRuleIndex(rules: SimulationRules): void {
    this._tagRuleIndex.clear();
    this._keywordRuleIndex.clear();

    for (const effect of rules.eventEffects) {
      // 索引 tag
      if (effect.trigger.tags) {
        for (const tag of effect.trigger.tags) {
          const existing = this._tagRuleIndex.get(tag) ?? [];
          existing.push(effect);
          this._tagRuleIndex.set(tag, existing);
        }
      }

      // 索引 keyword
      if (effect.trigger.keywords) {
        for (const keyword of effect.trigger.keywords) {
          const lowerKeyword = keyword.toLowerCase();
          const existing = this._keywordRuleIndex.get(lowerKeyword) ?? [];
          existing.push(effect);
          this._keywordRuleIndex.set(lowerKeyword, existing);
        }
      }
    }
  }

  // ─── 机械层结算 ───

  /**
   * 机械层结算：周期事件 + 事件效果匹配
   * 不经 AI，直接确定性结算
   *
   * @param gameState 当前游戏状态
   * @param rules 世界演化规则
   * @returns 机械层效果 + 效果日志
   */
  resolveMechanicalEffects(
    gameState: GameState,
    rules: SimulationRules | null,
  ): { effects: ModuleEffects; log: EffectLogEntry[] } {
    if (!rules) {
      return { effects: {}, log: [] };
    }

    const runtime = gameState.simulationRuntime;
    if (!runtime) {
      return { effects: {}, log: [] };
    }

    const mergedEffects: ModuleEffects = {};
    const effectLog: EffectLogEntry[] = [];
    const currentTick = runtime.tick;

    // 1. 周期事件结算
    for (const periodic of rules.periodicEvents) {
      // 推进计数器
      const counter = (runtime.periodicCounters[periodic.id] ?? 0) + 1;
      runtime.periodicCounters[periodic.id] = counter;

      // 计算下次触发时间（考虑 offset）
      const offset = periodic.offsetTicks ?? 0;
      const effectiveCounter = counter - offset;

      // 到达触发时间
      if (effectiveCounter > 0 && effectiveCounter % periodic.intervalTicks === 0) {
        // 合并效果
        this.mergeModuleEffects(mergedEffects, periodic.effects);

        // 记录日志
        effectLog.push(...this.createEffectLogEntries(
          currentTick, 'periodic', periodic.id, periodic.effects, `周期事件: ${periodic.name}`
        ));
      }
    }

    // 2. 事件效果匹配（使用索引优化）
    const activeEvents = Object.values(this.state.events)
      .filter(e => e.status === 'active' || e.status === 'brewing');

    // 如果规则变化，重建索引
    const rulesHash = rules.eventEffects.length;
    if (rulesHash !== this._rulesVersion) {
      this.buildRuleIndex(rules);
      this._rulesVersion = rulesHash;
    }

    // 使用索引匹配
    const matchedEffectIds = new Set<string>();

    for (const event of activeEvents) {
      const eventText = `${event.title} ${event.description}`.toLowerCase();

      // 按 keyword 匹配（使用索引）
      for (const [keyword, effects] of this._keywordRuleIndex.entries()) {
        if (eventText.includes(keyword)) {
          for (const effect of effects) {
            if (!matchedEffectIds.has(effect.id)) {
              matchedEffectIds.add(effect.id);

              // 检查其他条件（eventLevel, severityMin）
              if (this.matchEventEffect(event, effect)) {
                this.mergeModuleEffects(mergedEffects, effect.effects);
                effectLog.push(...this.createEffectLogEntries(
                  currentTick, 'rule', effect.id, effect.effects, `事件触发: ${event.title}`
                ));
              }
            }
          }
        }
      }
    }

    return { effects: mergedEffects, log: effectLog };
  }

  /**
   * 匹配事件与事件效果
   */
  private matchEventEffect(
    event: SimEvent,
    effect: { trigger: { tags?: string[]; eventType?: string; eventLevel?: string; severityMin?: number; keywords?: string[] } },
  ): boolean {
    const trigger = effect.trigger;

    // 优先匹配 tag（如果事件有 tag）
    if (trigger.tags && trigger.tags.length > 0) {
      // 事件的 tag 可以从 description/title 中提取，或者事件本身有 tag 字段
      // 这里暂时用 keyword 兜底
    }

    // 匹配 eventType
    if (trigger.eventType && event.batchId !== trigger.eventType) {
      return false;
    }

    // 匹配 eventLevel
    if (trigger.eventLevel && event.level !== trigger.eventLevel) {
      return false;
    }

    // 匹配 severityMin
    if (trigger.severityMin && event.severity < trigger.severityMin) {
      return false;
    }

    // 匹配 keywords（可选过滤条件）
    if (trigger.keywords && trigger.keywords.length > 0) {
      const text = `${event.title} ${event.description}`.toLowerCase();
      if (!trigger.keywords.some(kw => text.includes(kw.toLowerCase()))) {
        return false;
      }
    }

    // 所有条件都通过（或无额外条件），视为匹配
    return true;
  }

  /**
   * 合并模块效果（add 策略）
   */
  private mergeModuleEffects(target: ModuleEffects, source: ModuleEffects): void {
    // 合并 survival
    if (source.survival?.resources) {
      if (!target.survival) target.survival = { resources: {} };
      if (!target.survival.resources) target.survival.resources = {};
      for (const [id, change] of Object.entries(source.survival.resources)) {
        if (!target.survival.resources[id]) {
          target.survival.resources[id] = { ...change };
        } else {
          const existing = target.survival.resources[id];
          if (change.delta !== undefined) {
            existing.delta = (existing.delta ?? 0) + change.delta;
          }
          if (change.set !== undefined) {
            existing.set = change.set;
          }
        }
      }
    }

    // 合并 business
    if (source.business) {
      if (!target.business) target.business = {};
      if (source.business.fundsDelta !== undefined) {
        target.business.fundsDelta = (target.business.fundsDelta ?? 0) + source.business.fundsDelta;
      }
    }

    // 合并 stats
    if (source.stats?.changes) {
      if (!target.stats) target.stats = { changes: {} };
      if (!target.stats.changes) target.stats.changes = {};
      for (const [id, change] of Object.entries(source.stats.changes)) {
        if (!target.stats.changes[id]) {
          target.stats.changes[id] = { ...change };
        } else {
          const existing = target.stats.changes[id];
          if (change.delta !== undefined) {
            existing.delta = (existing.delta ?? 0) + change.delta;
          }
          if (change.set !== undefined) {
            existing.set = change.set;
          }
        }
      }
    }

    // 合并 progression
    if (source.progression) {
      if (!target.progression) target.progression = {};
      if (source.progression.xpDelta !== undefined) {
        target.progression.xpDelta = (target.progression.xpDelta ?? 0) + source.progression.xpDelta;
      }
      if (source.progression.tierIndex !== undefined) {
        target.progression.tierIndex = source.progression.tierIndex;
      }
    }
  }

  /**
   * 创建效果日志条目
   */
  private createEffectLogEntries(
    tick: number,
    source: 'rule' | 'periodic' | 'ai' | 'npc',
    ruleId: string,
    effects: ModuleEffects,
    reason: string,
  ): EffectLogEntry[] {
    const entries: EffectLogEntry[] = [];

    // survival
    if (effects.survival?.resources) {
      for (const [id, change] of Object.entries(effects.survival.resources)) {
        entries.push({
          tick, source, ruleId,
          module: 'survival',
          variable: id,
          before: 0, // 实际值需要在应用时填充
          after: change.delta ?? change.set ?? 0,
          reason,
        });
      }
    }

    // business
    if (effects.business?.fundsDelta) {
      entries.push({
        tick, source, ruleId,
        module: 'business',
        variable: 'funds',
        before: 0,
        after: effects.business.fundsDelta,
        reason,
      });
    }

    // stats
    if (effects.stats?.changes) {
      for (const [id, change] of Object.entries(effects.stats.changes)) {
        entries.push({
          tick, source, ruleId,
          module: 'stats',
          variable: id,
          before: 0,
          after: change.delta ?? change.set ?? 0,
          reason,
        });
      }
    }

    // progression
    if (effects.progression) {
      if (effects.progression.xpDelta) {
        entries.push({
          tick, source, ruleId,
          module: 'progression',
          variable: 'xp',
          before: 0,
          after: effects.progression.xpDelta,
          reason,
        });
      }
    }

    return entries;
  }

  // ─── 快照系统 ───

  /**
   * 创建当前状态的快照
   * @param msgIndex 关联的消息索引（与变量快照对齐）
   * @param gameTime 当前游戏时间文本
   * @param isInitial 是否为初始快照
   * @param note 可选备注
   */
  createSnapshot(
    msgIndex: number,
    gameTime: string,
    isInitial: boolean = false,
    note?: string,
  ): SimulationSnapshot {
    // 瘦身快照数据，防止序列化过大
    const slimState = this._slimForSnapshot(this.state);

    const snapshot: SimulationSnapshot = {
      id: `sim_snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      msgIndex,
      tickCount: this.state.tickCount,
      gameTime,
      activeEventCount: Object.keys(this.state.events).length,
      storylineCount: Object.keys(this.state.storylines).length,
      pendingInteractionCount: this.state.pendingInteractions.length,
      snapshot: JSON.parse(JSON.stringify(slimState)),
      isInitial,
      note,
    };

    // 添加到快照列表
    if (!this.state.snapshots) {
      this.state.snapshots = [];
    }
    this.state.snapshots.push(snapshot);

    // 最多保留 20 个快照
    const MAX_SNAPSHOTS = 20;
    if (this.state.snapshots.length > MAX_SNAPSHOTS) {
      this.state.snapshots = this.state.snapshots.slice(-MAX_SNAPSHOTS);
    }

    this.saveState();
    return snapshot;
  }

  /**
   * 从快照恢复状态
   * @param snapshotId 快照 ID
   * @returns 是否恢复成功
   */
  restoreSnapshot(snapshotId: string): boolean {
    if (!this.state.snapshots) return false;

    const snapshot = this.state.snapshots.find(s => s.id === snapshotId);
    if (!snapshot?.snapshot) return false;

    // 恢复状态，但保留快照列表本身（快照内不嵌套旧快照，所以恢复时需保留当前列表）
    const currentSnapshots = this.state.snapshots;
    this.state = JSON.parse(JSON.stringify(snapshot.snapshot));
    // 快照瘦身时 snapshots 被清空，恢复时始终用当前列表
    this.state.snapshots = currentSnapshots;

    this.saveState();

    // 通知 UI
    if (this.onStateChange) {
      try { this.onStateChange(this.state); } catch { /* ignore */ }
    }

    return true;
  }

  /**
   * 删除指定快照
   * @param snapshotId 快照 ID
   */
  deleteSnapshot(snapshotId: string) {
    if (!this.state.snapshots) return;
    this.state.snapshots = this.state.snapshots.filter(s => s.id !== snapshotId);
    this.saveState();
  }

  /**
   * 获取所有快照列表
   */
  getSnapshots(): SimulationSnapshot[] {
    return this.state.snapshots ?? [];
  }

  /**
   * 清除所有快照
   */
  clearAllSnapshots() {
    this.state.snapshots = [];
    this.saveState();
  }

  /**
   * 瘦身 state 用于快照：截断长文本、精简大型数组
   * 参考 VariableManager._slimForSnapshot 的设计理念
   */
  private _slimForSnapshot(state: SimulationState): SimulationState {
    const s = { ...state };

    // 关键：快照内不嵌套旧快照，否则指数膨胀（每个快照包含所有旧快照）
    s.snapshots = [];

    // 精简事件描述（截断过长的描述）
    const slimEvents: Record<string, SimEvent> = {};
    for (const [id, evt] of Object.entries(s.events)) {
      slimEvents[id] = {
        ...evt,
        description: evt.description.length > 500
          ? evt.description.slice(0, 500) + '…'
          : evt.description,
        // 精简 playerHooks 的 description
        playerHooks: evt.playerHooks.map(h => ({
          ...h,
          description: h.description.length > 200
            ? h.description.slice(0, 200) + '…'
            : h.description,
        })),
      };
    }
    s.events = slimEvents;

    // 精简已解决事件（只保留基本信息）
    const slimResolved: Record<string, SimEvent> = {};
    for (const [id, evt] of Object.entries(s.resolvedEvents)) {
      slimResolved[id] = {
        ...evt,
        description: evt.description.length > 200
          ? evt.description.slice(0, 200) + '…'
          : evt.description,
        playerHooks: [], // 已解决事件不需要保留切入点
      };
    }
    s.resolvedEvents = slimResolved;

    // 精简暗线节拍（只保留最近 10 个）
    const slimStorylines: Record<string, CharacterStoryline> = {};
    for (const [id, storyline] of Object.entries(s.storylines)) {
      slimStorylines[id] = {
        ...storyline,
        beats: storyline.beats.slice(-10).map(b => ({
          ...b,
          narrative: b.narrative.length > 300
            ? b.narrative.slice(0, 300) + '…'
            : b.narrative,
        })),
      };
    }
    s.storylines = slimStorylines;

    // 精简待处理交互（只保留最近 5 个）
    s.pendingInteractions = s.pendingInteractions.slice(0, 5).map(i => ({
      ...i,
      reply: i.reply.length > 200 ? i.reply.slice(0, 200) + '…' : i.reply,
      innerThoughts: i.innerThoughts.length > 200
        ? i.innerThoughts.slice(0, 200) + '…'
        : i.innerThoughts,
    }));

    // 截断世界新闻摘要
    if (s.worldNewsSummary && s.worldNewsSummary.length > 500) {
      s.worldNewsSummary = s.worldNewsSummary.slice(0, 500) + '…';
    }

    return s;
  }

  /** 重置引擎 */
  reset() {
    this.state = createEmptySimState();
    this.saveState();
  }
}
