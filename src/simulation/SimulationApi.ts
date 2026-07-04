/**
 * 后台世界推演 — 模块级单例 API
 *
 * 参考记忆系统（memoryManager）的模式：
 *   - 引擎实例与 React 组件生命周期解耦
 *   - 存档/读档时状态稳定
 *   - GameScreen 挂载/卸载不影响推演进度
 *
 * 使用方式：
 *   import { getSimulationEngine } from '../simulation/SimulationApi';
 *   const engine = getSimulationEngine();
 *   engine.setWorldContext(worldCtx);
 *   await engine.tick(gameState, gameTime, round);
 */

import { WorldSimulationEngine } from './engine';
import type { SimWorldContext, SimulationState } from './types';
import type { ApiConfig } from '../api/types';
import { createEmptySimState } from './types';
import { useSimulationStore } from '../stores/simulationStore';

// ─── 模块级单例 ───

let _engine: WorldSimulationEngine | null = null;
let _worldContext: SimWorldContext | null = null;

/** 同步引擎状态到 Zustand UI store */
function syncEngineToStore(engine: WorldSimulationEngine) {
  useSimulationStore.getState().syncFromEngine(engine.state);
}

/**
 * 获取推演引擎单例
 * 首次调用时从 localStorage 恢复状态，后续调用返回同一实例
 */
export function getSimulationEngine(): WorldSimulationEngine {
  if (!_engine) {
    _engine = new WorldSimulationEngine(WorldSimulationEngine.loadState());
    _engine.onStateChange = () => syncEngineToStore(_engine!);
  }
  return _engine;
}

/**
 * 重置引擎（切换世界时调用）
 * 清除所有推演状态并重新初始化
 */
export function resetSimulationEngine(): WorldSimulationEngine {
  _engine = new WorldSimulationEngine(createEmptySimState());
  _engine.onStateChange = () => syncEngineToStore(_engine!);
  _engine.saveState();
  _worldContext = null;
  return _engine;
}

/**
 * 设置当前世界的语义上下文
 * 引擎在 tick() 时会使用此上下文生成自适应层级标签
 */
export function setWorldContext(ctx: SimWorldContext | null): void {
  _worldContext = ctx;
  if (_engine && ctx) {
    _engine.setWorldContext(ctx);
  }
}

/**
 * 获取当前世界的语义上下文
 */
export function getWorldContext(): SimWorldContext | null {
  return _worldContext;
}

/**
 * 从存档恢复引擎状态
 */
export function restoreEngineState(state: SimulationState): void {
  const engine = getSimulationEngine();
  engine.replaceState(state);
  // 同步到 Zustand UI store
  syncEngineToStore(engine);
}

/**
 * 获取当前引擎状态的快照（用于存档）
 */
export function getEngineState(): SimulationState {
  return getSimulationEngine().state;
}

/**
 * 强制持久化当前状态
 */
export function saveEngineState(): void {
  if (_engine) {
    _engine.saveState();
  }
}

/**
 * 设置推演专用 API 配置（完整独立，不继承主 API）
 * 传入 null 则完全回退到主 API 配置
 */
export function setSimApiOverride(override: ApiConfig | null): void {
  const engine = getSimulationEngine();
  engine.setSimApiOverride(override);
}
