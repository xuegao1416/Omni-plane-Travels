import { useState } from 'react';
import { getQualityColor } from '../../../shared/qualityUtils';
import { extractFields, FieldDetailModal } from './SharedUI';

export function ListOrRecord({ data, emptyText }: {
  data: string[] | Record<string, unknown> | undefined;
  emptyText?: string;
}) {
  const [selected, setSelected] = useState<{ name: string; fields: [string, string][] } | null>(null);

  if (!data) return <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>{emptyText || '无'}</span>;
  if (Array.isArray(data)) {
    if (data.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>{emptyText || '无'}</span>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {data.map((item, i) => (
          <div key={i} style={{ padding: '3px 0', fontSize: 'var(--font-size-sm)', borderBottom: '1px solid var(--border)' }}>• {item}</div>
        ))}
      </div>
    );
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data);
    if (entries.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>{emptyText || '无'}</span>;

    return (
      <>
        <div className="grid-responsive" style={{ gap: '8px' }}>
          {entries.map(([k, v]) => {
            const isObject = typeof v === 'object' && v !== null;
            const quality = isObject && (v as any).品质 ? (v as any).品质 as string : undefined;
            const desc = isObject && (v as any).描述 ? (v as any).描述 as string : undefined;
            const count = isObject && (v as any).数量 ? (v as any).数量 as number : undefined;
            const qColor = quality ? getQualityColor(quality) : undefined;

            return (
              <div key={k} style={{
                padding: '10px 12px',
                border: `1px solid ${qColor ? qColor + '30' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                background: qColor ? `linear-gradient(135deg, ${qColor}08, ${qColor}03)` : 'var(--bg-primary)',
                cursor: isObject ? 'pointer' : 'default', transition: 'all 0.15s',
              }}
              onClick={() => { if (isObject) setSelected({ name: k, fields: extractFields(v as Record<string, unknown>) }); }}
              onMouseEnter={e => { if (isObject) { e.currentTarget.style.borderColor = qColor || 'var(--accent)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
              onMouseLeave={e => { if (isObject) { e.currentTarget.style.borderColor = qColor ? qColor + '30' : 'var(--border)'; e.currentTarget.style.transform = ''; } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                  {qColor && <span style={{ color: qColor, fontSize: '10px' }}>●</span>}
                  <span style={{ fontWeight: '600', fontSize: 'var(--font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                </div>
                {count !== undefined && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>×{count}</div>}
                {quality && <div style={{ fontSize: 'var(--font-size-xs)', color: qColor }}>{quality}</div>}
                {desc && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</div>}
              </div>
            );
          })}
        </div>
        {selected && <FieldDetailModal name={selected.name} fields={selected.fields} onClose={() => setSelected(null)} />}
      </>
    );
  }
  return null;
}
