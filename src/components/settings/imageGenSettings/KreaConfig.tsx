// Krea 引擎配置 — API Key、模型选择、参数配置
import { useState, useCallback } from 'react';
import {
  Field,
  Select,
  Button,
} from '../SettingsUIComponents';
import {
  KREA_MODELS,
  KREA_ASPECT_RATIOS,
  KREA_RESOLUTIONS,
  KREA_CREATIVITY_LEVELS,
} from '@/api/imageGenTypes';
import { fetchKreaModels } from '@/api/imageGen';
import type { ConfigSectionProps } from './types';

const kreaModelOptions = Object.entries(KREA_MODELS).map(([value, info]) => ({
  label: info.label,
  value,
}));

export default function KreaConfig({ config, updateConfig }: ConfigSectionProps) {
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
      const modelList = await fetchKreaModels(config.kreaApiKey);
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
  }, [config.kreaApiKey]);

  const handleSelectModel = useCallback((modelId: string) => {
    updateConfig('kreaModel', modelId);
    setShowModelList(false);
  }, [updateConfig]);

  return (
    <>
      {/* API Key */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="Krea API Key" hint="在 krea.ai/settings/api 获取">
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="input-field"
              type={showApiKey ? 'text' : 'password'}
              style={{ flex: 1, padding: '6px 10px' }}
              value={config.kreaApiKey}
              onChange={(e) => updateConfig('kreaApiKey', e.target.value)}
              placeholder="sk-..."
            />
            <Button onClick={() => setShowApiKey(!showApiKey)}>{showApiKey ? '隐藏' : '显示'}</Button>
          </div>
        </Field>
      </div>

      {/* 模型选择 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="模型" hint="可手动输入，也可点击「获取列表」从 API 获取">
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Select
              options={kreaModelOptions}
              value={config.kreaModel}
              onChange={(v) => updateConfig('kreaModel', v)}
              width="100%"
            />
            <Button
              onClick={handleFetchModels}
              disabled={isLoadingModels || !config.kreaApiKey}
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

          {/* 从 API 获取的模型列表 */}
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
                    background: config.kreaModel === modelId ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: '13px',
                    color: 'var(--text)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (config.kreaModel !== modelId) {
                      e.currentTarget.style.background = 'var(--surface)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (config.kreaModel !== modelId) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  {modelId}
                  {config.kreaModel === modelId && (
                    <span style={{ marginLeft: '8px', color: 'var(--primary)' }}>✓ 当前选择</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Field>
      </div>

      {/* 宽高比 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="宽高比">
          <Select
            options={KREA_ASPECT_RATIOS}
            value={config.kreaAspectRatio}
            onChange={(v) => updateConfig('kreaAspectRatio', v)}
            width="100%"
          />
        </Field>
      </div>

      {/* 分辨率 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="分辨率">
          <Select
            options={KREA_RESOLUTIONS}
            value={config.kreaResolution}
            onChange={(v) => updateConfig('kreaResolution', v)}
            width="100%"
          />
        </Field>
      </div>

      {/* 创意度 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <Field label="创意度" hint="控制生成结果的创意程度">
          <Select
            options={KREA_CREATIVITY_LEVELS}
            value={config.kreaCreativity}
            onChange={(v) => updateConfig('kreaCreativity', v)}
            width="100%"
          />
        </Field>
      </div>
    </>
  );
}
