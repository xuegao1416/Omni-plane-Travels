// 底层必选属性卡片 — 生命类 + 能量类进度条
import { memo } from 'react';
import { Heart, Zap } from 'lucide-react';
import type { StatModuleSchema } from '../../../../modules/schema';
import { Collapsible } from '../../../shared/Collapsible';

interface BaseStatsCardProps {
  data: StatModuleSchema;
  /** 自定义标题（世界创建时设置的模块名称） */
  title?: string;
}

export default memo(function BaseStatsCard({ data, title }: BaseStatsCardProps) {
  return (
    <Collapsible icon={<Heart size={15} />} title={title || (data.attrA.name + ' / ' + data.attrB.name)} defaultOpen={true}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <GaugeBar
          icon={<Heart size={11} color="var(--danger)" />}
          label={data.attrA.name}
          value={data.attrA.current}
          max={data.attrA.max}
          color="var(--danger)"
        />
        <GaugeBar
          icon={<Zap size={11} color="#3b82f6" />}
          label={data.attrB.name}
          value={data.attrB.current}
          max={data.attrB.max}
          color="#3b82f6"
        />
      </div>
    </Collapsible>
  );
});

function GaugeBar({ icon, label, value, max, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  // 防御：确保 value 和 max 是有效数字
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : 0;
  const safeMax = typeof max === 'number' && !isNaN(max) && max > 0 ? max : 100;
  const pct = Math.max(0, Math.min(100, (safeValue / safeMax) * 100));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
      <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>{icon}</span>
      <span style={{ minWidth: '36px', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ flex: 1, height: '10px', background: 'var(--bg-tertiary)', borderRadius: '5px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 'var(--font-size-xs)', textAlign: 'right', color: 'var(--text-secondary)', minWidth: '60px' }}>{safeValue}/{safeMax}</span>
    </div>
  );
}
