import type { ReactNode } from 'react';

export function PanelCard({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return <section style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
    <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'center', marginBottom:8 }}>
      <strong style={{ fontSize:'var(--font-size-sm)', color:'var(--text-primary)' }}>{title}</strong>{right}
    </div>
    {children}
  </section>;
}

export function StatusPill({ children }: { children: ReactNode }) {
  return <span style={{ padding:'2px 7px', borderRadius:99, border:'1px solid var(--border)', background:'var(--bg-tertiary)', fontSize:'11px', color:'var(--text-secondary)' }}>{children}</span>;
}

export function EmptyLine({ text }: { text: string }) {
  return <div style={{ padding:'18px 8px', textAlign:'center', color:'var(--text-muted)', fontSize:'var(--font-size-sm)' }}>{text}</div>;
}
