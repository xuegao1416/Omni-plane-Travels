// 底层必选属性卡片 — 生命类 + 能量类进度条
import { memo } from 'react';
import { Heart, Zap, Plus } from 'lucide-react';
import type { StatModuleSchema } from '../../../../modules/schema';
import { Collapsible } from '../../../shared/Collapsible';

interface BaseStatsCardProps {
  data: StatModuleSchema;
  /** 自定义标题（世界创建时设置的模块名称） */
  title?: string;
  derived?: Array<{ id: string; name?: string; value: number }>;
  modifiers?: Array<{ id: string; statId: string; delta: number; mode?: 'flat' | 'percent'; source?: string; expiresAtTick?: number }>;
  availablePoints?: number;
  onAllocate?: (statId: string) => void;
}

function visibleSystemLabel(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return /[A-Za-z]/.test(value) ? fallback : value;
}

export default memo(function BaseStatsCard({ data, title, derived = [], modifiers = [], availablePoints = 0, onAllocate }: BaseStatsCardProps) {
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
      {derived.length > 0 && (
        <div style={{ marginTop: '8px', paddingTop: '7px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '4px' }}>派生属性</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
            {derived.map(item => <span key={item.id} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>{visibleSystemLabel(item.name || item.id, '派生属性')}：<b style={{ color: 'var(--accent)' }}>{item.value}</b></span>)}
          </div>
        </div>
      )}
      {modifiers.length > 0 && (
        <div style={{ marginTop: '8px', paddingTop: '7px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '4px' }}>当前修正</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {modifiers.map(item => <span key={item.id} style={{ fontSize: '10px', color: item.delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>{visibleSystemLabel(item.source || item.id, '系统效果')}：{item.delta >= 0 ? '+' : ''}{item.delta}{item.mode === 'percent' ? '% ' : ' '}{item.expiresAtTick !== undefined ? `（至推演轮次 ${item.expiresAtTick}）` : ''}</span>)}
          </div>
        </div>
      )}
      {availablePoints > 0 && onAllocate && (
        <div style={{ marginTop: '8px', paddingTop: '7px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>可用属性点</span>
            <strong style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)' }}>{availablePoints}</strong>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {(['attrA', 'attrB', 'dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const).map(statId => {
              const stat = statId === 'attrA' ? data.attrA : statId === 'attrB' ? data.attrB : data[statId];
              if (!stat) return null;
              return <button key={statId} type="button" className="btn-ghost" onClick={() => onAllocate(statId)} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 6px', fontSize: 'var(--font-size-xs)' }} title={`为${stat.name}分配1点`}><Plus size={11} />{stat.name}</button>;
            })}
          </div>
        </div>
      )}
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
