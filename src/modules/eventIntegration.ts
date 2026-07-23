// ============================================================
//  事件包世界演化集成
//  把 ruleEngine.evaluate 挂到世界演化 tick 循环末尾（每 tick 调一次）。
//  增删规则不重建状态机（热启用）。
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
import type { WorkflowDefinition } from './workflowSchema';
import { executeWorkflowAsEvaluation } from './workflowBridge';

export interface RegisteredEventRules {
  eventPackId: string;
  rules: EventRule[];
  /** 周期规则（可选，普通事件包无此字段） */
  periodicRules?: PeriodicRule[];
  permissions: Permission[];
  runtime: EventRuntimeState;
  /** 显示名（世界内置包取自 worldDef.eventPacks[].name） */
  displayName?: string;
  /** 来源：world=世界内置（随世界加载、不可卸载）；user=用户安装的包 */
  source?: 'world' | 'user';
  /** 工作流定义（可选，有此字段时用工作流引擎替代规则引擎） */
  workflow?: WorkflowDefinition;
}

export interface TickEvaluation {
  ctx: WorldContext;
  results: EvaluateResult[];
  warnings: string[];
  /** 各包的 onceFired / cooldown 持久化快照（供引擎写入 simulationRuntime） */
  packRuntimes?: Record<string, EventRuntimeState>;
}

/**
 * 事件包世界演化管理器：内存注册表 + 每 tick 确定性求值。
 * 不持有世界状态本身，只读写内核注入的 context 片段。
 */
export class EventWorldEvolution {
  private packs = new Map<string, RegisteredEventRules>();
  private limits?: Partial<EvaluateLimits>;

  registerPack(pack: RegisteredEventRules): void {
    this.packs.set(pack.eventPackId, {
      ...pack,
      periodicRules: pack.periodicRules ?? [],
      workflow: pack.workflow,
    });
  }

  unregisterPack(packId: string): void {
    this.packs.delete(packId);
  }

  clear(): void {
    this.packs.clear();
  }

  list(): RegisteredEventRules[] {
    return [...this.packs.values()];
  }

  has(packId: string): boolean {
    return this.packs.has(packId);
  }

  /** 收集所有已注册包中的周期规则（供引擎机械层按 tick 静默结算，无 UI） */
  getPeriodicRules(): PeriodicRule[] {
    const out: PeriodicRule[] = [];
    for (const pack of this.packs.values()) {
      for (const pr of pack.periodicRules ?? []) out.push(pr);
    }
    return out;
  }

  setLimits(limits: Partial<EvaluateLimits>): void {
    this.limits = limits;
  }

  /**
   * 每 tick 求值所有启用包的规则（热启用：增删不重建状态机）。
   * 任一包求值异常被隔离，不拖垮内核。
   */
  evaluateTick(
    ctx: WorldContext,
    tick: number,
    events: Array<{ type: string; where?: Record<string, Literal> }> = [],
  ): TickEvaluation {
    let current: WorldContext = ctx;
    const results: EvaluateResult[] = [];
    const warnings: string[] = [];

    for (const pack of this.packs.values()) {
      try {
        let r: EvaluateResult;

        if (pack.workflow) {
          // 工作流模式：用工作流引擎执行
          r = executeWorkflowAsEvaluation(
            pack.workflow,
            current,
            tick,
            events,
            pack.runtime,
            pack.eventPackId,
            pack.permissions,
          );
        } else {
          // 传统模式：用规则引擎执行
          r = evaluate(current, pack.rules, {
            permissions: pack.permissions,
            runtime: pack.runtime,
            tick,
            limits: this.limits,
            events,
          });
        }

        r.eventPackId = pack.eventPackId;
        current = r.ctx;
        results.push(r);
        for (const w of r.warnings) warnings.push(`[${pack.eventPackId}] ${w}`);
      } catch (e) {
        warnings.push(
          `[${pack.eventPackId}] 求值异常已隔离: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // 收集各包的 runtime 快照（onceFired / cooldown 状态），供持久化
    const packRuntimes: Record<string, EventRuntimeState> = {};
    for (const pack of this.packs.values()) {
      packRuntimes[pack.eventPackId] = {
        onceFired: { ...pack.runtime.onceFired },
        cooldownRemaining: { ...pack.runtime.cooldownRemaining },
      };
    }

    return { ctx: current, results, warnings, packRuntimes };
  }
}

/** 从所有包的 applied 动作中收集 addEvent 事件。
 *  返回 { eventId, eventPackId } 列表，由调用方查 eventPack 获取全部卡片后逐张广播。 */
export interface AddEventAction {
  eventId: string;
  eventPackId: string;
}
export function collectAddEventEvents(results: EvaluateResult[]): AddEventAction[] {
  const out: AddEventAction[] = [];
  for (const r of results) {
    for (const a of r.applied) {
      if (a.kind === 'addEvent') {
        const detail = a.detail as { eventId?: string; eventPackId?: string } | undefined;
        if (detail?.eventId) {
          // 优先用动作自带的 eventPackId（跨包引用），否则回退到产生该动作的包
          out.push({ eventId: detail.eventId, eventPackId: detail.eventPackId || r.eventPackId || '' });
        }
      }
    }
  }
  return out;
}

/** 从所有包的 EvaluateResult 中收集 scheduleTick 产出的延迟条目。 */
export function collectScheduledTickEntries(results: EvaluateResult[]): Array<{ scheduledAt: number; ruleId: string; payload?: Record<string, unknown> }> {
  const out: Array<{ scheduledAt: number; ruleId: string; payload?: Record<string, unknown> }> = [];
  for (const r of results) {
    if (r.scheduledTickEntries) out.push(...r.scheduledTickEntries);
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
 * 注入当前 gameState（作为 WorldContext），返回应用事件包规则后的新 context 片段。
 */
export function runEventRulesOnTick(
  gameState: WorldContext,
  tick: number,
  events: Array<{ type: string; where?: Record<string, Literal> }> = [],
): WorldContext {
  const { ctx } = eventWorldEvolution.evaluateTick(gameState, tick, events);
  return ctx;
}
