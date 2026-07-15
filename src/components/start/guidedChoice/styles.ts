import type React from 'react';

export const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-primary)',
  overflow: 'hidden',
};

export const headerBarStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  padding: '1rem 2rem',
  borderBottom: '1px solid var(--border)',
  animation: 'slideUp 0.3s ease',
};

export const closeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  left: '1.5rem',
  border: 'none',
  background: 'var(--bg-secondary)',
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  fontSize: '1rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export const titleStyle: React.CSSProperties = {
  fontSize: '1.4rem',
  fontWeight: 'bold',
  color: 'var(--accent)',
  letterSpacing: '0.05em',
  margin: 0,
};

export const subtitleStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 'var(--font-size-sm)',
  marginTop: '0.2rem',
  margin: 0,
  maxWidth: '400px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const stepIndicatorStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.25rem',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid var(--border)',
  flexWrap: 'wrap',
};

export const centerContentStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
};

export const spinnerStyle: React.CSSProperties = {
  width: '36px',
  height: '36px',
  border: '3px solid var(--border)',
  borderTopColor: 'var(--accent)',
  borderRadius: 'var(--radius-md)',
  animation: 'spin 0.8s linear infinite',
};

export const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
  gap: '0.75rem',
  maxWidth: '960px',
  margin: '0 auto',
  animation: 'slideUp 0.3s ease',
};

export const cardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.75rem',
  padding: '1rem',
  borderRadius: '12px',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'all 0.2s ease',
  position: 'relative',
  overflow: 'hidden',
};

export const bottomBarStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1.5rem',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-primary)',
};

export const navBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.5rem 1rem',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
};

export const primaryBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.5rem 1rem',
  borderRadius: '8px',
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontSize: '0.85rem',
  fontWeight: 500,
};

export const skipBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.5rem 1rem',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-muted)',
  fontSize: '0.85rem',
  cursor: 'pointer',
};

export const customEditAreaStyle: React.CSSProperties = {
  maxWidth: '960px',
  margin: '1rem auto 0',
  padding: '1.25rem',
  borderRadius: '12px',
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
  animation: 'slideUp 0.3s ease',
};

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 500,
  color: 'var(--text-muted)',
  marginBottom: '0.4rem',
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.8rem',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: '0.9rem',
  outline: 'none',
  boxSizing: 'border-box',
};

export const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: '80px',
  fontFamily: 'inherit',
  lineHeight: 1.5,
};

export const secondaryBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.3rem',
  padding: '0.5rem 1rem',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  cursor: 'pointer',
};
