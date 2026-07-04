import React from 'react';

export default function DropdownItem({ icon, label, disabled, onClick }: {
  icon: React.ReactNode; label: string; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        padding: '8px 12px', border: 'none', background: 'none',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        fontSize: 'var(--font-size-sm)', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, textAlign: 'left',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
    >
      {icon} {label}
    </button>
  );
}
