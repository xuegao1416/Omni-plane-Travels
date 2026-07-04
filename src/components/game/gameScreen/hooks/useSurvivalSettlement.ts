/**
 * 生存资源自动结算引擎
 *
 * 对标 useBusinessSettlement，每轮 VARIABLE_UPDATE_ENDED 后触发：
 * 1. 从 GameState.玩家.生存资源 读取运行时数据
 * 2. 按 consumption.perCycle 自动消耗核心资源
 * 3. 资源低于 criticalThreshold 时记录警告日志
 * 4. 资源为 0 时应用 exhaustionPenalty（属性惩罚）
 * 5. 写消耗日志（供 SurvivalOverlay 展示）
 *
 * 只在生存模块启用时挂载。
 */
import { useEffect, useRef } from 'react';
import { eventBus, EVENTS } from '../../../../engine/eventBus';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { SurvivalModuleSchema, SurvivalConsumption } from '../../../../modules/schema';

/** 资源变更日志条目 */
export interface ResourceChangeLog {
  tick: number;
  timestamp: number;
  changes: Array<{
    resourceId: string;
    resourceName: string;
    symbol: string;
    before: number;
    after: number;
    reason: string;
  }>;
}

const MAX_LOG_ENTRIES = 50;

/**
 * 生存资源自动结算
 *
 * @param engine 游戏引擎
 * @param worldDef 当前世界定义
 * @param bumpVersion 刷新 UI 的回调
 * @returns 资源变更日志（供 UI 展示）
 */
export function useSurvivalSettlement(
  engine: GameEngine,
  worldDef: WorldDef | undefined,
  bumpVersion: () => void,
) {
  // 变更日志用 ref 存储，避免触发重渲染
  const logRef = useRef<ResourceChangeLog[]>([]);
  const tickRef = useRef(0);

  useEffect(() => {
    const survivalMod = worldDef?.modules?.find(
      m => m.moduleId === 'survival' && m.enabled,
    )?.moduleConfig as SurvivalModuleSchema | undefined;

    if (!survivalMod) return;

    // 从模块配置中提取结构化消耗规则
    // 如果 AI 没有生成 consumption，尝试从 resources 的 usage 文本中推断一个保守默认值
    const consumption: SurvivalConsumption = survivalMod.consumption ?? buildFallbackConsumption(survivalMod);

    // 构建资源元数据查找表（id → { name, symbol }）
    const resourceMeta = new Map<string, { name: string; symbol: string }>();
    for (const res of survivalMod.resources) {
      resourceMeta.set(res.id, { name: res.name, symbol: res.symbol });
    }

    const threshold = survivalMod.rules?.criticalThreshold ?? 2;

    const handler = () => {
      const state = engine.variableManager.getState();
      const resources = state.玩家?.生存资源;
      if (!resources) return;

      tickRef.current++;
      const tick = tickRef.current;
      const changes: ResourceChangeLog['changes'] = [];

      // ── 1. 自动消耗 ──
      for (const [resId, amount] of Object.entries(consumption.perCycle)) {
        if (amount <= 0) continue;

        const res = resources[resId];
        if (!res) continue; // 资源不存在（可能还没演化出来），跳过

        const before = res.数量 ?? 0;
        const after = Math.max(0, before - amount);
        res.数量 = after;

        const meta = resourceMeta.get(resId) ?? { name: resId, symbol: '📦' };
        changes.push({
          resourceId: resId,
          resourceName: meta.name,
          symbol: meta.symbol,
          before,
          after,
          reason: `周期消耗 -${amount}`,
        });

        // 低于阈值时追加警告日志
        if (after > 0 && after <= threshold) {
          changes.push({
            resourceId: resId,
            resourceName: meta.name,
            symbol: meta.symbol,
            before: after,
            after: after,
            reason: `${meta.name}不足，即将耗尽！`,
          });
        }
      }

      // ── 2. 资源耗尽惩罚 ──
      // exhaustionPenalty 的语义：{ "被耗尽的资源id": 每轮扣减体力值 }
      if (consumption.exhaustionPenalty) {
        const stats = state.玩家?.生存状态;
        if (stats) {
          for (const [resId, penalty] of Object.entries(consumption.exhaustionPenalty)) {
            if (penalty <= 0) continue;
            const res = resources[resId];
            if (!res) continue;

            // 只有当资源在本轮被消耗到 0 时才应用惩罚
            const meta = resourceMeta.get(resId) ?? { name: resId, symbol: '📦' };
            const consumedThisTick = changes.find(c => c.resourceId === resId && c.reason.startsWith('周期消耗'));
            if (consumedThisTick && consumedThisTick.after === 0) {
              const staminaBefore = stats.体力值 ?? 0;
              stats.体力值 = Math.max(0, staminaBefore - penalty);
              changes.push({
                resourceId: resId,
                resourceName: meta.name,
                symbol: meta.symbol,
                before: staminaBefore,
                after: stats.体力值,
                reason: `${meta.name}耗尽，体力 -${penalty}`,
              });
            }
          }
        }
      }

      // ── 3. 写日志 + 更新状态 ──
      if (changes.length > 0) {
        logRef.current.push({
          tick,
          timestamp: Date.now(),
          changes,
        });
        // 容量限制
        if (logRef.current.length > MAX_LOG_ENTRIES) {
          logRef.current = logRef.current.slice(-MAX_LOG_ENTRIES);
        }

        engine.variableManager.setState(state);
        bumpVersion();
      }
    };

    eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, handler);
    return () => { eventBus.off(EVENTS.VARIABLE_UPDATE_ENDED, handler); };
  }, [engine, worldDef, bumpVersion]);

  // 返回日志引用和清除方法
  return {
    getChangeLog: () => logRef.current,
    clearChangeLog: () => { logRef.current = []; },
  };
}

/**
 * 当 AI 没有生成结构化 consumption 时，从 resources 的 usage 文本推断保守默认值
 * 只对 usage 中包含消耗关键词的资源设为 1
 */
function buildFallbackConsumption(mod: SurvivalModuleSchema): SurvivalConsumption {
  const perCycle: Record<string, number> = {};

  // 从 consumePerCycle 文本和 resources 的 usage 中推断
  // 保守策略：只对 usage 中包含"消耗""每天""需要"等关键词的资源设为 1
  const consumeKeywords = ['消耗', '每天', '需要', '食用', '饮用', '吃', '喝'];

  for (const res of mod.resources) {
    const text = `${res.usage ?? ''} ${res.description ?? ''}`;
    const hasConsumeHint = consumeKeywords.some(kw => text.includes(kw));
    if (hasConsumeHint) {
      perCycle[res.id] = 1;
    }
  }

  // 如果一个都没匹配到，至少消耗第一个资源
  if (Object.keys(perCycle).length === 0 && mod.resources.length > 0) {
    perCycle[mod.resources[0].id] = 1;
  }

  return { perCycle };
}
