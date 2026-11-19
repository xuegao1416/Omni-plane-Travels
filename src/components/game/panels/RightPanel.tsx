import { Clock,MapPin,Cloud,Heart,Zap,Swords } from 'lucide-react';
import type { GameState } from '../../../schema/variables';
import type { WorldSystemData,ProgressionConfig } from '../../../modules/schema';
import type { EconomyViewModel } from '../../../domains/economy/viewModel';
import EconomyCard from './modules/EconomyCard';
import type { ResourcesViewModel } from '../../../domains/resources/viewModel';
import { BaseStatsCard,SixDimCard,ProgressionCard,TalentCard } from './modules';
import ResourcesCard from './modules/ResourcesCard';
import EventsCard from './modules/EventsCard';
import type { EventsPanelView } from '../../../events/viewModel';
import type { PacingLevel } from '../../../events/types';
import { findWorldDef } from '../../../data/worldLoader';
import { CustomModulePanel } from './CustomModulePanel';
import { formatWorldClock,getTimeSystemFromWorld } from '../../../time/worldClock';
import { toDisplayText } from '../../../utils/displayText';

const COMBAT_RISK_LABELS = { easy: '简单', normal: '普通', hard: '困难', inferno: '炼狱' } as const;

interface Props {
  gameState: GameState;
  worldId?: string;
  /** 物资：资源模块给出的界面数据（未启用时为空） */
  resourcesView?: ResourcesViewModel | null;
  onResourceGather?: (resourceId: string) => void;
  onResourceGenerateRecipe?: (request: string) => Promise<boolean>;
  onResourceCancelRecipeGeneration?: () => void;
  /** 是否正在生成配方 */
  isGeneratingRecipe?: boolean;
  /** 商号：经营模块给出的界面数据（未启用时为空） */
  economyView?: EconomyViewModel | null;
  onOpenEconomyLedger?: () => void;
  /** 事件：节奏、待处理与最近结果（世界没有任何事件时为空） */
  eventsView?: EventsPanelView | null;
  onSetEventPacing?: (level: PacingLevel) => void;
  onOpenEventCard?: () => void;
  /** 物资：打开账本抽屉 */
  onOpenResourcesLedger?: () => void;
  onAllocateStat?: (statId: string) => void;
  onBreakthrough?: (targetTier: number) => void;
  onUnlockTalent?: (talentId: string) => void;
  onLearnSkill?: (skillId: string) => void;
  onUseSkill?: (skillId: string) => void;
  onAwakenAbility?: (abilityId: string) => void;
  onRespecAbilities?: () => void;
  onEquipAbility?: (abilityId: string, slotId: string) => void;
  onUnequipAbility?: (abilityId: string) => void;
  onCustomModuleButton?: (moduleId: string, event: string) => void;
  combatV3Enabled?: boolean;
}

// 世界状态行 - Lucide 图标 + 文字
function StatusRow({ icon, text, muted }: { icon: React.ReactNode; text: string; muted?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', minWidth: 0, color: muted ? 'var(--text-muted)' : undefined }}>
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{text}</span>
    </span>
  );
}

// 生存状态条
function GaugeBar({ label, value, max, color, icon }: { label: string; value: number; max: number; color: string; icon: React.ReactNode }) {
  // 防御：确保 value 和 max 是有效数字
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : 0;
  const safeMax = typeof max === 'number' && !isNaN(max) && max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (safeValue / safeMax) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
      <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>{icon}</span>
      <span style={{ width: '32px', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{label}</span>
      <div className="game-status-meter">
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: '999px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: '50px', fontSize: 'var(--font-size-xs)', textAlign: 'right', color: 'var(--text-secondary)' }}>{safeValue}/{safeMax}</span>
    </div>
  );
}

export default function RightPanel({ gameState, worldId, resourcesView, onResourceGather, onResourceGenerateRecipe, onResourceCancelRecipeGeneration, isGeneratingRecipe, economyView, onOpenEconomyLedger, eventsView, onSetEventPacing, onOpenEventCard, onOpenResourcesLedger, onAllocateStat, onBreakthrough, onUnlockTalent, onLearnSkill, onUseSkill, onAwakenAbility, onRespecAbilities, onEquipAbility, onUnequipAbility, onCustomModuleButton, combatV3Enabled = false }: Props) {
  const world = gameState.世界;
  const player = gameState.玩家;
  const worldDef = worldId ? findWorldDef(worldId) : null;
  const clockConfig = getTimeSystemFromWorld(worldDef ?? undefined);
  const displayWorldTime = world.时间系统.时钟
    ? formatWorldClock(world.时间系统.时钟, clockConfig)
    : world.时间系统.当前时间;

  // 判断是否有数值模块（生存状态中有 dim1 等字段说明启用了数值模块）
  const hasStatModule = 'dim1' in (player.生存状态 || {});

  // 从世界定义获取成长体系配置（静态配置，不存入 GameState）
  const progMod = worldDef?.modules?.find(m => m.moduleId === 'progression' && m.enabled);
  const hasProfessionModule = Boolean(worldDef?.modules?.some(module => module.moduleId === 'profession' && module.enabled));
  const progressionConfig = progMod?.moduleConfig as ProgressionConfig | undefined;
  const combatRiskLabel = COMBAT_RISK_LABELS[gameState.v3?.featureFlags?.combatRiskMode ?? 'normal'];

  // 从世界定义构建 WorldSystemData（用于 UI 卡片展示）
  const keyMap: Record<string, string> = {
    stat: '数值属性', progression: '成长体系', survival: '生存资源',
    business: '经营资产', talent: '天赋体系',
  };
  const worldSystem: WorldSystemData = {};
  const moduleNames: Record<string, string> = {};
  if (worldDef?.modules) {
    for (const mod of worldDef.modules) {
      if (!mod.enabled) continue;
      const key = keyMap[mod.moduleId];
      if (key && (mod.moduleConfig)) {
        if (mod.moduleId === 'survival') {
          // 物资卡由资源模块的界面数据驱动，这里不再合并配置与存档。
          continue;
        } else if (mod.moduleId === 'business') {
          // 商号卡由经营模块的界面数据驱动。
          continue;
        } else {
          (worldSystem as any)[key] = mod.moduleConfig;
        }
        if (mod.name) moduleNames[key] = mod.name;
      }
    }
  }

  // 从世界定义获取数值属性配置（用于显示属性中文名称）
  const statMod = worldDef?.modules?.find(m => m.moduleId === 'stat' && m.enabled);
  const statModuleData = statMod?.moduleConfig as any;
  const statConfig = statModuleData ? {
    attrA: { name: statModuleData.attrA?.name || '生命' },
    attrB: { name: statModuleData.attrB?.name || '能量' },
    dim1: { name: statModuleData.dim1?.name || '属性1' },
    dim2: { name: statModuleData.dim2?.name || '属性2' },
    dim3: { name: statModuleData.dim3?.name || '属性3' },
    dim4: { name: statModuleData.dim4?.name || '属性4' },
    dim5: { name: statModuleData.dim5?.name || '属性5' },
    dim6: { name: statModuleData.dim6?.name || '属性6' },
  } : undefined;
  const statRuntime = gameState.gameplay?.stat;
  const statDerived = Object.entries(statRuntime?.derived ?? {}).map(([id, value]) => ({
    id, value: Number(value) || 0, name: statModuleData?.derived?.find((item: any) => item.id === id)?.name || id,
  }));
  const currentTick = gameState.simulationRuntime?.tick ?? 0;
  const progressionFailureReason = [...(gameState.gameplay?.logs ?? [])].reverse().find(log => log.moduleId === 'progression' && log.status === 'blocked')?.reason;
  const statModifiers = Object.values(statRuntime?.modifiers ?? {}).filter(modifier => modifier.expiresAtTick === undefined || modifier.expiresAtTick > currentTick);

  return (
    <div className="game-journey__status-panel">
      <CustomModulePanel gameState={gameState} worldId={worldId} onButton={onCustomModuleButton} />
      {/* 世界状态 */}
      <div className="surface-card game-journey__status-card">
        <h4>
          世界状态
        </h4>
        <div style={{ fontSize: 'var(--font-size-sm)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {(!displayWorldTime && !world.空间定位.当前位置) ? (
            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 'var(--font-size-sm)' }}>
              等待世界展开...
            </span>
          ) : (
            <>
              {displayWorldTime && <StatusRow icon={<Clock size={13} />} text={displayWorldTime} />}
              {toDisplayText(world.空间定位.当前位置) && <StatusRow icon={<MapPin size={13} />} text={toDisplayText(world.空间定位.当前位置)} />}
              {toDisplayText(world.时间系统.当前天气) && <StatusRow icon={<Cloud size={13} />} text={toDisplayText(world.时间系统.当前天气)} />}
              {combatV3Enabled && <StatusRow icon={<Swords size={13} />} text={`战斗风险：${combatRiskLabel}（旅程开始后锁定）`} muted />}
            </>
          )}
        </div>
      </div>

      {/* 当前目标 */}
      {toDisplayText(player.当前目标) && (
        <div className="surface-card game-journey__status-card">
          <h4>
            当前目标
          </h4>
          <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--accent)' }}>
            {toDisplayText(player.当前目标)}
          </div>
        </div>
      )}

      {/* 生存状态（无数值属性模块时显示默认血量/体力） */}
      {!hasStatModule && (
        <div className="surface-card game-journey__status-card">
          <h4>
            生存状态
          </h4>
          <GaugeBar icon={<Heart size={11} color="var(--danger)" />} label="血量" value={player.生存状态?.血量 ?? 100} max={100} color="var(--danger)" />
          <GaugeBar icon={<Zap size={11} color="var(--warning)" />} label="体力" value={player.生存状态?.体力值 ?? 100} max={100} color="var(--warning)" />
        </div>
      )}

      {/* ── 数值属性卡片（配置从世界定义读取，当前值从玩家.生存状态读取） ── */}
      {hasStatModule && (() => {
        const cfg = statConfig;
        const ss = player.生存状态;
        const getVal = (key: string, fallback: number) => typeof ss[key] === 'number' ? ss[key] as number : fallback;
        const statModData = statMod?.moduleConfig as any;
        // 从世界定义读取特色属性配置，从生存状态读取当前值
        const specialFromConfig = Array.isArray(statModData?.special) ? statModData.special : [];
        const special = specialFromConfig.map((sp: any) => ({
          id: sp.id, name: sp.name || sp.id,
          value: getVal(sp.id, 0),
          range: sp.range || [0, 100],
          description: sp.description || '',
        }));
        const mergedData = {
          attrA: { name: cfg?.attrA?.name || '生命', current: ss.血量, max: statModData?.attrA?.max ?? 100 },
          attrB: { name: cfg?.attrB?.name || '能量', current: ss.体力值, max: statModData?.attrB?.max ?? 100 },
          dim1: { name: cfg?.dim1?.name || '属性1', value: getVal('dim1', 50), range: statModData?.dim1?.range ?? [0, 100] },
          dim2: { name: cfg?.dim2?.name || '属性2', value: getVal('dim2', 50), range: statModData?.dim2?.range ?? [0, 100] },
          dim3: { name: cfg?.dim3?.name || '属性3', value: getVal('dim3', 50), range: statModData?.dim3?.range ?? [0, 100] },
          dim4: { name: cfg?.dim4?.name || '属性4', value: getVal('dim4', 50), range: statModData?.dim4?.range ?? [0, 100] },
          dim5: { name: cfg?.dim5?.name || '属性5', value: getVal('dim5', 50), range: statModData?.dim5?.range ?? [0, 100] },
          dim6: { name: cfg?.dim6?.name || '属性6', value: getVal('dim6', 50), range: statModData?.dim6?.range ?? [0, 100] },
          special,
        };
        return (
          <>
            <BaseStatsCard data={mergedData as any} title={moduleNames?.['数值属性']} derived={statDerived} modifiers={statModifiers} availablePoints={player.可用属性点 ?? 0} onAllocate={onAllocateStat} />
            <SixDimCard data={mergedData as any} title={moduleNames?.['数值属性'] ? moduleNames['数值属性'] + ' · 六维' : undefined} />
          </>
        );
      })()}
      {/* 成长体系：配置从世界定义读取，状态从玩家读取 */}
      {progressionConfig && (
        <ProgressionCard
          config={progressionConfig}
          state={{
            currentTierIndex: player.当前段位索引 ?? 0,
            currentXP: player.当前经验值 ?? 0,
          }}
          title={worldDef?.modules?.find(m => m.moduleId === 'progression')?.name || '成长体系'}
          breakthroughFailureReason={progressionFailureReason}
          statNames={statConfig ? {
            attrA: statConfig.attrA.name,
            attrB: statConfig.attrB.name,
            dim1: statConfig.dim1.name,
            dim2: statConfig.dim2.name,
            dim3: statConfig.dim3.name,
            dim4: statConfig.dim4.name,
            dim5: statConfig.dim5.name,
            dim6: statConfig.dim6.name,
          } : undefined}
          onBreakthrough={onBreakthrough}
        />
      )}
      {worldSystem.天赋体系 && !hasProfessionModule && (
        <TalentCard
          data={worldSystem.天赋体系}
          gameState={gameState}
          abilityState={player.能力系统}
          currentTick={gameState.simulationRuntime?.tick ?? 0}
          title={moduleNames?.['天赋体系'] || '天赋与技能'}
          onUnlockTalent={onUnlockTalent}
          onLearnSkill={onLearnSkill}
          onUseSkill={onUseSkill}
          onAwakenAbility={onAwakenAbility}
          onRespec={onRespecAbilities}
          onEquipAbility={onEquipAbility}
          onUnequipAbility={onUnequipAbility}
        />
      )}
      {resourcesView && (
        <ResourcesCard
          view={resourcesView}
          onGather={onResourceGather}
          onGenerateRecipe={onResourceGenerateRecipe}
          onCancelRecipeGeneration={onResourceCancelRecipeGeneration}
          isGeneratingRecipe={isGeneratingRecipe}
          onOpenLedger={onOpenResourcesLedger}
        />
      )}
      {economyView && <EconomyCard view={economyView} onOpenLedger={onOpenEconomyLedger} />}
      {eventsView && <EventsCard view={eventsView} onSetPacing={onSetEventPacing} onOpenPending={onOpenEventCard} />}
    </div>
  );
}
