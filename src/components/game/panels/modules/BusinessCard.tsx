// 经营资产概览卡片 — 右侧面板摘要，点击展开覆盖层
import { memo } from 'react';
import { Briefcase, DollarSign, TrendingUp, Building2, ChevronRight } from 'lucide-react';
import type { BusinessModuleSchema } from '../../../../modules/schema';
import { Collapsible } from '../../../shared/Collapsible';

interface BusinessCardProps {
  data: BusinessModuleSchema;
  title?: string;
  onOpenOverlay: () => void;
}

/** 计算所有 active 资产的净收入 */
function calcNetIncome(data: BusinessModuleSchema): number {
  if (!data.assets?.length) return 0;
  return data.assets
    .filter(a => a.status === 'active')
    .reduce((sum, a) => {
      const levelBonus = (a.income?.perLevel ?? 0) * Math.max(0, (a.level ?? 1) - 1);
      return sum + (a.income?.base ?? 0) + levelBonus - (a.maintenance ?? 0);
    }, 0);
}

export default memo(function BusinessCard({ data, title, onOpenOverlay }: BusinessCardProps) {
  const netIncome = calcNetIncome(data);
  const activeAssets = data.assets?.filter(a => a.status === 'active').length ?? 0;

  return (
    <Collapsible icon={<Briefcase size={15} />} title={title || '经营资产'} defaultOpen={true}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 'var(--font-size-sm)' }}>
        {/* 资金 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <DollarSign size={14} color="var(--accent)" />
          <span style={{ color: 'var(--text-muted)' }}>资金</span>
          <span style={{ fontWeight: 600, marginLeft: 'auto' }}>{data.funds ?? 0}</span>
        </div>

        {/* 净收入 */}
        {activeAssets > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={14} color={netIncome >= 0 ? 'var(--success)' : 'var(--danger)'} />
            <span style={{ color: 'var(--text-muted)' }}>净收入</span>
            <span style={{
              fontWeight: 600, marginLeft: 'auto',
              color: netIncome >= 0 ? 'var(--success)' : 'var(--danger)',
            }}>
              {netIncome >= 0 ? '+' : ''}{netIncome}/{data.cycleName || '天'}
            </span>
          </div>
        )}

        {/* 资产数量 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={14} color="var(--text-muted)" />
          <span style={{ color: 'var(--text-muted)' }}>资产</span>
          <span style={{ fontWeight: 600, marginLeft: 'auto' }}>{activeAssets} 处</span>
        </div>

        {/* 展开详情 */}
        <div
          onClick={onOpenOverlay}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
            marginTop: '4px', padding: '6px 12px',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)',
          }}
        >
          {activeAssets > 0 ? '查看详情' : '经营资产'}
          <ChevronRight size={12} />
        </div>
      </div>
    </Collapsible>
  );
});
