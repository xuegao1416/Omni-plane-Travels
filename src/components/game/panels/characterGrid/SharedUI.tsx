import type { LucideIcon } from 'lucide-react';

export function TagList({ items, accent }: { items: string[]; accent?: boolean }) {
  if (!items || items.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>无</span>;
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {items.map((t, i) => (
        <span key={i} style={{
          padding: '2px 10px', borderRadius: '12px', fontSize: 'var(--font-size-sm)',
          background: accent ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
          color: accent ? 'var(--accent)' : 'var(--text-secondary)',
        }}>{t}</span>
      ))}
    </div>
  );
}

export function RecordGrid({ data, label }: { data: Record<string, unknown> | undefined; label?: string }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div>
      {label && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {Object.entries(data).map(([k, v]) => (
          <span key={k} style={{
            padding: '3px 10px', borderRadius: '6px', fontSize: 'var(--font-size-sm)',
            background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
          }}>
            {k}: <strong style={{ color: 'var(--text-primary)' }}>{String(v)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontWeight: '600', fontSize: 'var(--font-size-base)' }}>
        <Icon size={15} strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />{title}
      </div>
      {children}
    </div>
  );
}

export function extractFields(obj: Record<string, unknown>): [string, string][] {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([fk, fv]) => [fk, typeof fv === 'object' ? JSON.stringify(fv) : String(fv)]);
}

export function FieldDetailModal({ name, fields, onClose }: {
  name: string; fields: [string, string][]; onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '20px', maxWidth: '360px', width: '90%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <span style={{ fontWeight: '700', fontSize: 'var(--font-size-lg)' }}>{name}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px', padding: '4px', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {fields.map(([fk, fv]) => (
            <div key={fk} style={{ display: 'flex', gap: '8px', fontSize: 'var(--font-size-sm)' }}>
              <span style={{ color: 'var(--text-muted)', minWidth: '56px', flexShrink: 0 }}>{fk}</span>
              <span style={{ color: 'var(--text-primary)', lineHeight: '1.5', wordBreak: 'break-all' }}>{fv}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
