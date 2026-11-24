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

export function extractFields(obj: Record<string, unknown>): [string, string][] {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([fk, fv]) => [fk, typeof fv === 'object' ? JSON.stringify(fv) : String(fv)]);
}

export function FieldDetailModal({ name, fields, onClose }: {
  name: string; fields: [string, string][]; onClose: () => void;
}) {
  return (
    <div className="game-journey__nested-overlay" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div className="game-journey__nested-panel" onClick={e => e.stopPropagation()} style={{
        padding: '20px', maxWidth: '360px', width: '90%',
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
