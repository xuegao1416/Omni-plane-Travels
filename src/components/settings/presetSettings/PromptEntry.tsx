import { ChevronDown, ChevronRight, ToggleRight, ToggleLeft, Trash2 } from 'lucide-react';
import type { PresetPromptEntry } from '@/data/builtinPresets';
import { Field } from '../SettingsUIComponents';
import { iconBtnStyle, inputStyle, chipStyle } from './constants';

interface PromptEntryProps {
  entry: PresetPromptEntry;
  expanded: boolean;
  builtin: boolean;
  onToggleExpand: () => void;
  onToggle: () => void;
  onUpdate: (patch: Partial<PresetPromptEntry>) => void;
  onDelete: () => void;
}

export function PromptEntry({ entry: p, expanded, builtin, onToggleExpand, onToggle, onUpdate, onDelete }: PromptEntryProps) {
  return (
    <div style={{
      borderRadius: '8px',
      border: '1px solid var(--border)',
      background: p.enabled ? 'var(--bg-secondary)' : 'var(--bg-primary)',
      opacity: p.enabled ? 1 : 0.55,
    }}>
      {/* 条目头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px', cursor: 'pointer',
      }} onClick={onToggleExpand}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ flex: 1, fontWeight: '500', fontSize: 'var(--font-size-sm)' }}>{p.name}</span>

        {/* 蓝灯/绿灯指示 */}
        <span style={{
          fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: '4px',
          background: p.triggerMode === 'green' ? 'var(--success-dim)' : 'var(--accent-dim)',
          color: p.triggerMode === 'green' ? 'var(--success)' : 'var(--accent)',
        }}>
          {p.triggerMode === 'green' ? '🟢 关键词' : '🔵 常驻'}
        </span>

        {/* 启用/禁用 */}
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }} style={iconBtnStyle}>
          {p.enabled ? <ToggleRight size={16} color="var(--accent)" /> : <ToggleLeft size={16} />}
        </button>
        {!builtin && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ ...iconBtnStyle, color: 'var(--danger)' }} title="删除条目">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* 条目展开 */}
      {expanded && (
        <div style={{ padding: '8px 12px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Field label="标识符">
            <input className="input-field" style={inputStyle} value={p.identifier} disabled />
          </Field>
          <Field label="显示名称">
            <input className="input-field" style={inputStyle} value={p.name} disabled={builtin} onChange={e => onUpdate({ name: e.target.value })} />
          </Field>

          {/* 角色 */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>角色：</span>
            {(['system', 'user', 'assistant'] as const).map(r => (
              <button
                key={r}
                disabled={builtin}
                onClick={() => onUpdate({ role: r })}
                style={{
                  ...chipStyle,
                  background: p.role === r ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: p.role === r ? '#fff' : 'var(--text-secondary)',
                }}
              >{r}</button>
            ))}
          </div>

          {/* 触发模式 */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>触发模式：</span>
            <button
              disabled={builtin}
              onClick={() => onUpdate({ triggerMode: 'blue' })}
              style={{
                ...chipStyle,
                background: p.triggerMode !== 'green' ? 'var(--accent)' : 'var(--bg-tertiary)',
                color: p.triggerMode !== 'green' ? '#fff' : 'var(--text-secondary)',
              }}
            >🔵 常驻</button>
            <button
              disabled={builtin}
              onClick={() => onUpdate({ triggerMode: 'green' })}
              style={{
                ...chipStyle,
                background: p.triggerMode === 'green' ? 'var(--success)' : 'var(--bg-tertiary)',
                color: p.triggerMode === 'green' ? '#fff' : 'var(--text-secondary)',
              }}
            >🟢 关键词</button>
          </div>

          {/* 排序权重 */}
          <Field label="排序权重（越小越靠前）">
            <input className="input-field" style={{ ...inputStyle, width: '100px' }} type="number" value={p.order} disabled={builtin} onChange={e => onUpdate({ order: Number(e.target.value) })} />
          </Field>

          {/* 内容预览/编辑 */}
          <Field label="内容">
            <textarea
              className="input-field"
              style={{ ...inputStyle, fontFamily: 'monospace', minHeight: '120px', resize: 'vertical', fontSize: 'var(--font-size-xs)' }}
              value={p.content}
              disabled={builtin}
              onChange={e => onUpdate({ content: e.target.value })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
