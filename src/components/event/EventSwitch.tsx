interface EventSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

/** 无依赖的轻量开关；颜色全部走 Token，动画 ≤ fast，支持键盘与 disabled */
export default function EventSwitch({ checked, onChange, disabled, label }: EventSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="event-switch"
      style={{
        width: '40px',
        height: '22px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: checked ? 'var(--accent)' : 'var(--bg-tertiary)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        flexShrink: 0,
        transition: 'background var(--duration-fast) var(--ease-out)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: checked ? '20px' : '2px',
          width: '16px',
          height: '16px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-on-accent)',
          boxShadow: 'var(--shadow-xs)',
          transition: 'left var(--duration-fast) var(--ease-out)',
        }}
      />
    </button>
  );
}
