// OpenAI 兼容引擎配置 — 服务商选择、API 地址、API Key、模型
import { useState } from 'react';
import {
  Field,
  Select,
  Button,
} from '../SettingsUIComponents';
import { OPENAI_COMPATIBLE_IMAGE_PROVIDERS } from '@/api/imageGenTypes';
import type { ConfigSectionProps } from './types';

const openaiProviderOptions = Object.entries(OPENAI_COMPATIBLE_IMAGE_PROVIDERS).map(([value, info]) => ({
  label: info.label,
  value,
}));

export default function OpenAIConfig({ config, updateConfig }: ConfigSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <>
      {/* 服务商选择 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="服务商" hint="切换服务商会自动填入默认兼容地址">
          <Select
            options={openaiProviderOptions}
            value={config.openaiCompatibleProvider}
            onChange={(v) => {
              updateConfig('openaiCompatibleProvider', v);
              const providerInfo = OPENAI_COMPATIBLE_IMAGE_PROVIDERS[v];
              if (providerInfo?.defaultApiUrl && !config.openaiCompatibleApiUrl) {
                updateConfig('openaiCompatibleApiUrl', providerInfo.defaultApiUrl);
              }
              if (providerInfo?.modelPlaceholder && !config.openaiCompatibleModel) {
                updateConfig('openaiCompatibleModel', providerInfo.modelPlaceholder);
              }
            }}
            width="100%"
          />
        </Field>
      </div>

      {/* API 地址 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="兼容 API 地址" hint="填写基础地址即可，发送请求时会自动补到 /images/generations">
          <input
            className="input-field"
            style={{ width: '100%', padding: '6px 10px' }}
            value={config.openaiCompatibleApiUrl}
            onChange={(e) => updateConfig('openaiCompatibleApiUrl', e.target.value)}
            placeholder={OPENAI_COMPATIBLE_IMAGE_PROVIDERS[config.openaiCompatibleProvider]?.defaultApiUrl || 'https://api.example.com/v1'}
          />
        </Field>
      </div>

      {/* API Key */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="兼容 API Key">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="input-field"
              type={showApiKey ? 'text' : 'password'}
              style={{ flex: 1, padding: '6px 10px' }}
              value={config.openaiCompatibleApiKey}
              onChange={(e) => updateConfig('openaiCompatibleApiKey', e.target.value)}
              placeholder="sk-..."
            />
            <Button onClick={() => setShowApiKey(!showApiKey)}>{showApiKey ? '隐藏' : '显示'}</Button>
          </div>
        </Field>
      </div>

      {/* 模型 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="模型">
          <input
            className="input-field"
            style={{ width: '100%', padding: '6px 10px' }}
            value={config.openaiCompatibleModel}
            onChange={(e) => updateConfig('openaiCompatibleModel', e.target.value)}
            placeholder={OPENAI_COMPATIBLE_IMAGE_PROVIDERS[config.openaiCompatibleProvider]?.modelPlaceholder || 'your-image-model'}
          />
        </Field>
      </div>
    </>
  );
}
