export function Section({ icon, title, children, variant = 'default' }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  variant?: 'default' | 'paper';
}) {
  return (
    <div className={`settings-section${variant === 'paper' ? ' settings-section--paper' : ''}`}>
      <div className="settings-section__title">
        <span className="settings-section__icon">{icon}</span><span className="settings-section__label">{title}</span>
      </div>
      <div className="settings-section__body">
        {children}
      </div>
    </div>
  );
}

export function SettingRow({ label, desc, children, stacked }: { label: string; desc?: string; children: React.ReactNode; stacked?: boolean }) {
  // 纵向堆叠模式 — 用于窄容器（如侧边栏），label 在上、control 在下占满宽度
  if (stacked) {
    return (
      <div className="settings-row settings-row--stacked">
        <div className="settings-row__label">{label}</div>
        {desc && <div className="settings-row__desc">{desc}</div>}
        <div className="settings-row__control">{children}</div>
      </div>
    );
  }
  // 默认横向布局 — label 左、control 右
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <div className="settings-row__label">{label}</div>
        {desc && <div className="settings-row__desc">{desc}</div>}
      </div>
      <div className="settings-row__control">
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
      style={width ? { width } : undefined}
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
    <div className={`settings-field-grid settings-field-grid--${columns}`}>
      {children}
    </div>
  );
}

/* ─── Field：字段组（label + 控件 + hint） ─── */
export function Field({ label, hint, children, span }: {
  label: string; hint?: string; children: React.ReactNode; span?: 1 | 2;
}) {
  return (
    <div className={`settings-field${span === 2 ? ' settings-field--wide' : ''}`}>
      <label className="settings-field__label">{label}</label>
      {children}
      {hint && <span className="settings-field__hint">{hint}</span>}
    </div>
  );
}

/* ─── Collapsible：可折叠区域 ─── */
export function Collapsible({ title, desc, children, defaultOpen = false }: {
  title: string; desc?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="settings-collapsible">
      <summary className="settings-collapsible__summary">
        {title}
        {desc && <span className="settings-collapsible__desc">{desc}</span>}
      </summary>
      <div className="settings-collapsible__body">
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
    <div className="settings-slider">
      <div className="settings-slider__head">
        <span className="settings-slider__label">{label}</span>
        <span className="settings-slider__value">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="settings-slider__input"
      />
    </div>
  );
}
