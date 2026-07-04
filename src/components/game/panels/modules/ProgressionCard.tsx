// 成长体系卡片 — 段位制/等级制统一渲染
import { memo } from 'react';
import { TrendingUp } from 'lucide-react';
import type { ProgressionConfig, ProgressionState, ProgressionModuleSchema, StatBonuses } from '../../../../modules/schema';
import { getXpForNextTier, getTierProgress, getLevelStatBonuses } from '../../../../modules/xpAlgorithm';
import { Collapsible } from '../../../shared/Collapsible';

/** 属性名称映射（从数值属性配置读取） */
interface StatNames {
  attrA?: string;
  attrB?: string;
  dim1?: string;
  dim2?: string;
  dim3?: string;
  dim4?: string;
  dim5?: string;
  dim6?: string;
}

interface ProgressionCardProps {
  /** 成长体系配置（静态，从世界定义模块读取） */
  config: ProgressionConfig;
  /** 成长体系状态（动态，从变量系统读取） */
  state?: ProgressionState;
  title?: string;
  /** @deprecated 兼容旧格式，新代码请使用 config + state */
  data?: ProgressionModuleSchema;
  /** 属性名称映射（用于显示中文名称） */
  statNames?: StatNames;
}

export default memo(function ProgressionCard({ config, state, title, data, statNames }: ProgressionCardProps) {
  const defaultTitle = config.mode === 'tiered' ? '段位体系' : '等级体系';
  const displayTitle = title || defaultTitle;

  // 合并配置和状态，兼容旧格式
  const currentTierIndex = state?.currentTierIndex ?? data?.currentTierIndex ?? 0;
  const currentXP = state?.currentXP ?? data?.currentXP ?? 0;

  // 构建完整的 progression 对象供算法使用
  // 防御：确保 xpFormula 存在且属性完整
  const safeXpFormula = config.xpFormula || { baseXP: 100, exponent: 1.5, scaleFactor: 1.0 };
  const progression: ProgressionModuleSchema = {
    ...config,
    xpFormula: safeXpFormula,
    currentTierIndex,
    currentXP,
  };

  // ── 等级制 ──
  if (config.mode === 'level' && config.levelData) {
    const ld = config.levelData;
    const xpNeeded = getXpForNextTier(progression);
    const progress = getTierProgress(progression);
    const pct = isNaN(progress) ? 0 : Math.round(progress * 100);
    const isMax = currentTierIndex >= ld.maxLevel;
    const caps = getLevelStatBonuses(currentTierIndex, ld);

    return (
      <Collapsible icon={<TrendingUp size={15} />} title={displayTitle} defaultOpen={true}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* 当前等级 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700, color: 'var(--accent)' }}>
              Lv.{currentTierIndex}
            </span>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              / {ld.maxLevel}
            </span>
          </div>

          {/* XP 进度条 */}
          {!isMax && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', marginBottom: '2px' }}>
                <span style={{ color: 'var(--text-muted)' }}>经验</span>
                <span style={{ color: 'var(--text-secondary)' }}>{currentXP} / {xpNeeded}</span>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#a78bfa', borderRadius: '4px', transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          {/* 属性天花板预览 */}
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
            <span>{statNames?.attrA || '生命'}上限: {caps.attrAMax}</span>
            <span>{statNames?.attrB || '能量'}上限: {caps.attrBMax}</span>
            {caps.dim1Max > 0 && <span>{statNames?.dim1 || '属性1'}上限: {caps.dim1Max}</span>}
            {caps.dim2Max > 0 && <span>{statNames?.dim2 || '属性2'}上限: {caps.dim2Max}</span>}
            {caps.dim3Max > 0 && <span>{statNames?.dim3 || '属性3'}上限: {caps.dim3Max}</span>}
            {caps.dim4Max > 0 && <span>{statNames?.dim4 || '属性4'}上限: {caps.dim4Max}</span>}
            {caps.dim5Max > 0 && <span>{statNames?.dim5 || '属性5'}上限: {caps.dim5Max}</span>}
            {caps.dim6Max > 0 && <span>{statNames?.dim6 || '属性6'}上限: {caps.dim6Max}</span>}
          </div>

          {/* 已满级 */}
          {isMax && (
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)', fontWeight: 600 }}>
              ✦ 已达最高等级
            </div>
          )}
        </div>
      </Collapsible>
    );
  }

  // ── 段位制 ──
  const tiers = config.tiers;
  if (!tiers?.length) {
    return (
      <Collapsible icon={<TrendingUp size={15} />} title={displayTitle} defaultOpen={true}>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>暂无数据</div>
      </Collapsible>
    );
  }

  const currentTier = tiers[currentTierIndex];
  const nextTier = tiers[currentTierIndex + 1];
  const xpNeeded = getXpForNextTier(progression);
  const progress = getTierProgress(progression);
  const pct = isNaN(progress) ? 0 : Math.round(progress * 100);

  return (
    <Collapsible icon={<TrendingUp size={15} />} title={displayTitle} defaultOpen={true}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--accent)' }}>
            {currentTier?.name || '未知'}
          </span>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            第{currentTierIndex + 1}段
          </span>
        </div>

        {currentTier?.description && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            {currentTier.description}
          </div>
        )}

        {xpNeeded !== Infinity && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', marginBottom: '2px' }}>
              <span style={{ color: 'var(--text-muted)' }}>经验</span>
              <span style={{ color: 'var(--text-secondary)' }}>{currentXP} / {xpNeeded}</span>
            </div>
            <div style={{ height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#a78bfa', borderRadius: '4px', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {nextTier && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            → 下一段位：{nextTier.name || '未知'}
          </div>
        )}

        {!nextTier && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)', fontWeight: 600 }}>
            ✦ 已达最高段位
          </div>
        )}
      </div>
    </Collapsible>
  );
});
