// ============================================================
//  卡片节点内联 Widget 渲染器
//  根据 widgetConfig 类型渲染对应的编辑控件
// ============================================================
import type { CardWidgetConfig } from '../../modules/schema';
import StatIdSelect from '../event/StatIdSelect';
import ResourceKeySelect from '../event/ResourceKeySelect';
import WhenPathSelect from '../event/WhenPathSelect';

interface Props {
  config: CardWidgetConfig;
  value: unknown;
  onChange: (value: unknown) => void;
}

export default function CardWidgetRenderer({ config, value, onChange }: Props) {
  const style: React.CSSProperties = {
    width: '100%',
    padding: '4px 6px',
    fontSize: 'var(--font-size-xs)',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
  };

  switch (config.type) {
    case 'number':
      return (
        <input
          type="number"
          value={value as number ?? 0}
          min={config.min}
          max={config.max}
          step={config.step ?? 1}
          placeholder={config.placeholder}
          onChange={(e) => onChange(Number(e.target.value))}
          style={style}
        />
      );

    case 'string':
      return config.multiline ? (
        <textarea
          value={String(value ?? '')}
          placeholder={config.placeholder}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...style, resize: 'vertical' }}
        />
      ) : (
        <input
          type="text"
          value={String(value ?? '')}
          placeholder={config.placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={style}
        />
      );

    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)' }}>
          <input
            type="checkbox"
            checked={Boolean(value ?? false)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {config.label}
        </label>
      );

    case 'select':
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={style}
        >
          {config.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );

    case 'stat_key':
      return (
        <StatIdSelect
          value={String(value ?? '')}
          onChange={(v) => onChange(v)}
        />
      );

    case 'resource_key':
      return (
        <ResourceKeySelect
          value={String(value ?? '')}
          onChange={(v) => onChange(v)}
        />
      );

    case 'path_select':
      return (
        <WhenPathSelect
          value={String(value ?? '')}
          onChange={(v) => onChange(v)}
        />
      );

    case 'json':
      return (
        <textarea
          value={typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2)}
          placeholder={config.placeholder}
          rows={4}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...style, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
        />
      );

    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={style}
        />
      );
  }
}
