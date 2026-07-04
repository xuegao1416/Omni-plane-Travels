import { useState, useCallback } from 'react';
import { Settings, ChevronDown, ChevronRight } from 'lucide-react';
import { loadPresets } from '../../../settings/apiPresetUtils';

interface Props {
  varApiPresetId: string;
  onPresetIdChange: (id: string) => void;
  onSave: () => void;
}

export function ApiSettingsSection({ varApiPresetId, onPresetIdChange, onSave }: Props) {
  const [expanded, setExpanded] = useState(false);
  const apiPresets = loadPresets();

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '10px 16px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)',
        }}
      >
        <Settings size={14} />
        <span>变量提取 API 设置</span>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {varApiPresetId ? (apiPresets.find(p => p.id === varApiPresetId)?.name || '自定义') : '跟随主 API'}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>API 预设</span>
            <select
              value={varApiPresetId}
              onChange={e => onPresetIdChange(e.target.value)}
              className="input-field"
              style={{ width: '160px' }}
            >
              <option value="">跟随主 API</option>
              {apiPresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <button
            onClick={onSave}
            className="btn-primary btn-sm"
            style={{ alignSelf: 'flex-end' }}
          >
            保存设置
          </button>
        </div>
      )}
    </div>
  );
}
