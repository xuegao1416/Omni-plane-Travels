// ============================================================
// 向量化设置面板 — 使用共享组件重写
// ============================================================

import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, AlertTriangle, Database, Download, CheckCircle2, Trash2 } from 'lucide-react';
import type { MemorySystemConfig } from '../../../memory/types';
import type { ApiPreset } from '../apiPresetUtils';
import { fetchModels } from '../../../api/client';
import { Section, FieldGrid, Field, Select, Toggle } from '../SettingsUIComponents';
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  clearAllLocalEmbeddingModels,
  deleteLocalEmbeddingModel,
  getInstalledLocalEmbeddingModels,
  isLocalEmbeddingModelLoaded,
  warmLocalEmbeddingModel,
  type LocalEmbeddingModelMetadata,
} from '../../../memory/embeddingRuntime';

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
  const [localError, setLocalError] = useState('');
  const [localDownloading, setLocalDownloading] = useState(false);
  const [localReady, setLocalReady] = useState(() => isLocalEmbeddingModelLoaded(config.localEmbeddingModelId ?? DEFAULT_LOCAL_EMBEDDING_MODEL));
  const [localProgress, setLocalProgress] = useState(0);
  const [localModels, setLocalModels] = useState<LocalEmbeddingModelMetadata[]>(() => getInstalledLocalEmbeddingModels());

  useEffect(() => {
    setLocalReady(isLocalEmbeddingModelLoaded(config.localEmbeddingModelId ?? DEFAULT_LOCAL_EMBEDDING_MODEL));
    setLocalModels(getInstalledLocalEmbeddingModels());
  }, [config.localEmbeddingModelId]);

  const handlePrepareLocalModel = useCallback(async () => {
    setLocalError('');
    setLocalDownloading(true);
    setLocalProgress(0);
    try {
      const model = config.localEmbeddingModelId?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL;
      await warmLocalEmbeddingModel(model, {}, progress => setLocalProgress(Math.max(0, Math.min(100, progress.progress ?? 0))));
      onUpdate({ localEmbeddingModelId: model });
      setLocalReady(true);
      setLocalModels(getInstalledLocalEmbeddingModels());
      setLocalError('');
    } catch (e) {
      setLocalReady(false);
      setLocalError(e instanceof Error ? e.message : '端侧模型初始化失败');
    } finally {
      setLocalDownloading(false);
    }
  }, [config.localEmbeddingModelId, onUpdate]);

  const handleDeleteLocalModel = useCallback(async (model: string) => {
    try {
      await deleteLocalEmbeddingModel(model);
      setLocalModels(getInstalledLocalEmbeddingModels());
      if (model === config.localEmbeddingModelId) {
        onUpdate({ localEmbeddingModelId: DEFAULT_LOCAL_EMBEDDING_MODEL });
        setLocalReady(false);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '删除本地模型失败');
    }
  }, [config.localEmbeddingModelId, onUpdate]);

  const handleClearLocalModels = useCallback(async () => {
    try {
      await clearAllLocalEmbeddingModels();
      setLocalModels([]);
      setLocalReady(false);
      setLocalError('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '清理本地模型缓存失败');
    }
  }, []);

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
        <Field label="Embedding 运行方式" span={2} hint="端侧模式在当前设备内用 WASM 推理；模型首次使用时下载并缓存，之后可离线运行。">
          <Select
            options={[
              { label: '远程 API', value: 'remote' },
              { label: '端侧模型（Web / 桌面 / Android）', value: 'local' },
              { label: '外部本地服务', value: 'local_endpoint' },
            ]}
            value={config.vectorRuntime}
            onChange={v => onUpdate({ vectorRuntime: v })}
            width="100%"
          />
        </Field>
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

        {/* Embedding API：Web 与远程运行方式保留；Web 不显示本地下载动作。 */}
        {config.vectorRuntime === 'remote' && <>
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
        </>}

        {config.vectorRuntime === 'local' && (
          <>
            <Field label="端侧 Embedding 模型" span={2} hint="推荐的中文小模型使用量化 ONNX 权重；首次初始化需要联网，模型由当前设备缓存。">
              <StyledInput
                value={config.localEmbeddingModelId ?? DEFAULT_LOCAL_EMBEDDING_MODEL}
                placeholder={DEFAULT_LOCAL_EMBEDDING_MODEL}
                onChange={e => onUpdate({ localEmbeddingModelId: e.target.value || DEFAULT_LOCAL_EMBEDDING_MODEL })}
              />
            </Field>
            <Field label="端侧模型状态" span={2}>
              <button type="button" disabled={localDownloading} onClick={() => void handlePrepareLocalModel()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: localDownloading ? 'wait' : 'pointer' }}>
                {localReady ? <CheckCircle2 size={14} /> : <Download size={14} />}
                {localDownloading ? `正在下载并初始化… ${Math.round(localProgress)}%` : localReady ? '模型已在本次运行中就绪' : '下载并初始化模型'}
              </button>
              <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 12 }}>
                模型下载后由浏览器或 WebView 缓存；清理站点数据会移除缓存。
              </div>
            </Field>
            <Field label="已安装模型" span={2}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {localModels.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>暂无已登记的端侧模型。</span>}
                {localModels.map(model => (
                  <div key={model.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: model.id === (config.localEmbeddingModelId ?? DEFAULT_LOCAL_EMBEDDING_MODEL) ? 'var(--accent-dim)' : 'var(--bg-secondary)' }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', fontSize: 12 }} title={model.id}>{model.id}{model.id === (config.localEmbeddingModelId ?? DEFAULT_LOCAL_EMBEDDING_MODEL) ? '（当前）' : ''}</span>
                    <button type="button" title={`删除 ${model.id}`} aria-label={`删除 ${model.id}`} onClick={() => void handleDeleteLocalModel(model.id)} style={{ border: 0, background: 'transparent', color: 'var(--danger)', cursor: 'pointer', display: 'inline-flex' }}><Trash2 size={13} /></button>
                  </div>
                ))}
                {localModels.length > 0 && <button type="button" onClick={() => void handleClearLocalModels()} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: 12 }}><Trash2 size={12} /> 清理全部本地模型缓存</button>}
              </div>
            </Field>
            {localError && (
              <Field label="本地模型状态" span={2}>
                <span style={{ color: 'var(--danger)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={12} />{localError}
                </span>
              </Field>
            )}
          </>
        )}

        {config.vectorRuntime === 'local_endpoint' && (
          <>
            <Field label="本地 Embedding 服务地址" span={2} hint="仅接受当前设备运行的 OpenAI-compatible /v1/embeddings 服务。">
              <StyledInput value={config.localEmbeddingEndpoint} placeholder="http://127.0.0.1:8080/v1" onChange={e => onUpdate({ localEmbeddingEndpoint: e.target.value })} />
            </Field>
            <Field label="本地服务模型" span={2}>
              <StyledInput value={config.localEmbeddingModelId ?? ''} placeholder="bge-small-zh-v1.5" onChange={e => onUpdate({ localEmbeddingModelId: e.target.value || null })} />
            </Field>
          </>
        )}

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
