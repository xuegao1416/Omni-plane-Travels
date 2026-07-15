// ============================================================
//  Mod 世界演化集成（F）
//  把 ruleEngine.evaluate 挂到世界演化 tick 循环末尾（每 tick 调一次）。
//  XState actor 常驻；增删规则不重建状态机（热启用）。
// ============================================================
import type {
  EventRule,
  Permission,
  EventRuntimeState,
  WorldContext,
  Literal,
  PeriodicRule,
} from './schema';
import { evaluate, type EvaluateResult, type EvaluateLimits } from './ruleEngine';

export interface RegisteredEventRules {
  eventPackId: string;
  rules: EventRule[];
  /** 周期规则（从世界 periodicEvents 搬入的周期卡子类）；可选，普通 mod 无此字段 */
  periodicRules?: PeriodicRule[];
  permissions: Permission[];
  runtime: EventRuntimeState;
  /** 显示名（世界内置包取自 worldDef.eventPacks[].name） */
  displayName?: string;
  /** 来源：world=世界内置（随世界加载、不可卸载）；mod=用户安装的 mod */
  source?: 'world' | 'mod';
}

export interface TickEvaluation {
  ctx: WorldContext;
  results: EvaluateResult[];
  warnings: string[];
}

/**
 * Mod 世界演化管理器：内存注册表 + 每 tick 确定性求值。
 * 不持有世界状态本身，只读写内核注入的 context 片段。
 */
export class EventWorldEvolution {
  private mods = new Map<string, RegisteredEventRules>();
  private limits?: Partial<EvaluateLimits>;

  register(mod: RegisteredEventRules): void {
    this.mods.set(mod.eventPackId, { ...mod, periodicRules: mod.periodicRules ?? [] });
  }

  unregister(eventPackId: string): void {
    this.mods.delete(eventPackId);
  }

  clear(): void {
    this.mods.clear();
  }

  list(): RegisteredEventRules[] {
    return [...this.mods.values()];
  }

  has(eventPackId: string): boolean {
    return this.mods.has(eventPackId);
  }

  /** 收集所有已注册包中的周期规则（供引擎机械层按 tick 静默结算，无 UI） */
  getPeriodicRules(): PeriodicRule[] {
    const out: PeriodicRule[] = [];
    for (const mod of this.mods.values()) {
      for (const pr of mod.periodicRules ?? []) out.push(pr);
    }
    return out;
  }

  setLimits(limits: Partial<EvaluateLimits>): void {
    this.limits = limits;
  }

  /**
   * 每 tick 求值所有启用 mod 的规则（热启用：增删不重建状态机）。
   * 任一 mod 求值异常被隔离，不拖垮内核。
   */
  evaluateTick(
    ctx: WorldContext,
    tick: number,
    events: Array<{ type: string; where?: Record<string, Literal> }> = [],
  ): TickEvaluation {
    let current: WorldContext = ctx;
    const results: EvaluateResult[] = [];
    const warnings: string[] = [];

    for (const mod of this.mods.values()) {
      try {
        const r = evaluate(current, mod.rules, {
          permissions: mod.permissions,
          runtime: mod.runtime,
          tick,
          limits: this.limits,
          events,
        });
        r.eventPackId = mod.eventPackId;
        current = r.ctx;
        results.push(r);
        for (const w of r.warnings) warnings.push(`[${mod.eventPackId}] ${w}`);
      } catch (e) {
        warnings.push(
          `[${mod.eventPackId}] 求值异常已隔离: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return { ctx: current, results, warnings };
  }
}

/** 单次 tick 求值后，从所有 mod 的 applied 动作中收集 addCard 事件。
 *  纯函数（便于单测），返回可广播的 { cardId, eventPackId } 列表。 */
export interface AddCardEvent {
  cardId: string;
  eventPackId: string;
}
export function collectAddCardEvents(results: EvaluateResult[]): AddCardEvent[] {
  const out: AddCardEvent[] = [];
  for (const r of results) {
    for (const a of r.applied) {
      if (a.kind === 'addCard') {
        const detail = a.detail as { cardId?: string } | undefined;
        if (detail?.cardId) {
          out.push({ cardId: detail.cardId, eventPackId: r.eventPackId ?? '' });
        }
      }
    }
  }
  return out;
}

/** 全局单例（内核与 UI 共享同一注册表） */
export const eventWorldEvolution = new EventWorldEvolution();

/** 供世界演化内核在机械层读取所有周期规则 */
export function getPeriodicRules(): PeriodicRule[] {
  return eventWorldEvolution.getPeriodicRules();
}

/**
 * 供 world evolution kernel 在 tick 末尾调用：
 * 注入当前 gameState（作为 WorldContext），返回应用 Mod 规则后的新 context 片段。
 */
export function runEventRulesOnTick(
  gameState: WorldContext,
  tick: number,
  events: Array<{ type: string; where?: Record<string, Literal> }> = [],
): WorldContext {
  const { ctx } = eventWorldEvolution.evaluateTick(gameState, tick, events);
  return ctx;
}
