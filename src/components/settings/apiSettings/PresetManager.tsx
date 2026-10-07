import { useState, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import type { ApiConfig } from '../../../api/types';
import type { ApiPreset } from '../../../api/presets';
import { apiPresetStore, useApiPresets } from '../../../stores/apiPresetStore';
import { rowStyle } from './types';

interface Props {
  config: ApiConfig;
  onLoadPreset: (config: ApiConfig) => void;
}

export default function PresetManager({ config, onLoadPreset }: Props) {
  const [presetName, setPresetName] = useState('');
  const { presets, initialized, error: recoveryError, warning } = useApiPresets();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  const nameRef = useRef(presetName); nameRef.current = presetName;

  const handleSave = async () => {
    if (!presetName.trim() || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError('');
    const capturedName = presetName;
    const preset: ApiPreset = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: presetName.trim(),
      config: { ...config },
      createdAt: Date.now(),
      rateLimitMs: config.rateLimitMs,
    };
    try {
      await apiPresetStore.change(null, preset);
      if (nameRef.current === capturedName) setPresetName('');
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pendingRef.current = false; setPending(false); }
  };

  const handleDelete = async (preset: ApiPreset) => {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError('');
    try { await apiPresetStore.change(preset, null); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { pendingRef.current = false; setPending(false); }
  };

  return (
    <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
      <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '500', color: 'var(--text-secondary)' }}>
        预设配置
      </div>
      {(recoveryError || error || warning) && <div role="alert" style={{ fontSize: 'var(--font-size-sm)' }}>
        {recoveryError || error || warning}
        <button type="button" disabled={pending} onClick={() => { setError(''); void apiPresetStore.reload(); }}>重新读取</button>
      </div>}
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
          disabled={!presetName.trim() || pending || !initialized || !!recoveryError}
          style={{
            padding: '5px 14px', fontSize: 'var(--font-size-base)', whiteSpace: 'nowrap',
            border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer',
            background: presetName.trim() ? 'var(--bg-primary)' : 'var(--bg-tertiary)',
            color: presetName.trim() ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
        >
          {pending ? '保存中…' : '保存当前配置'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {!initialized ? <div>正在读取预设…</div> : presets.length === 0 ? (
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', padding: '4px 0' }}>暂无预设</div>
        ) : (
          presets.map((p, i) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', width: '18px', textAlign: 'right' }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 'var(--font-size-base)', fontWeight: '500' }}>{p.name}</span>
              <button
                disabled={pending || !!recoveryError}
                onClick={() => onLoadPreset(structuredClone(p.config))}
                style={{
                  border: '1px solid var(--border)', borderRadius: '6px', padding: '3px 10px',
                  fontSize: 'var(--font-size-sm)', cursor: 'pointer', background: 'var(--bg-primary)', color: 'var(--text-primary)',
                }}
              >
                加载
              </button>
              <button
                disabled={pending || !!recoveryError}
                aria-label={`删除预设 ${p.name}`}
                onClick={() => handleDelete(p)}
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
