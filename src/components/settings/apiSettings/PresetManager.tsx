import { useState, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import type { ApiConfig } from '../../../api/types';
import type { ApiPreset } from '../apiPresetUtils';
import { savePresets } from '../apiPresetUtils';
import { rowStyle } from './types';

interface Props {
  config: ApiConfig;
  presets: ApiPreset[];
  setPresets: (presets: ApiPreset[]) => void;
  onLoadPreset: (config: ApiConfig) => void;
}

export default function PresetManager({ config, presets, setPresets, onLoadPreset }: Props) {
  const [presetName, setPresetName] = useState('');

  const handleSave = useCallback(() => {
    if (!presetName.trim()) return;
    const preset: ApiPreset = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: presetName.trim(),
      config: { ...config },
      createdAt: Date.now(),
      rateLimitMs: config.rateLimitMs,
    };
    const next = [...presets, preset];
    setPresets(next);
    savePresets(next);
    setPresetName('');
  }, [presetName, config, presets, setPresets]);

  const handleDelete = useCallback((id: string) => {
    const next = presets.filter(p => p.id !== id);
    setPresets(next);
    savePresets(next);
  }, [presets, setPresets]);

  return (
    <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
      <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '500', color: 'var(--text-secondary)' }}>
        预设配置
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          className="input-field"
          value={presetName}
          onChange={e => setPresetName(e.target.value)}
          placeholder="预设名称"
          style={{ flex: 1, fontSize: 'var(--font-size-base)', padding: '5px 10px' }}
        />
        <button
          onClick={handleSave}
          disabled={!presetName.trim()}
          style={{
            padding: '5px 14px', fontSize: 'var(--font-size-base)', whiteSpace: 'nowrap',
            border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer',
            background: presetName.trim() ? 'var(--bg-primary)' : 'var(--bg-tertiary)',
            color: presetName.trim() ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
        >
          保存当前配置
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {presets.length === 0 ? (
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', padding: '4px 0' }}>暂无预设</div>
        ) : (
          presets.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', width: '18px', textAlign: 'right' }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 'var(--font-size-base)', fontWeight: '500' }}>{p.name}</span>
              <button
                onClick={() => onLoadPreset(p.config)}
                style={{
                  border: '1px solid var(--border)', borderRadius: '6px', padding: '3px 10px',
                  fontSize: 'var(--font-size-sm)', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-primary)',
                }}
              >
                加载
              </button>
              <button
                onClick={() => handleDelete(p.id)}
                style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
