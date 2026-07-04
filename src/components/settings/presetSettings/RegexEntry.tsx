import { ChevronDown, ChevronRight, Eye, EyeOff, Trash2 } from 'lucide-react';
import type { RegexScript } from '@/utils/regexScripts';
import { Field } from '../SettingsUIComponents';
import { iconBtnStyle, inputStyle, chipStyle } from './constants';

interface RegexEntryProps {
  script: RegexScript;
  expanded: boolean;
  builtin: boolean;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<RegexScript>) => void;
  onDelete: () => void;
}

export function RegexEntry({ script, expanded, builtin, onToggleExpand, onUpdate, onDelete }: RegexEntryProps) {
  return (
    <div style={{
      borderRadius: '8px', border: '1px solid var(--border)',
      background: script.disabled ? 'var(--bg-primary)' : 'var(--bg-secondary)',
      opacity: script.disabled ? 0.55 : 1,
    }}>
      {/* 正则头部 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px', cursor: 'pointer',
      }} onClick={onToggleExpand}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ flex: 1, fontWeight: '500', fontSize: 'var(--font-size-sm)', fontFamily: 'monospace' }}>
          {script.scriptName}
        </span>

        {/* 通道标记 */}
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {script.markdownOnly ? '显示' : script.promptOnly ? 'API' : '全部'}
        </span>

        {!builtin && (
          <>
            <button onClick={(e) => { e.stopPropagation(); onUpdate({ disabled: !script.disabled }); }} style={iconBtnStyle}>
              {script.disabled ? <EyeOff size={14} /> : <Eye size={14} color="var(--accent)" />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ ...iconBtnStyle, color: 'var(--danger)' }}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      {/* 正则展开 */}
      {expanded && (
        <div style={{ padding: '8px 12px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Field label="名称">
            <input className="input-field" style={inputStyle} value={script.scriptName} disabled={builtin} onChange={e => onUpdate({ scriptName: e.target.value })} />
          </Field>
          <Field label="匹配正则">
            <input className="input-field" style={{ ...inputStyle, fontFamily: 'monospace' }} value={script.findRegex} disabled={builtin} onChange={e => onUpdate({ findRegex: e.target.value })} placeholder="/pattern/flags 或裸模式" />
          </Field>
          <Field label="替换内容">
            <textarea className="input-field" style={{ ...inputStyle, fontFamily: 'monospace', minHeight: '60px', resize: 'vertical' }} value={script.replaceString} disabled={builtin} onChange={e => onUpdate({ replaceString: e.target.value })} placeholder="支持 $1..$N" />
          </Field>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>通道：</span>
            <button disabled={builtin} onClick={() => onUpdate({ markdownOnly: false, promptOnly: false })} style={{ ...chipStyle, background: (!script.markdownOnly && !script.promptOnly) ? 'var(--accent)' : 'var(--bg-tertiary)', color: (!script.markdownOnly && !script.promptOnly) ? '#fff' : 'var(--text-secondary)' }}>全部</button>
            <button disabled={builtin} onClick={() => onUpdate({ markdownOnly: true, promptOnly: false })} style={{ ...chipStyle, background: script.markdownOnly ? 'var(--accent)' : 'var(--bg-tertiary)', color: script.markdownOnly ? '#fff' : 'var(--text-secondary)' }}>仅显示</button>
            <button disabled={builtin} onClick={() => onUpdate({ promptOnly: true, markdownOnly: false })} style={{ ...chipStyle, background: script.promptOnly ? 'var(--accent)' : 'var(--bg-tertiary)', color: script.promptOnly ? '#fff' : 'var(--text-secondary)' }}>仅API</button>
          </div>
        </div>
      )}
    </div>
  );
}
