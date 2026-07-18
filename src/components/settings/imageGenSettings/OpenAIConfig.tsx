// OpenAI 兼容引擎配置 — 服务商选择、API 地址、API Key、模型
import { useState, useCallback } from 'react';
import {
  Field,
  Select,
  Button,
} from '../SettingsUIComponents';
import { OPENAI_COMPATIBLE_IMAGE_PROVIDERS } from '@/api/imageGenTypes';
import { fetchOpenAICompatibleModels } from '@/api/imageGen';
import type { ConfigSectionProps } from './types';

const openaiProviderOptions = Object.entries(OPENAI_COMPATIBLE_IMAGE_PROVIDERS).map(([value, info]) => ({
  label: info.label,
  value,
}));

export default function OpenAIConfig({ config, updateConfig }: ConfigSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showModelList, setShowModelList] = useState(false);

  const handleFetchModels = useCallback(async () => {
    setIsLoadingModels(true);
    setModelsError(null);
    setModels([]);

    try {
      const modelList = await fetchOpenAICompatibleModels(config);
      setModels(modelList);
      setShowModelList(true);
      if (modelList.length === 0) {
        setModelsError('未找到可用模型');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setModelsError(errMsg);
    } finally {
      setIsLoadingModels(false);
    }
  }, [config]);

  const handleSelectModel = useCallback((modelId: string) => {
    updateConfig('openaiCompatibleModel', modelId);
    setShowModelList(false);
  }, [updateConfig]);

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
        <Field label="模型" hint="可手动输入，也可点击「获取列表」自动获取">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              className="input-field"
              style={{ flex: 1, padding: '6px 10px' }}
              value={config.openaiCompatibleModel}
              onChange={(e) => updateConfig('openaiCompatibleModel', e.target.value)}
              placeholder={OPENAI_COMPATIBLE_IMAGE_PROVIDERS[config.openaiCompatibleProvider]?.modelPlaceholder || 'your-image-model'}
            />
            <Button
              onClick={handleFetchModels}
              disabled={isLoadingModels || !config.openaiCompatibleApiUrl || !config.openaiCompatibleApiKey}
            >
              {isLoadingModels ? '获取中...' : '获取列表'}
            </Button>
          </div>

          {/* 错误提示 */}
          {modelsError && (
            <div style={{
              marginTop: '8px',
              padding: '8px 12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '6px',
              color: '#ef4444',
              fontSize: '13px',
            }}>
              ❌ {modelsError}
            </div>
          )}

          {/* 模型列表 */}
          {showModelList && models.length > 0 && (
            <div style={{
              marginTop: '8px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              maxHeight: '200px',
              overflowY: 'auto',
            }}>
              <div style={{
                padding: '8px 12px',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--border)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <span>找到 {models.length} 个模型，点击选择</span>
                <button
                  onClick={() => setShowModelList(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    fontSize: '16px',
                  }}
                >
                  ✕
                </button>
              </div>
              {models.map((modelId) => (
                <button
                  key={modelId}
                  onClick={() => handleSelectModel(modelId)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 12px',
                    background: config.openaiCompatibleModel === modelId ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '13px',
                    color: 'var(--text)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (config.openaiCompatibleModel !== modelId) {
                      e.currentTarget.style.background = 'var(--surface)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (config.openaiCompatibleModel !== modelId) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {modelId}
                  {config.openaiCompatibleModel === modelId && (
                    <span style={{ marginLeft: '8px', color: 'var(--primary)' }}>✓ 当前选择</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Field>
      </div>
    </>
  );
}
