import { FileText, Download, Trash2 } from 'lucide-react';
import type { PresetCardProps } from './types';
import { iconBtnStyle } from './constants';

export function PresetCard({ name, desc, promptCount, regexCount, active, builtin, onSelect, onExport, onDelete, onEdit }: PresetCardProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '12px 14px', borderRadius: '10px',
      border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
      background: active ? 'var(--accent-dim, rgba(234,179,8,0.08))' : 'var(--bg-secondary)',
      cursor: 'pointer', transition: 'border-color 0.15s',
    }} onClick={onSelect}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)' }}>
          {active && <span style={{ color: 'var(--accent)', marginRight: '6px' }}>●</span>}
          {name}
        </div>
        {desc && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</div>}
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', gap: '12px' }}>
          <span>📝 {promptCount} 条目</span>
          <span>🔧 {regexCount} 正则</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        <button onClick={(e) => { e.stopPropagation(); onEdit(); }} style={iconBtnStyle} title="编辑">
          <FileText size={14} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onExport(); }} style={iconBtnStyle} title="导出">
          <Download size={14} />
        </button>
        {onDelete && (
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ ...iconBtnStyle, color: 'var(--danger)' }} title="删除">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
