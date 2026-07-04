import { pillStyle } from './constants';

export function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={pillStyle}>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>{label}</span>
      <strong style={{ fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>{value}</strong>
    </div>
  );
}
