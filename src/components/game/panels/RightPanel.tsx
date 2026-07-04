import { Clock, MapPin, Cloud, Landmark, Globe, Heart, Zap } from 'lucide-react';
import type { GameState } from '../../../schema/variables';
import type { WorldSystemData, ProgressionConfig, SurvivalRecipe, SurvivalModuleSchema, BusinessModuleSchema } from '../../../modules/schema';
import { BaseStatsCard, SixDimCard, ProgressionCard, SurvivalCard, BusinessCard } from './modules';
import { findWorldDef } from '../../../data/worldLoader';

interface Props {
  gameState: GameState;
  worldId?: string;
  /** 生存资源：生成配方回调 */
  onSurvivalGenerateRecipe?: (request: string) => Promise<void>;
  /** 生存资源：制作回调 */
  onSurvivalCraft?: (recipe: SurvivalRecipe) => void;
  /** 生存资源：删除配方回调 */
  onSurvivalDeleteRecipe?: (recipeId: string) => void;
  /** 是否正在生成配方 */
  isGeneratingRecipe?: boolean;
  /** 运行时配方（AI 生成，不持久化到世界定义） */
  runtimeRecipes?: SurvivalRecipe[];
  /** 经营资产：打开覆盖层 */
  onOpenBusinessOverlay?: () => void;
}

// 世界状态行 - Lucide 图标 + 文字
function StatusRow({ icon, text, muted }: { icon: React.ReactNode; text: string; muted?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: muted ? 'var(--text-muted)' : undefined }}>
      <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
      {text}
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
      <div style={{ flex: 1, height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: '50px', fontSize: 'var(--font-size-xs)', textAlign: 'right', color: 'var(--text-secondary)' }}>{safeValue}/{safeMax}</span>
    </div>
  );
}

export default function RightPanel({ gameState, worldId, onSurvivalGenerateRecipe, onSurvivalCraft, onSurvivalDeleteRecipe, isGeneratingRecipe, runtimeRecipes, onOpenBusinessOverlay }: Props) {
  const world = gameState.世界;
  const player = gameState.玩家;

  // 判断是否有数值模块（生存状态中有 dim1 等字段说明启用了数值模块）
  const hasStatModule = 'dim1' in (player.生存状态 || {});

  // 从世界定义获取成长体系配置（静态配置，不存入 GameState）
  const worldDef = worldId ? findWorldDef(worldId) : null;
  const progMod = worldDef?.modules?.find(m => m.moduleId === 'progression' && m.enabled);
  const progressionConfig = progMod?.moduleConfig as ProgressionConfig | undefined;

  // 从世界定义构建 WorldSystemData（用于 UI 卡片展示）
  const keyMap: Record<string, string> = {
    stat: '数值属性', progression: '成长体系', survival: '生存资源',
    business: '经营资产', dice: '骰子检定', talent: '天赋体系',
  };
  const worldSystem: WorldSystemData = {};
  const moduleNames: Record<string, string> = {};
  if (worldDef?.modules) {
    for (const mod of worldDef.modules) {
      if (!mod.enabled) continue;
      const key = keyMap[mod.moduleId];
      if (key && mod.moduleConfig) {
        if (mod.moduleId === 'survival' && runtimeRecipes?.length) {
          // 合并运行时配方（AI 生成）与静态配方（世界定义）
          const survData = mod.moduleConfig as SurvivalModuleSchema;
          const staticRecipes = Array.isArray(survData.recipes) ? survData.recipes : [];
          (worldSystem as any)[key] = { ...survData, recipes: [...staticRecipes, ...runtimeRecipes] };
        } else if (mod.moduleId === 'business') {
          // 合并运行时经营数据（AI 通过 UpdateVariable 更新）与静态配置
          const bizConfig = mod.moduleConfig as BusinessModuleSchema;
          const runtimeBiz = player.经营资产;
          if (runtimeBiz) {
            (worldSystem as any)[key] = {
              ...bizConfig,
              funds: runtimeBiz.资金,
              assets: runtimeBiz.资产列表.map(a => ({
                id: a.id, name: a.名称, type: a.类型,
                level: a.等级, maxLevel: a.最高等级,
                description: a.描述, status: a.状态,
                income: { base: a.基础收益, perLevel: a.每级收益, cycle: bizConfig.cycleName || '天' },
                maintenance: a.维护费,
              })),
              transactionLog: (runtimeBiz.交易日志 || []).map(t => ({
                cycle: 0, type: t.类型, description: t.描述, amount: t.金额,
              })),
            };
          } else {
            (worldSystem as any)[key] = bizConfig;
          }
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

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem',
      padding: '1rem',
      overflowY: 'auto',
      height: '100%',
    }}>
      {/* 世界状态 */}
      <div className="surface-card" style={{ padding: '1rem' }}>
        <h4 style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          世界状态
        </h4>
        <div style={{ fontSize: 'var(--font-size-sm)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {(!world.时间系统.当前时间 && !world.空间定位.当前位置) ? (
            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 'var(--font-size-sm)' }}>
              等待世界展开...
            </span>
          ) : (
            <>
              {world.时间系统.当前时间 && <StatusRow icon={<Clock size={13} />} text={world.时间系统.当前时间} />}
              {world.空间定位.当前位置 && <StatusRow icon={<MapPin size={13} />} text={world.空间定位.当前位置} />}
              {world.时间系统.当前天气 && <StatusRow icon={<Cloud size={13} />} text={world.时间系统.当前天气} />}
              {world.社会环境.权力结构 && <StatusRow icon={<Landmark size={13} />} text={world.社会环境.权力结构} />}
              {world.社会环境.社会氛围 && <StatusRow icon={<Globe size={13} />} text={world.社会环境.社会氛围} muted />}
            </>
          )}
        </div>
      </div>

      {/* 当前目标 */}
      {player.当前目标 && (
        <div className="surface-card" style={{ padding: '1rem' }}>
          <h4 style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            当前目标
          </h4>
          <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--accent)' }}>
            {player.当前目标}
          </div>
        </div>
      )}

      {/* 生存状态（无数值属性模块时显示默认血量/体力） */}
      {!hasStatModule && (
        <div className="surface-card" style={{ padding: '1rem' }}>
          <h4 style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            生存状态
          </h4>
          <GaugeBar icon={<Heart size={11} color="#ef4444" />} label="血量" value={player.生存状态.血量} max={100} color="#ef4444" />
          <GaugeBar icon={<Zap size={11} color="#f59e0b" />} label="体力" value={player.生存状态.体力值} max={100} color="#f59e0b" />
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
          attrA: { name: cfg?.attrA?.name || '生命', current: ss.血量, max: 100 },
          attrB: { name: cfg?.attrB?.name || '能量', current: ss.体力值, max: 100 },
          dim1: { name: cfg?.dim1?.name || '属性1', value: getVal('dim1', 50), range: [0, 100] as [number, number] },
          dim2: { name: cfg?.dim2?.name || '属性2', value: getVal('dim2', 50), range: [0, 100] as [number, number] },
          dim3: { name: cfg?.dim3?.name || '属性3', value: getVal('dim3', 50), range: [0, 100] as [number, number] },
          dim4: { name: cfg?.dim4?.name || '属性4', value: getVal('dim4', 50), range: [0, 100] as [number, number] },
          dim5: { name: cfg?.dim5?.name || '属性5', value: getVal('dim5', 50), range: [0, 100] as [number, number] },
          dim6: { name: cfg?.dim6?.name || '属性6', value: getVal('dim6', 50), range: [0, 100] as [number, number] },
          special,
        };
        return (
          <>
            <BaseStatsCard data={mergedData as any} title={moduleNames?.['数值属性']} />
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
        />
      )}
      {worldSystem.生存资源 && (
        <SurvivalCard
          data={worldSystem.生存资源}
          title={moduleNames?.['生存资源']}
          onGenerateRecipe={onSurvivalGenerateRecipe}
          onCraft={onSurvivalCraft}
          onDeleteRecipe={onSurvivalDeleteRecipe}
          isGeneratingRecipe={isGeneratingRecipe}
        />
      )}
      {worldSystem.经营资产 && (
        <BusinessCard
          data={worldSystem.经营资产}
          title={moduleNames?.['经营资产']}
          onOpenOverlay={onOpenBusinessOverlay ?? (() => {})}
        />
      )}
      {/* 最新消息 */}
      {world.信息层级.本地消息 && (
        <div className="surface-card" style={{ padding: '1rem' }}>
          <h4 style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            最新消息
          </h4>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
            {world.信息层级.本地消息}
          </div>
        </div>
      )}
    </div>
  );
}
