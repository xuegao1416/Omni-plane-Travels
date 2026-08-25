// 六维属性 + 特色属性卡片（六维可选）
import { memo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { StatModuleSchema } from '../../../../modules/schema';
import { Collapsible } from '../../../shared/Collapsible';
import { getSixDimSemantic } from '../../../../modules/xpAlgorithm';

interface SixDimCardProps {
  data: StatModuleSchema;
  /** 自定义标题（世界创建时设置的模块名称） */
  title?: string;
}

const DIM_KEYS = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const;

export default memo(function SixDimCard({ data, title }: SixDimCardProps) {
  const dims = DIM_KEYS.flatMap(key => data[key] ? [{ key, data: data[key]! }] : []);
  const hasDims = dims.length > 0;
  const specials = Array.isArray(data.special) ? data.special : [];
  const hasSpecials = specials.length > 0;

  if (!hasDims && !hasSpecials) return null;

  return (
    <Collapsible icon={<BarChart3 size={15} />} title={title || '六维属性'} defaultOpen={true}>
      {hasDims && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
          {dims.map(({ key, data: dim }) => {
            const safeValue = typeof dim.value === 'number' && !isNaN(dim.value) ? dim.value : 0;
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 4, alignItems: 'center' }} title={dim.description || getSixDimSemantic(key, dim).label}>
                <span style={{ minWidth: 0, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{dim.name}<small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 9, opacity: .72 }}>{getSixDimSemantic(key, dim).label}</small></span>
                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>{safeValue}</span>
              </div>
            );
          })}
        </div>
      )}

      {hasSpecials && (
        <div style={{ marginTop: hasDims ? '10px' : 0, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {specials.map(sp => {
            const safeValue = typeof sp.value === 'number' && !isNaN(sp.value) ? sp.value : 0;
            const safeMax = Array.isArray(sp.range) && typeof sp.range[1] === 'number' && !isNaN(sp.range[1]) ? sp.range[1] : 100;
            return (
              <div
                key={sp.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '3px 8px', borderRadius: '10px',
                  background: 'color-mix(in srgb, var(--accent) 15%, transparent)', fontSize: 'var(--font-size-xs)',
                }}
                title={sp.description}
              >
                <span style={{ color: 'var(--text-muted)' }}>{sp.name}</span>
                <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{safeValue}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>/ {safeMax}</span>
              </div>
            );
          })}
        </div>
      )}
    </Collapsible>
  );
});
