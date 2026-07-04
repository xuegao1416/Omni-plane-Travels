import { useEffect } from 'react';
import { eventBus, EVENTS } from '../../../../engine/eventBus';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { BusinessModuleSchema } from '../../../../modules/schema';

type AssetStatus = 'active' | 'idle' | 'damaged' | 'destroyed';
type TxType = 'income' | 'expense' | 'purchase' | 'sale' | 'upgrade' | 'event';

interface RuntimeAsset {
  id: string;
  名称: string;
  类型: string;
  等级: number;
  最高等级: number;
  描述: string;
  状态: AssetStatus;
  基础收益: number;
  每级收益: number;
  维护费: number;
}

interface RuntimeBusiness {
  资金: number;
  资产列表: RuntimeAsset[];
  交易日志?: Array<{ 类型: TxType; 描述: string; 金额: number }>;
}

/** 计算单个资产的净收益（含等级加成） */
function assetNetIncome(asset: RuntimeAsset): number {
  const levelBonus = (asset.每级收益 ?? 0) * Math.max(0, (asset.等级 ?? 1) - 1);
  return (asset.基础收益 ?? 0) + levelBonus - (asset.维护费 ?? 0);
}

/**
 * 经营资产：自动结算（每轮变量更新后，纯机械计算）
 * 从 GameState.玩家.经营资产 读取运行时数据，结算后写回
 *
 * 修复记录：
 * - 移除 net===0 的提前 return，确保每轮都 bumpVersion 刷新 UI
 * - 资金下限保护（不低于 0）
 * - 资金不足时资产自动降级为 idle
 * - 交易日志容量限制（保留最近 50 条）
 */
export function useBusinessSettlement(
  engine: GameEngine,
  worldDef: WorldDef | undefined,
  bumpVersion: () => void,
) {
  useEffect(() => {
    const handler = () => {
      const biz = worldDef?.modules?.find(m => m.moduleId === 'business' && m.enabled)?.moduleConfig as BusinessModuleSchema | undefined;
      if (!biz) return;

      const state = engine.variableManager.getState();
      const runtimeBiz = state.玩家?.经营资产 as RuntimeBusiness | undefined;

      // 如果 GameState 中还没有经营资产数据，从世界定义初始化
      if (!runtimeBiz) {
        const funds = biz.funds ?? 0;
        const assets: RuntimeAsset[] = Array.isArray(biz.assets) ? biz.assets.map(a => ({
          id: a.id,
          名称: a.name,
          类型: a.type || '',
          等级: a.level ?? 1,
          最高等级: a.maxLevel ?? 3,
          描述: a.description || '',
          状态: (a.status || 'active') as AssetStatus,
          基础收益: a.income?.base ?? 0,
          每级收益: a.income?.perLevel ?? 0,
          维护费: a.maintenance ?? 0,
        })) : [];

        if (funds > 0 || assets.length > 0) {
          state.玩家.经营资产 = {
            资金: funds,
            资产列表: assets,
          交易日志: biz.transactionLog?.map(t => ({
            类型: (t.type || 'income') as TxType,
            描述: t.description || '',
            金额: t.amount || 0,
          })) || [],
          };
          engine.variableManager.setState(state);
          bumpVersion();
        }
        return;
      }

      // ── 有运行时数据时，执行机械结算 ──

      let totalIncome = 0;
      let totalMaintenance = 0;

      for (const asset of runtimeBiz.资产列表) {
        if (asset.状态 !== 'active') continue;
        const levelBonus = (asset.每级收益 ?? 0) * Math.max(0, (asset.等级 ?? 1) - 1);
        totalIncome += (asset.基础收益 ?? 0) + levelBonus;
        totalMaintenance += asset.维护费 ?? 0;
      }

      const net = totalIncome - totalMaintenance;
      const currentFunds = runtimeBiz.资金 ?? 0;
      let newFunds = currentFunds + net;

      // 资金下限保护：不能为负数
      if (newFunds < 0) {
        newFunds = 0;

        // 资金不足，将维护费最高的 active 资产降级为 idle
        // 直到剩余维护费可以被资金覆盖
        const activeAssets = runtimeBiz.资产列表
          .filter(a => a.状态 === 'active')
          .sort((a, b) => (b.维护费 ?? 0) - (a.维护费 ?? 0));

        let remainingMaintenance = totalMaintenance;
        for (const asset of activeAssets) {
          if (newFunds >= remainingMaintenance) break;
          asset.状态 = 'idle';
          remainingMaintenance -= asset.维护费 ?? 0;
          if (!runtimeBiz.交易日志) runtimeBiz.交易日志 = [];
          runtimeBiz.交易日志.push({
            类型: 'event',
            描述: `资金不足，${asset.名称} 暂停运营`,
            金额: 0,
          });
        }

        // 重新计算（部分资产已降级为 idle）
        totalIncome = 0;
        totalMaintenance = 0;
        for (const asset of runtimeBiz.资产列表) {
          if (asset.状态 !== 'active') continue;
          const levelBonus = (asset.每级收益 ?? 0) * Math.max(0, (asset.等级 ?? 1) - 1);
          totalIncome += (asset.基础收益 ?? 0) + levelBonus;
          totalMaintenance += asset.维护费 ?? 0;
        }
        newFunds = Math.max(0, currentFunds + totalIncome - totalMaintenance);
      }

      runtimeBiz.资金 = newFunds;

      // 交易日志：仅在资金实际变化时记录
      if (!runtimeBiz.交易日志) runtimeBiz.交易日志 = [];
      if (net !== 0) {
        runtimeBiz.交易日志.push({
          类型: net >= 0 ? 'income' : 'expense',
          描述: `周期结算：收入 +${totalIncome}，维护 -${totalMaintenance}`,
          金额: net,
        });
      }

      // 交易日志容量限制：保留最近 50 条
      if (runtimeBiz.交易日志.length > 50) {
        runtimeBiz.交易日志 = runtimeBiz.交易日志.slice(-50);
      }

      engine.variableManager.setState(state);
      // 始终刷新 UI——即使 net===0，AI 可能通过 UpdateVariable 改变了资产数据
      bumpVersion();
    };

    eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, handler);
    return () => { eventBus.off(EVENTS.VARIABLE_UPDATE_ENDED, handler); };
  }, [engine, worldDef, bumpVersion]);
}
