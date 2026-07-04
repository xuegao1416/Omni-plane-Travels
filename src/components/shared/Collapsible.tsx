import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import s from './Collapsible.module.css';

export function Collapsible({ icon, title, count, children, defaultOpen = true }: {
  icon: React.ReactNode; title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={s.wrapper}>
      <div
        role="button" tabIndex={0} aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        className={`${s.header}${open ? ` ${s.headerOpen}` : ''}`}
      >
        <span className={s.icon}>{icon}</span>
        <span className={s.title}>{title}</span>
        {count != null && <span className={s.count}>{count}</span>}
        <ChevronRight size={14} className={`${s.chevron}${open ? ` ${s.chevronOpen}` : ''}`} />
      </div>
      {open && <div className={s.body}>{children}</div>}
    </div>
  );
}
