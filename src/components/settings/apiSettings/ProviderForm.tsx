import type { ApiConfig } from '../../../api/types';
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
  onLoadPreset: (config: ApiConfig) => void;
  proxyUrl: string;
  onProxyChange: (value: string) => void;
}

export default function ProviderForm({
  config, set, models, setModels, loadingModels, onFetchModels,
  onLoadPreset, proxyUrl, onProxyChange,
}: Props) {
  const endpointPlaceholder = config.provider === 'deepseek'
    ? 'https://api.deepseek.com/beta'
    : config.provider === 'google'
      ? 'https://generativelanguage.googleapis.com'
      : config.provider === 'openai' ? 'https://api.openai.com' : '填写服务商提供的 API 地址';
  const endpointHint = config.provider === 'deepseek'
    ? '留空连接 DeepSeek 官方；第三方站点的密钥需要填写该站点提供的 API 地址。'
    : '填写服务商提供的 API 地址；密钥与地址须属于同一服务商。';

  return (
    <div className="settings-api-form">

      <PresetManager config={config} onLoadPreset={onLoadPreset} />

      {/* API 端点 */}
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>API 端点</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '1px' }}>
            {endpointHint}填到 /chat/completions 结尾则原样使用，不再自动补全。
          </div>
        </div>
        <input
          className="input-field"
          value={config.baseUrl}
          onChange={e => set('baseUrl', e.target.value)}
          placeholder={endpointPlaceholder}
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

      <ProxySettings proxyUrl={proxyUrl} onChange={onProxyChange} />

      {/* 模型设置 */}
      <div className="settings-api-section-title">
        模型设置
      </div>

      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '500' }}>模型名称</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px' }}>
            可手动填写；部分 DeepSeek 公益站不开放模型列表
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', minWidth: 0, maxWidth: '100%' }}>
          <input
            className="input-field"
            value={config.model}
            onChange={e => set('model', e.target.value)}
            placeholder={config.provider === 'deepseek' ? 'deepseek-flash' : config.provider === 'openai' ? 'gpt-4o' : '填写模型名称'}
            style={{ maxWidth: '150px', width: '100%', minWidth: 0, fontSize: 'var(--font-size-base)', padding: '5px 10px' }}
          />
          <button
            onClick={onFetchModels}
            disabled={loadingModels}
            style={{
              padding: '5px 10px', fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', flexShrink: 0,
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
