// 共享 ToolBtn 已迁移至 src/components/game/shared/
export { default as ToolBtn } from '../shared/ToolBtn';

export function TabBtn({ active, onClick, icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        background: active ? 'var(--accent-dim)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        fontSize: 'var(--font-size-base)', fontWeight: active ? '600' : '400', cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
