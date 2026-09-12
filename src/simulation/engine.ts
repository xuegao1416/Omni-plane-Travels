/** 剧情导演存档宿主。规则结算由 gameplay 持有，导演决策由 director/review 协调。 */
import type { SimEvent, SimConfig, SimulationState, CharacterStoryline, PlayerHook, NpcProactiveInteraction, SimWorldContext, SimulationSnapshot } from './types';
import { createEmptySimState, createDefaultWorldContext } from './types';
import type { ApiConfig } from '../api/types';
import { SIM_STORAGE_KEY } from './storage';
import { migrateLegacySimulationToDirector } from '../director/runtime';

/** 规范化 activePresetId：过滤空/垃圾值，回退到 'default' */
function sanitizeActivePresetId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw === 'null' || raw === 'undefined' || raw === 'default') {
    return 'default';
  }
  return raw;
}


// ─── 引擎类 ───

import { MechanicalRuntime } from '../gameplay/mechanicalRuntime';
export { emitCanonicalEventCard } from '../gameplay/mechanicalRuntime';

export class DirectorRuntime extends MechanicalRuntime {
  private apiConfig: ApiConfig | null = null;
  /** 推演专用 API 配置（完整独立，不继承主 API 的任何字段），未设置则回退主 API */
  private simApiOverride: ApiConfig | null = null;
  /** 当前世界的语义上下文（含自适应层级标签） */
  private _worldContext: SimWorldContext | null = null;
  /** 状态变更回调（供 UI store 同步用） */
  onStateChange: ((state: SimulationState) => void) | null = null;

  constructor(state?: SimulationState) {
    super(state ?? createEmptySimState());
    migrateLegacySimulationToDirector(this.state);
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
      .filter(b => !b.merged && b.factStatus === 'confirmed')
      .slice(-3);

    if (recentBeats.length === 0) return null;

    const lines = ['【暗线推进 — 镜头外事实，不代表玩家已知；须通过正文中的观察或交流才可获知】'];
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
    const activeEvents = Object.values(this.state.events).filter(
      e => e.factStatus === 'confirmed' && (e.status === 'active' || e.status === 'brewing'),
    );
    if (activeEvents.length === 0) return '';

    const lines = ['【世界动态 — 镜头外事实，不代表玩家已知】'];
    for (const evt of activeEvents.slice(0, 5)) {
      const labels = this._worldContext?.levelLabels ?? createDefaultWorldContext('', '').levelLabels;
      const levelTag = labels[evt.level] ?? evt.level;
      lines.push(`[${levelTag}] ${evt.title}：${evt.description}`);
      if (evt.playerHooks.length > 0) {
        for (const hook of evt.playerHooks.slice(0, 2)) {
          lines.push(`  ↳ 尚未发生的候选切入点：${hook.title}`);
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
        parsed.config.activePresetId = sanitizeActivePresetId(parsed.config.activePresetId);
        migrateLegacySimulationToDirector(parsed);
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
    migrateLegacySimulationToDirector(this.state);
    this.saveState();
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
    migrateLegacySimulationToDirector(this.state);
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

/** Legacy import compatibility; no independent simulation pipeline remains. */
export { DirectorRuntime as WorldSimulationEngine };
