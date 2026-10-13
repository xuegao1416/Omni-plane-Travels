import { useState, type ReactNode } from 'react';

/** Build editing controls only while their section is expanded. */
export function DirectorDetails({ summary, children, className, defaultOpen = false }: {
  summary: ReactNode; children: () => ReactNode; className?: string; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className={className} open={open} onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
  }}><summary>{summary}</summary>{open && children()}</details>;
}
