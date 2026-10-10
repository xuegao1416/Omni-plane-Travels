import { useEffect, useRef, useState } from 'react';
import { fetchModels,testConnection } from '../../../api/client';
import { useConfigStore } from '../../../stores/configStore';
import { useNovelConfigStore,type NovelWorkbenchConfig } from '../../../stores/novelConfigStore';
import { NOVEL_ANALYSIS_PRESETS, NOVEL_CUSTOM_INSTRUCTIONS_LIMIT, type NovelAnalysisPreset } from '../../../novel/analysisPresets';
import { NOVEL_ANALYSIS_MAX_RESPONSE_TOKENS } from '../../../novel/analysisClient';
import { REASONING_OPTIONS } from '../../settings/apiSettings/types';

export function NovelConnectionSettings({ disabled, onMessage }: { disabled: boolean; onMessage: (message: string) => void }) {
  const { config, initialize, save, loaded, recoveryError, warning } = useNovelConfigStore();
  const shared = useConfigStore(state => state.apiConfig);
  const [draft, setDraft] = useState(config);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const request = useRef<AbortController | null>(null);
  const cancel = () => { request.current?.abort(); request.current = null; setBusy(false); };
  useEffect(() => { void initialize().catch(error => onMessage(`配置读取失败：${String(error)}`)); }, [initialize]);
  useEffect(() => { if (!dirty.current) setDraft(structuredClone(config)); }, [config]);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  const patch = (value: Partial<NovelWorkbenchConfig>) => { cancel(); dirty.current = true; setDraft(current => ({ ...current, ...value })); };
  const patchApi = (value: Partial<NovelWorkbenchConfig['api']>) => { cancel(); dirty.current = true; setDraft(current => ({ ...current, api: { ...current.api, ...value } })); };
  const perform = async (action: 'save' | 'models' | 'test') => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const isCurrent = () => request.current === controller && !controller.signal.aborted;
    setBusy(true);
    try {
      if (action === 'models') {
        const listed = await fetchModels(draft.api, { signal: controller.signal });
        if (!isCurrent()) return;
        setModels(listed);
        const flash = listed.filter(model => /flash/i.test(model)).sort((a, b) => Number(/preview|exp/i.test(a)) - Number(/preview|exp/i.test(b)))[0];
        if (!draft.api.model && flash) { dirty.current = true; setDraft(current => ({ ...current, api: { ...current.api, model: flash } })); }
        onMessage(`发现 ${listed.length} 个模型${flash ? `；推荐 ${flash}` : '；请明确选择拆解模型'}。`);
      } else if (action === 'test') {
        const result = await testConnection(draft.api, { signal: controller.signal });
        if (!isCurrent()) return;
        onMessage(`${result.success ? '连接通过' : '连接失败'}：${result.message}`);
      } else {
        await save(draft);
        if (!isCurrent()) return;
        dirty.current = false;
        onMessage(useNovelConfigStore.getState().warning ?? '拆解专用配置已保存，密钥使用项目密钥库保护。');
      }
    } catch (error) { if (isCurrent()) onMessage(`配置操作失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <details className="novel-import-workbench__settings" open={!config.api.model}>
    <summary>拆解预设、专用 API 与检索配置</summary>
    {(recoveryError || warning) && <p role="alert">{recoveryError || warning} <button type="button" onClick={() => { void initialize().catch(error => onMessage(`配置读取失败：${String(error)}`)); }}>重新读取</button></p>}
    <fieldset disabled={disabled || busy || (!loaded && !recoveryError)}>
      <p className="novel-import-workbench__hint">修改后保存生效。设置独立于游戏对话；模型列表优先推荐稳定 Flash，不自动切换 Pro。</p>
      <label className="novel-import-workbench__field">拆解预设<select value={draft.analysisPreset.id} onChange={e => patch({ analysisPreset: { ...draft.analysisPreset, id: e.target.value as NovelAnalysisPreset['id'] } })}>{NOVEL_ANALYSIS_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
      <p className="novel-import-workbench__hint">{NOVEL_ANALYSIS_PRESETS.find(preset => preset.id === draft.analysisPreset.id)?.description} 切换后再次分析会更新受影响的资料。预设不能解除模型平台的内容限制。</p>
      {draft.analysisPreset.id === 'custom' && <label className="novel-import-workbench__field">补充分析指令<textarea rows={5} maxLength={NOVEL_CUSTOM_INSTRUCTIONS_LIMIT} value={draft.analysisPreset.customInstructions} placeholder="例如：重点分析人物动机、关系变化与事件因果，使用简洁的中性表达。" onChange={e => patch({ analysisPreset: { ...draft.analysisPreset, customInstructions: e.target.value } })} /></label>}
      <div className="novel-import-workbench__range-fields">
        <label className="novel-import-workbench__field">接口协议<select value={draft.api.provider} onChange={e => patchApi({ provider: e.target.value as NovelWorkbenchConfig['api']['provider'] })}><option value="custom">OpenAI 兼容</option><option value="google">Google</option><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option></select></label>
        <label className="novel-import-workbench__field">接口地址<input type="url" value={draft.api.baseUrl} placeholder="https://example.com/v1" onChange={e => patchApi({ baseUrl: e.target.value })} autoComplete="off" /></label>
      </div>
      <div className="novel-import-workbench__range-fields">
        <label className="novel-import-workbench__field">API 密钥<input type="password" value={draft.api.apiKey} onChange={e => patchApi({ apiKey: e.target.value })} autoComplete="new-password" /></label>
        <label className="novel-import-workbench__field">拆解模型<input list="novel-model-options" value={draft.api.model} onChange={e => patchApi({ model: e.target.value })} placeholder="获取模型列表后选择 Flash" /><datalist id="novel-model-options">{models.map(model => <option key={model} value={model} />)}</datalist></label>
      </div>
      <div className="novel-import-workbench__range-fields">
        <label className="novel-import-workbench__field">推理强度<select value={draft.api.reasoningEffort ?? '关闭'} onChange={e => patchApi({ reasoningEffort: e.target.value })}>{REASONING_OPTIONS.map(effort => <option key={effort} value={effort}>{effort}</option>)}</select></label>
        <label className="novel-import-workbench__field">最大响应 Tokens<input type="number" min={1024} max={NOVEL_ANALYSIS_MAX_RESPONSE_TOKENS} step={1024} value={Math.min(NOVEL_ANALYSIS_MAX_RESPONSE_TOKENS, draft.api.maxTokens ?? 8192)} onChange={e => patchApi({ maxTokens: Math.max(1024, Math.min(NOVEL_ANALYSIS_MAX_RESPONSE_TOKENS, Number(e.target.value) || 8192)) })} /></label>
      </div>
      <p className="novel-import-workbench__hint">响应上限包含接口计入的推理消耗。触顶时可尝试 low，或提高响应上限；「关闭」表示不发送推理强度参数，服务端仍可能使用默认思考设置。</p>
      <div className="novel-import-workbench__range-fields">
        <label className="novel-import-workbench__field">拆解限流间隔（毫秒）<input type="number" min={0} max={60000} step={500} value={draft.analysisRateLimitMs} onChange={e => patch({ analysisRateLimitMs: Math.max(0, Math.min(60000, Number(e.target.value) || 0)) })} /></label>
        <label className="novel-import-workbench__field">Embedding 限流间隔（毫秒）<input type="number" min={0} max={60000} step={500} value={draft.embeddingRateLimitMs} onChange={e => patch({ embeddingRateLimitMs: Math.max(0, Math.min(60000, Number(e.target.value) || 0)) })} /></label>
      </div>
      <label className="novel-import-workbench__field">语义检索增强<select value={draft.embeddingMode} onChange={e => patch({ embeddingMode: e.target.value as NovelWorkbenchConfig['embeddingMode'] })}><option value="off">关闭 embedding · 关键词与邻章检索</option><option value="inherit">使用项目已有向量配置 · 独立启用</option><option value="local_endpoint">指定本地 embedding 服务</option></select></label>
      {draft.embeddingMode === 'local_endpoint' && <div className="novel-import-workbench__range-fields">
        <label className="novel-import-workbench__field">本地服务地址<input type="url" value={draft.embeddingEndpoint} onChange={e => patch({ embeddingEndpoint: e.target.value })} /></label>
        <label className="novel-import-workbench__field">本地模型 ID<input value={draft.embeddingModel} onChange={e => patch({ embeddingModel: e.target.value })} placeholder="填入本地服务实际返回的模型 ID" /></label>
      </div>}
      <div className="novel-import-workbench__structure-actions">
        {shared && <button type="button" onClick={() => patch({ api: { ...shared } })}>复制游戏 API 配置</button>}
        <button type="button" onClick={() => void perform('models')}>获取模型列表</button>
        <button type="button" onClick={() => void perform('test')}>测试生成连接</button>
        <button type="button" onClick={() => void perform('save')}>保存专用配置</button>
      </div>
    </fieldset>
  </details>;
}
