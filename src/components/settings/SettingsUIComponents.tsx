export function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        marginBottom: '10px', fontWeight: '600', fontSize: 'var(--font-size-md)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}>{icon}</span>{title}
      </div>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  );
}

export function SettingRow({ label, desc, children, stacked }: { label: string; desc?: string; children: React.ReactNode; stacked?: boolean }) {
  // 纵向堆叠模式 — 用于窄容器（如侧边栏），label 在上、control 在下占满宽度
  if (stacked) {
    return (
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '600', marginBottom: desc ? '2px' : '0', color: 'var(--text-primary)' }}>{label}</div>
        {desc && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: '1.5' }}>{desc}</div>}
        <div style={{ width: '100%' }}>{children}</div>
      </div>
    );
  }
  // 默认横向布局 — label 左、control 右
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '10px 16px',
      borderBottom: '1px solid var(--border)', minHeight: '44px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>{label}</div>
        {desc && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '1px' }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>
        {children}
      </div>
    </div>
  );
}

export function SegmentedControl({ options, value, onChange }: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="segmented-control">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`segmented-control-btn${value === opt.value ? ' active' : ''}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ options, value, onChange, width }: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  width?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="input-field"
      style={{
        padding: '5px 10px',
        width: width || 'auto',
        cursor: 'pointer',
      }}
    >
      {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
    </select>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`toggle-switch${value ? ' on' : ''}`}
      role="switch"
      aria-checked={value}
    >
      <div className="toggle-switch-knob" />
    </button>
  );
}

/* ─── FieldGrid：两列表单网格 ─── */
export function FieldGrid({ children, columns = 2 }: { children: React.ReactNode; columns?: 1 | 2 }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: columns === 2 ? '1fr 1fr' : '1fr',
      gap: '12px', padding: '12px 16px',
    }}>
      {children}
    </div>
  );
}

/* ─── Field：字段组（label + 控件 + hint） ─── */
export function Field({ label, hint, children, span }: {
  label: string; hint?: string; children: React.ReactNode; span?: 1 | 2;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '5px',
      gridColumn: span === 2 ? '1 / -1' : undefined,
    }}>
      <label style={{ fontSize: 'var(--font-size-base)', color: 'var(--text-secondary)', fontWeight: '600' }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '1.5' }}>{hint}</span>}
    </div>
  );
}

/* ─── Collapsible：可折叠区域 ─── */
export function Collapsible({ title, desc, children, defaultOpen = false }: {
  title: string; desc?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} style={{
      gridColumn: '1 / -1',
      border: '1px dashed var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: 0,
    }}>
      <summary style={{
        cursor: 'pointer', padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: '4px',
        userSelect: 'none', color: 'var(--text-primary)',
        fontSize: 'var(--font-size-md)', fontWeight: '600',
      }}>
        {title}
        {desc && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', fontWeight: '400' }}>{desc}</span>}
      </summary>
      <div style={{ padding: '0 14px 10px' }}>
        {children}
      </div>
    </details>
  );
}

/* ─── TextArea：多行文本输入 ─── */
export function TextArea({ value, onChange, placeholder, rows = 6, mono = false }: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; rows?: number; mono?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      spellCheck={false}
      className={`settings-textarea${mono ? ' mono' : ''}`}
    />
  );
}

/* ─── Button：统一按钮 ─── */
export function Button({ children, onClick, primary = false, disabled = false, icon }: {
  children: React.ReactNode; onClick?: () => void;
  primary?: boolean; disabled?: boolean; icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={primary ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
      style={{
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}{children}
    </button>
  );
}

/* ─── Slider：滑块输入 ─── */
export function Slider({ label, value, onChange, min, max, step = 1, unit = '' }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; unit?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: '600' }}>{label}</span>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--accent)', fontWeight: '600' }}>{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: '100%', height: '4px',
          appearance: 'none', WebkitAppearance: 'none',
          background: 'var(--bg-tertiary)',
          borderRadius: '2px', outline: 'none',
          cursor: 'pointer',
        }}
      />
    </div>
  );
}
