import type { CSSProperties } from 'react';

export const iconBtnStyle: CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
  color: 'var(--text-secondary)', display: 'flex', alignItems: 'center',
  borderRadius: '4px',
};

export const inputStyle: CSSProperties = {
  width: '100%', padding: '6px 10px',
  border: '1px solid var(--border)', borderRadius: '6px',
  background: 'var(--bg-primary)', color: 'var(--text-primary)',
  fontSize: 'var(--font-size-sm)',
};

export const chipStyle: CSSProperties = {
  padding: '3px 10px', borderRadius: '12px', border: 'none',
  fontSize: 'var(--font-size-xs)', fontWeight: '500',
  cursor: 'pointer', transition: 'all 0.15s',
};
