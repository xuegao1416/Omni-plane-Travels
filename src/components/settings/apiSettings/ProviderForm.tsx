import type { ApiConfig } from '../../../api/types';
import type { ApiPreset } from '../apiPresetUtils';
import PresetManager from './PresetManager';
import ProxySettings from './ProxySettings';
import AdvancedSettings from './AdvancedSettings';
import { rowStyle } from './types';

interface Props {
  config: ApiConfig;
  set: <K extends keyof ApiConfig>(key: K, val: ApiConfig[K]) => void;
  models: string[];
  setModels: (models: string[]) => void;
  loadingModels: boolean;
  onFetchModels: () => void;
  presets: ApiPreset[];
  setPresets: (presets: ApiPreset[]) => void;
  onLoadPreset: (config: ApiConfig) => void;
}

export default function ProviderForm({
  config, set, models, setModels, loadingModels, onFetchModels,
  presets, setPresets, onLoadPreset,
}: Props) {
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>

      <PresetManager config={config} presets={presets} setPresets={setPresets} onLoadPreset={onLoadPreset} />

      {/* API 端点 */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>API 端点</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '1px' }}>留空则使用官方默认地址</div>
        </div>
        <input
          className="input-field"
          value={config.baseUrl}
          onChange={e => set('baseUrl', e.target.value)}
          placeholder={config.provider === 'google' ? 'https://generativelanguage.googleapis.com' : 'https://api.openai.com'}
          style={{ maxWidth: '220px', width: '100%', minWidth: 0, fontSize: 'var(--font-size-base)', padding: '5px 10px' }}
        />
      </div>

      {/* API 密钥 */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>API 密钥</div>
        </div>
        <input
          className="input-field"
          type="password"
          value={config.apiKey}
          onChange={e => set('apiKey', e.target.value)}
          placeholder="sk-..."
          style={{ maxWidth: '220px', width: '100%', minWidth: 0, fontSize: 'var(--font-size-base)', padding: '5px 10px' }}
        />
      </div>

      <ProxySettings />

      {/* 模型设置 */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)', fontSize: 'var(--font-size-sm)', fontWeight: '600', color: 'var(--text-muted)' }}>
        模型设置
      </div>

      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>模型名称</div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            className="input-field"
            value={config.model}
            onChange={e => set('model', e.target.value)}
            placeholder="gpt-4o"
            style={{ maxWidth: '150px', width: '100%', minWidth: 0, fontSize: 'var(--font-size-base)', padding: '5px 10px' }}
          />
          <button
            onClick={onFetchModels}
            disabled={loadingModels}
            style={{
              padding: '5px 10px', fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap',
              border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer',
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
            }}
          >
            {loadingModels ? '...' : '获取'}
          </button>
        </div>
      </div>

      {models.length > 0 && (
        <div style={{ padding: '8px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {models.map(m => (
            <button
              key={m}
              onClick={() => { set('model', m); setModels([]); }}
              style={{
                padding: '4px 12px', fontSize: 'var(--font-size-sm)', borderRadius: '14px', cursor: 'pointer',
                border: '1px solid var(--border)', background: m === config.model ? 'var(--accent-dim)' : 'var(--bg-primary)',
                color: m === config.model ? 'var(--accent)' : 'var(--text-secondary)',
                fontWeight: m === config.model ? '600' : '400',
                transition: 'all 0.15s',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      <AdvancedSettings config={config} set={set} />
    </div>
  );
}
