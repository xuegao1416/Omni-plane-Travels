interface EventSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}

/** Event-centre switch; drawn by the shared planar `.toggle-switch` (brass slot, jewel knob). */
export default function EventSwitch({ checked, onChange, disabled, label }: EventSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`event-switch toggle-switch${checked ? ' on' : ''}`}
    >
      <span className="toggle-switch-knob" />
    </button>
  );
}
