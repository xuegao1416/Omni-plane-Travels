import { useState } from 'react';
import { Backpack } from 'lucide-react';
import { getQualityColor } from '../../../shared/qualityUtils';
import { extractFields, FieldDetailModal } from './SharedUI';

export function InventoryGrid({ data }: { data: Record<string, unknown> | undefined }) {
  const [selected, setSelected] = useState<{ name: string; fields: [string, string][] } | null>(null);
  const entries = data ? Object.entries(data) : [];
  const totalSlots = 48;

  return (
    <>
      <div className="inventory-grid grid-fixed-6" style={{ gap: '4px' }}>
        {Array.from({ length: totalSlots }).map((_, i) => {
          const entry = entries[i];
          if (entry) {
            const [name, value] = entry;
            const isObject = typeof value === 'object' && value !== null;
            const quality = isObject && (value as any).品质 ? (value as any).品质 as string : undefined;
            const count = isObject && (value as any).数量 ? (value as any).数量 as number : undefined;
            const qColor = quality ? getQualityColor(quality) : 'var(--text-muted)';

            return (
              <div key={name} onClick={() => { if (isObject) setSelected({ name, fields: extractFields(value as Record<string, unknown>) }); }} style={{
                aspectRatio: '1', padding: '6px 4px',
                border: `1px solid ${quality ? qColor + '40' : 'var(--border)'}`,
                borderRadius: 'var(--radius-sm)',
                background: quality ? `linear-gradient(135deg, ${qColor}08, ${qColor}03)` : 'var(--bg-primary)',
                cursor: isObject ? 'pointer' : 'default', transition: 'all 0.12s',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                position: 'relative', minWidth: 0,
              }}
              onMouseEnter={e => { if (isObject) e.currentTarget.style.borderColor = qColor; }}
              onMouseLeave={e => { if (isObject) e.currentTarget.style.borderColor = quality ? qColor + '40' : 'var(--border)'; }}
              >
                {count && count > 1 && (
                  <span style={{ position: 'absolute', top: '2px', right: '3px', fontSize: '9px', fontWeight: '700', color: qColor, lineHeight: 1 }}>×{count}</span>
                )}
                <Backpack size={16} color={qColor} />
                <div style={{ fontSize: '9px', fontWeight: '500', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center' }}>{name}</div>
              </div>
            );
          }
          return <div key={`empty-${i}`} style={{ aspectRatio: '1', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-primary)' }} />;
        })}
      </div>
      {selected && <FieldDetailModal name={selected.name} fields={selected.fields} onClose={() => setSelected(null)} />}
    </>
  );
}
