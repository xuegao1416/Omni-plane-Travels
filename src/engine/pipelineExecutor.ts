// 管线执行器 - 按 executionOrder 顺序/并行执行各模块
import type { PipelineConfig, PipelineTaskId, PipelineStageResult, PipelineStatus } from './pipelineTypes';
import { createPipelineStatus, STAGE_LABELS } from './pipelineTypes';
import type { VariableManager } from './variableManager';
import type { WorldBookManager } from '../worldbook/index';
import type { ParsedResponse } from './responseExtractor';
import type { ApiConfig } from '../api/types';
import { runVariableExtraction } from './variableExtraction';
import { eventBus, EVENTS } from './eventBus';
import { waitForRateLimit } from '../api/rateLimiter';

/** 管线执行回调 */
export interface PipelineCallbacks {
  onUpdate: () => void;
}

/** 纯本地操作的阶段 ID（不调用 API，无需限流等待） */
const LOCAL_ONLY_STAGES = new Set(['memory_retrieve_finalize', 'memory_compile']);

/** 可重试的阶段（需要调用 API 的阶段，本地阶段无需重试） */
export const RETRYABLE_STAGES = new Set<PipelineTaskId>([
  'main', 'memory_write', 'memory_summary', 'memory_vector',
  'memory_query_rewrite', 'memory_retrieve_plan', 'memory_multi_round',
  'memory_rerank', 'variable',
]);

/** 管线执行结果 */
export interface PipelineResult {
  mainResult: {
    text: string;
    parsed: ParsedResponse;
  } | null;
  status: PipelineStatus;
}

/** 记忆系统任务集合（由外部注入） */
export interface MemoryTasks {
  /** 叙事记忆写入 */
  write?: () => Promise<void>;
  /** 摘要保存 */
  summary?: () => Promise<void>;
  /** 查询改写 */
  queryRewrite?: () => Promise<void>;
  /** 检索规划 */
  retrievePlan?: () => Promise<void>;
  /** 多轮补充 */
  multiRound?: () => Promise<void>;
  /** 精排 */
  rerank?: () => Promise<void>;
  /** 检索收尾 */
  retrieveFinalize?: () => Promise<void>;
  /** 上下文编译 */
  compile?: () => Promise<void>;
  /** 向量事实提取 */
  vector?: () => Promise<void>;
  /** 调试日志记录器 */
  debugLogger?: (kind: string, message: string) => void;
}

export class PipelineExecutor {
  private status: PipelineStatus;
  private onUpdate: () => void;

  constructor(round: number, callbacks: PipelineCallbacks) {
    this.status = createPipelineStatus(round);
    this.onUpdate = callbacks.onUpdate;
  }

  getStatus(): PipelineStatus {
    return this.status;
  }

  private updateStage(taskId: PipelineTaskId, updates: Partial<PipelineStageResult>) {
    this.status.stages[taskId] = { ...this.status.stages[taskId], ...updates };
    this.onUpdate();
  }

  /**
   * 执行管线主流程
   * 遵循 executionOrder：同层并行，层间串行
   */
  async execute(params: {
    config: PipelineConfig;
    mainTask: () => Promise<{ text: string; parsed: ParsedResponse }>;
    varMgr: VariableManager;
    worldBook: WorldBookManager | null;
    userText: string;
    mainApiConfig: ApiConfig;
    signal: AbortSignal;
    /** 记忆系统任务集（可选，由外部注入） */
    memoryTasks?: MemoryTasks;
  }): Promise<PipelineResult> {
    const { config, mainTask, varMgr, worldBook, userText, mainApiConfig, signal, memoryTasks } = params;
    let mainResult: { text: string; parsed: ParsedResponse } | null = null;

    for (const step of config.executionOrder) {
      if (signal.aborted) {
        this.skipRemaining();
        break;
      }

      const hasMain = step.includes('main');
      const otherTasks = step.filter(t => t !== 'main');

      // 正文生成不限流（第一次调用）
      // 纯本地操作（finalize/compile）也不限流，因为不调 API
      const hasApiTask = step.some(t => !LOCAL_ONLY_STAGES.has(t));
      if (!hasMain && hasApiTask) {
        await waitForRateLimit();
      }

      if (hasMain) {
        mainResult = await this.executeMain(mainTask);
        if (otherTasks.length > 0 && !signal.aborted) {
          await waitForRateLimit();
          await Promise.all(otherTasks.map(taskId =>
            this.executeTask(taskId, config, mainResult!, varMgr, worldBook, userText, mainApiConfig, signal, memoryTasks)
          ));
        }
      } else {
        // 整层并行
        await Promise.all(step.map(taskId =>
          this.executeTask(taskId, config, mainResult, varMgr, worldBook, userText, mainApiConfig, signal, memoryTasks)
        ));
      }
    }

    this.status.endTime = Date.now();
    this.onUpdate();
    return { mainResult, status: this.status };
  }

  /** 执行正文生成任务 */
  private async executeMain(
    mainTask: () => Promise<{ text: string; parsed: ParsedResponse }>
  ): Promise<{ text: string; parsed: ParsedResponse }> {
    this.updateStage('main', { status: 'running', startTime: Date.now() });

    try {
      const result = await mainTask();
      this.updateStage('main', {
        status: 'success',
        endTime: Date.now(),
        dataLength: result.text.length,
        attempts: 1,
      });
      return result;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '正文生成失败';
      this.updateStage('main', {
        status: 'error',
        endTime: Date.now(),
        error: errMsg,
      });
      throw err;
    }
  }

  /** 执行单个任务的路由 */
  private async executeTask(
    taskId: PipelineTaskId,
    config: PipelineConfig,
    mainResult: { text: string; parsed: ParsedResponse } | null,
    varMgr: VariableManager,
    worldBook: WorldBookManager | null,
    userText: string,
    mainApiConfig: ApiConfig,
    signal: AbortSignal,
    memoryTasks?: MemoryTasks,
  ): Promise<void> {
    switch (taskId) {
      case 'variable':
        return this.executeVariable(config, varMgr, mainResult, userText, mainApiConfig, worldBook);
      case 'memory_write':
        return this.executeMemoryTask('memory_write', config.memoryEnabled, memoryTasks?.write, memoryTasks?.debugLogger);
      case 'memory_summary':
        return this.executeMemoryTask('memory_summary', config.memoryEnabled, memoryTasks?.summary, memoryTasks?.debugLogger);
      case 'memory_query_rewrite':
        return this.executeMemoryTask('memory_query_rewrite', config.memoryEnabled, memoryTasks?.queryRewrite, memoryTasks?.debugLogger);
      case 'memory_retrieve_plan':
        return this.executeMemoryTask('memory_retrieve_plan', config.memoryEnabled, memoryTasks?.retrievePlan, memoryTasks?.debugLogger);
      case 'memory_multi_round':
        return this.executeMemoryTask('memory_multi_round', config.memoryEnabled, memoryTasks?.multiRound, memoryTasks?.debugLogger);
      case 'memory_rerank':
        return this.executeMemoryTask('memory_rerank', config.memoryEnabled, memoryTasks?.rerank, memoryTasks?.debugLogger);
      case 'memory_retrieve_finalize':
        return this.executeMemoryTask('memory_retrieve_finalize', config.memoryEnabled, memoryTasks?.retrieveFinalize, memoryTasks?.debugLogger);
      case 'memory_compile':
        return this.executeMemoryTask('memory_compile', config.memoryEnabled, memoryTasks?.compile, memoryTasks?.debugLogger);
      case 'memory_vector':
        return this.executeMemoryTask('memory_vector', config.memoryEnabled, memoryTasks?.vector, memoryTasks?.debugLogger);
      default:
        this.updateStage(taskId, { status: 'skipped', skipped: true });
    }
  }

  /** 执行记忆系统子任务（通用） */
  private async executeMemoryTask(
    taskId: PipelineTaskId,
    enabled: boolean,
    task?: () => Promise<void>,
    debugLogger?: (kind: string, message: string) => void,
  ): Promise<void> {
    if (!enabled || !task) {
      this.updateStage(taskId, { status: 'skipped', skipped: true });
      return;
    }

    this.updateStage(taskId, { status: 'running', startTime: Date.now() });

    try {
      await task();
      this.updateStage(taskId, {
        status: 'success',
        endTime: Date.now(),
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : `${STAGE_LABELS[taskId]}失败`;
      const isDegraded = errMsg.startsWith('[降级]');
      this.updateStage(taskId, {
        status: isDegraded ? 'warning' : 'error',
        endTime: Date.now(),
        error: errMsg,
      });
      // 写入调试日志（UI 可见）
      debugLogger?.(taskId, errMsg);
      console.warn(`[管线] ${STAGE_LABELS[taskId]}${isDegraded ? '降级' : '失败'}:`, errMsg);
    }
  }

  /** 执行变量提取任务 */
  private async executeVariable(
    config: PipelineConfig,
    varMgr: VariableManager,
    mainResult: { text: string; parsed: ParsedResponse } | null,
    userText: string,
    mainApiConfig: ApiConfig,
    worldBook: WorldBookManager | null,
  ): Promise<void> {
    if (!config.variableEnabled || !mainResult) {
      this.updateStage('variable', { status: 'skipped', skipped: true });
      return;
    }

    const maxAttempts = config.variableMaxRetries + 1;
    this.updateStage('variable', { status: 'running', startTime: Date.now(), maxAttempts });

    try {
      await runVariableExtraction({
        varMgr,
        parsed: mainResult.parsed,
        round: this.status.round,
        userText,
        mainApiConfig,
        worldBook,
        delayMs: config.variableDelayMs,
        maxRetries: config.variableMaxRetries,
      });

      this.updateStage('variable', {
        status: 'success',
        endTime: Date.now(),
        attempts: 1,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '变量提取失败';
      this.updateStage('variable', {
        status: 'error',
        endTime: Date.now(),
        error: errMsg,
        attempts: maxAttempts,
      });
      console.warn('[管线] 变量提取失败:', errMsg);
      // 重新抛出：变量提取是管线最后一步，失败时不应保存未更新变量的快照
      // sendMessage 的 catch 会处理此错误，在消息上追加错误提示
      throw err;
    }
  }

  /**
   * 重试单个阶段
   * 将该阶段重置为 running 状态，执行 taskFn，更新最终状态
   */
  async retryStage(taskId: PipelineTaskId, taskFn: () => Promise<void>): Promise<void> {
    this.updateStage(taskId, {
      status: 'running', startTime: Date.now(),
      endTime: undefined, error: undefined, skipped: false,
    });
    try {
      await taskFn();
      this.updateStage(taskId, { status: 'success', endTime: Date.now() });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : `${STAGE_LABELS[taskId]}失败`;
      const isDegraded = errMsg.startsWith('[降级]');
      this.updateStage(taskId, {
        status: isDegraded ? 'warning' : 'error', endTime: Date.now(),
        error: errMsg,
      });
    }
  }

  /** 跳过所有剩余 pending 阶段 */
  private skipRemaining() {
    for (const [key, stage] of Object.entries(this.status.stages)) {
      if (stage.status === 'pending') {
        this.updateStage(key as PipelineTaskId, { status: 'skipped', skipped: true });
      }
    }
  }
}
