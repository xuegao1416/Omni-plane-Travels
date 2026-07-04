// ============================================================
// 向量化设置面板 — 使用共享组件重写
// ============================================================

import { useState, useCallback } from 'react';
import { RefreshCw, AlertTriangle, Database } from 'lucide-react';
import type { MemorySystemConfig } from '../../../memory/types';
import type { ApiPreset } from '../apiPresetUtils';
import { fetchModels } from '../../../api/client';
import { Section, FieldGrid, Field, Select, Toggle } from '../SettingsUIComponents';

interface Props {
  config: MemorySystemConfig;
  apiPresets: ApiPreset[];
  onUpdate: (patch: Record<string, unknown>) => void;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', outline: 'none',
  width: '100%', transition: 'border-color 0.15s, box-shadow 0.15s',
};

function StyledInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      style={{ ...inputStyle, ...props.style }}
      onFocus={e => {
        e.target.style.borderColor = 'var(--accent)';
        e.target.style.boxShadow = '0 0 0 3px var(--accent-dim)';
        props.onFocus?.(e);
      }}
      onBlur={e => {
        e.target.style.borderColor = 'var(--border)';
        e.target.style.boxShadow = 'none';
        props.onBlur?.(e);
      }}
    />
  );
}

export function VectorConfigPanel({ config, apiPresets, onUpdate }: Props) {
  const [fetchingEmbedding, setFetchingEmbedding] = useState(false);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [embeddingError, setEmbeddingError] = useState('');
  const [fetchingRerank, setFetchingRerank] = useState(false);
  const [rerankModels, setRerankModels] = useState<string[]>([]);
  const [rerankError, setRerankError] = useState('');

  const handleFetchEmbedding = useCallback(async () => {
    setFetchingEmbedding(true);
    setEmbeddingError('');
    setEmbeddingModels([]);
    try {
      const url = config.vectorApiUrl.trim();
      const key = config.vectorApiKey.trim();
      if (!url) throw new Error('请先配置 Embedding API 地址');
      const models = await fetchModels({ baseUrl: url, apiKey: key, provider: 'openai', model: '' });
      const filtered = models.filter(m => {
        const l = m.toLowerCase();
        return (l.includes('embed') || l.includes('bge') || l.includes('m3e') || l.includes('text-')) && !l.includes('rerank');
      });
      const result = filtered.length > 0 ? filtered : models;
      setEmbeddingModels(result);
      if (result.length > 0 && !config.vectorApiModel) onUpdate({ vectorApiModel: result[0] });
      if (result.length === 0) setEmbeddingError('未获取到任何可用模型');
    } catch (e) {
      setEmbeddingError(e instanceof Error ? e.message : '获取模型失败');
    } finally {
      setFetchingEmbedding(false);
    }
  }, [config.vectorApiUrl, config.vectorApiKey, config.vectorApiModel, onUpdate]);

  const handleFetchRerank = useCallback(async () => {
    setFetchingRerank(true);
    setRerankError('');
    setRerankModels([]);
    try {
      const url = config.vectorRerankApiUrl.trim();
      const key = config.vectorRerankApiKey.trim() || config.vectorApiKey.trim();
      if (!url) throw new Error('请先配置 Rerank API 地址');
      const models = await fetchModels({ baseUrl: url, apiKey: key, provider: 'openai', model: '' });
      const filtered = models.filter(m => m.toLowerCase().includes('rerank'));
      const result = filtered.length > 0 ? filtered : models;
      setRerankModels(result);
      if (result.length > 0 && !config.vectorRerankModel) onUpdate({ vectorRerankModel: result[0] });
      if (result.length === 0) setRerankError('未获取到任何可用模型');
    } catch (e) {
      setRerankError(e instanceof Error ? e.message : '获取模型失败');
    } finally {
      setFetchingRerank(false);
    }
  }, [config.vectorRerankApiUrl, config.vectorRerankApiKey, config.vectorRerankModel, config.vectorApiKey, onUpdate]);

  return (
    <Section icon={<Database size={16} />} title="向量化设置">
      <div style={{ padding: '8px 16px 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
        向量事实库与语义检索仅作为检索记忆层的长程补充。
      </div>
      <FieldGrid>
        {/* 启用向量事实库 */}
        <Field label="启用向量事实库" hint="作为检索记忆层的长程补充，不再承担旧摘要链职责。" span={2}>
          <Toggle value={config.vectorEnabled} onChange={v => onUpdate({ vectorEnabled: v })} />
        </Field>

        {/* 启用语义检索 */}
        <Field label="启用语义检索" hint="在向量召回前先分析玩家输入 + 最近原始剧情 + 热编译摘要，作为中间证据层使用。" span={2}>
          <Toggle value={config.semanticRetrieveEnabled} onChange={v => onUpdate({ semanticRetrieveEnabled: v })} />
        </Field>

        {/* API 预设 */}
        <Field label="向量提取 API 预设">
          <Select
            options={[{ label: '跟随主写入 API', value: '' }, ...apiPresets.map(p => ({ label: p.name, value: p.id }))]}
            value={config.vectorExtractApiPresetId ?? ''}
            onChange={v => onUpdate({ vectorExtractApiPresetId: v || null })}
            width="100%"
          />
        </Field>
        <Field label="语义检索分析 API 预设">
          <Select
            options={[{ label: '不单独指定', value: '' }, ...apiPresets.map(p => ({ label: p.name, value: p.id }))]}
            value={config.vectorRetrieveEnhanceApiPresetId ?? ''}
            onChange={v => onUpdate({ vectorRetrieveEnhanceApiPresetId: v || null })}
            width="100%"
          />
        </Field>

        {/* 数值输入 */}
        <Field label="向量提取间隔">
          <StyledInput type="number" value={config.vectorExtractInterval} min={1} max={20}
            onChange={e => onUpdate({ vectorExtractInterval: Number(e.target.value) })} />
        </Field>
        <Field label="检索模式">
          <Select
            options={[
              { label: 'Bi-Encoder', value: 'bi_encoder' },
              { label: 'Retrieve + Rerank', value: 'cross_encoder' },
              { label: 'Hybrid', value: 'hybrid' },
            ]}
            value={config.vectorRetrieveMode}
            onChange={v => onUpdate({ vectorRetrieveMode: v })}
            width="100%"
          />
        </Field>
        <Field label="最终注入数量">
          <StyledInput type="number" value={config.vectorRetrieveTopK} min={1} max={10}
            onChange={e => onUpdate({ vectorRetrieveTopK: Number(e.target.value) })} />
        </Field>
        <Field label="粗排候选数">
          <StyledInput type="number" value={config.vectorRetrieveCandidateCount} min={1} max={50}
            onChange={e => onUpdate({ vectorRetrieveCandidateCount: Number(e.target.value) })} />
        </Field>
        <Field label="相似度阈值">
          <StyledInput type="number" value={config.vectorScoreThreshold} min={0} max={1} step={0.05}
            onChange={e => onUpdate({ vectorScoreThreshold: Number(e.target.value) })} />
        </Field>

        {/* Embedding API */}
        <Field label="Embedding API 地址" span={2}>
          <StyledInput value={config.vectorApiUrl}
            placeholder="例如：https://api.openai.com/v1"
            onChange={e => onUpdate({ vectorApiUrl: e.target.value })} />
        </Field>
        <Field label="Embedding Key" span={2}>
          <StyledInput type="password" value={config.vectorApiKey}
            placeholder="留空则跟随主配置"
            onChange={e => onUpdate({ vectorApiKey: e.target.value })} />
        </Field>
        <Field label="Embedding 模型" span={2}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: '600' }}>Embedding 模型</span>
            <button
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                fontSize: 'var(--font-size-sm)', color: 'var(--accent)', cursor: fetchingEmbedding ? 'wait' : 'pointer',
                background: 'none', border: 'none', padding: 0, opacity: fetchingEmbedding ? 0.5 : 1,
              }}
              disabled={fetchingEmbedding}
              onClick={handleFetchEmbedding}
            >
              <RefreshCw size={12} className={fetchingEmbedding ? 'spinning' : ''} />
              {fetchingEmbedding ? '获取中...' : '获取模型'}
            </button>
          </div>
          {embeddingModels.length > 0 ? (
            <Select
              options={embeddingModels.map(m => ({ label: m, value: m }))}
              value={config.vectorApiModel}
              onChange={v => onUpdate({ vectorApiModel: v })}
              width="100%"
            />
          ) : (
            <StyledInput value={config.vectorApiModel}
              placeholder="text-embedding-3-small"
              onChange={e => onUpdate({ vectorApiModel: e.target.value })} />
          )}
          {embeddingError && (
            <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={12} />{embeddingError}
            </span>
          )}
        </Field>

        {/* Rerank API */}
        {(config.vectorRetrieveMode === 'cross_encoder' || config.vectorRetrieveMode === 'hybrid') && (
          <>
            <Field label="Rerank API 地址" span={2}>
              <StyledInput value={config.vectorRerankApiUrl}
                placeholder="例如：https://api.siliconflow.cn/v1/rerank"
                onChange={e => onUpdate({ vectorRerankApiUrl: e.target.value })} />
            </Field>
            <Field label="Rerank Key" span={2}>
              <StyledInput type="password" value={config.vectorRerankApiKey}
                placeholder="留空则跟随 Embedding Key"
                onChange={e => onUpdate({ vectorRerankApiKey: e.target.value })} />
            </Field>
            <Field label="Rerank 模型" span={2}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: '600' }}>Rerank 模型</span>
                <button
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    fontSize: 'var(--font-size-sm)', color: 'var(--accent)', cursor: fetchingRerank ? 'wait' : 'pointer',
                    background: 'none', border: 'none', padding: 0, opacity: fetchingRerank ? 0.5 : 1,
                  }}
                  disabled={fetchingRerank}
                  onClick={handleFetchRerank}
                >
                  <RefreshCw size={12} className={fetchingRerank ? 'spinning' : ''} />
                  {fetchingRerank ? '获取中...' : '获取模型'}
                </button>
              </div>
              {rerankModels.length > 0 ? (
                <Select
                  options={rerankModels.map(m => ({ label: m, value: m }))}
                  value={config.vectorRerankModel}
                  onChange={v => onUpdate({ vectorRerankModel: v })}
                  width="100%"
                />
              ) : (
                <StyledInput value={config.vectorRerankModel}
                  placeholder="BAAI/bge-reranker-v2-m3"
                  onChange={e => onUpdate({ vectorRerankModel: e.target.value })} />
              )}
              {rerankError && (
                <span style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={12} />{rerankError}
                </span>
              )}
            </Field>
            <Field label="启用 LLM 重排兜底">
              <Select
                options={[{ label: '开启', value: 'true' }, { label: '关闭', value: 'false' }]}
                value={String(config.vectorRerankUseLlmFallback)}
                onChange={v => onUpdate({ vectorRerankUseLlmFallback: v === 'true' })}
                width="100%"
              />
            </Field>
            {config.vectorRerankUseLlmFallback && (
              <Field label="LLM 重排 API 预设">
                <Select
                  options={[{ label: '跟随主配置', value: '' }, ...apiPresets.map(p => ({ label: p.name, value: p.id }))]}
                  value={config.vectorRerankLlmApiPresetId ?? ''}
                  onChange={v => onUpdate({ vectorRerankLlmApiPresetId: v || null })}
                  width="100%"
                />
              </Field>
            )}
          </>
        )}
      </FieldGrid>
    </Section>
  );
}
