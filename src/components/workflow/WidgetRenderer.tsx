// ============================================================
//  Widget 渲染器 — 根据 WidgetConfig 渲染内联编辑器
// ============================================================
import type { WidgetConfig } from '../../modules/workflowSchema';
import WhenPathSelect from '../event/WhenPathSelect';
import ResourceKeySelect from '../event/ResourceKeySelect';
import EventIdSelect from '../event/EventIdSelect';
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';

interface WidgetRendererProps {
  widget: WidgetConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  gameState?: GameState;
  worldDef?: WorldDef;
  eventPackId?: string;
}

const inputStyle: React.CSSProperties = {
  padding: '2px 4px',
  minHeight: 20,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: '9px',
  fontFamily: 'var(--font-body)',
  width: '100%',
  boxSizing: 'border-box',
};

const COMPARATORS = ['==', '!=', '>', '>=', '<', '<=', 'in', 'contains'];
const MATH_OPS = [
  { label: '+ 加', value: 'add' },
  { label: '- 减', value: 'sub' },
  { label: '× 乘', value: 'mul' },
  { label: '÷ 除', value: 'div' },
  { label: '% 取余', value: 'mod' },
  { label: 'min', value: 'min' },
  { label: 'max', value: 'max' },
];

export default function WidgetRenderer({
  widget, value, onChange, disabled, gameState, worldDef, eventPackId,
}: WidgetRendererProps) {
  switch (widget.type) {
    case 'number':
      return (
        <input
          type="number"
          value={value != null ? Number(value) : ''}
          onChange={(e) => onChange(Number(e.target.value))}
          min={widget.min}
          max={widget.max}
          step={widget.step ?? 1}
          placeholder={widget.placeholder}
          disabled={disabled}
          style={inputStyle}
        />
      );

    case 'string':
      return widget.multiline ? (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={widget.placeholder}
          disabled={disabled}
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      ) : (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={widget.placeholder}
          disabled={disabled}
          style={inputStyle}
        />
      );

    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
          />
          {widget.label}
        </label>
      );

    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={inputStyle}
        >
          <option value="">未选择</option>
          {(widget.options ?? []).map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
          ))}
        </select>
      );

    case 'comparator':
      return (
        <select
          value={String(value ?? '>=')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={inputStyle}
        >
          {COMPARATORS.map((op) => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
      );

    case 'math_op':
      return (
        <select
          value={String(value ?? 'add')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={inputStyle}
        >
          {MATH_OPS.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
      );

    case 'path_select':
      return (
        <WhenPathSelect
          value={String(value ?? '')}
          onChange={(v) => onChange(v)}
          worldDef={worldDef}
        />
      );

    case 'resource_key':
      return (
        <ResourceKeySelect
          value={String(value ?? '')}
          gameState={gameState}
          worldDef={worldDef}
          onChange={(v) => onChange(v)}
        />
      );

    case 'stat_key':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={inputStyle}
        >
          <option value="">未选择</option>
          {['attrA', 'attrB', 'dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'].map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      );

    case 'event_id':
      return (
        <EventIdSelect
          value={String(value ?? '')}
          eventPackId={eventPackId}
          worldDef={worldDef}
          onChange={(v) => onChange(v)}
        />
      );

    case 'event_type':
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={widget.placeholder ?? '事件类型'}
          disabled={disabled}
          style={inputStyle}
          list="event-type-suggestions"
        />
      );

    case 'npc_select':
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="NPC 名称"
          disabled={disabled}
          style={inputStyle}
        />
      );

    case 'json':
      return (
        <textarea
          value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)); } catch { onChange(e.target.value); }
          }}
          placeholder={widget.placeholder}
          disabled={disabled}
          rows={3}
          style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
        />
      );

    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={inputStyle}
        />
      );
  }
}
