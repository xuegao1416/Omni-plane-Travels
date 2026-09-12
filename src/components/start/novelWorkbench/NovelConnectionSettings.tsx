import { useEffect,useState } from 'react';
import { fetchModels,testConnection } from '../../../api/client';
import { useConfigStore } from '../../../stores/configStore';
import { useNovelConfigStore,type NovelWorkbenchConfig } from '../../../stores/novelConfigStore';

export function NovelConnectionSettings({ disabled, onMessage }: { disabled: boolean; onMessage: (message: string) => void }) {
  const { config, initialize, save } = useNovelConfigStore();
  const shared = useConfigStore(state => state.apiConfig);
  const [draft, setDraft] = useState(config);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void initialize().catch(error => onMessage(`配置读取失败：${String(error)}`)); }, [initialize]);
  useEffect(() => setDraft(config), [config]);
  const patch = (value: Partial<NovelWorkbenchConfig>) => setDraft(current => ({ ...current, ...value }));
  const patchApi = (value: Partial<NovelWorkbenchConfig['api']>) => setDraft(current => ({ ...current, api: { ...current.api, ...value } }));
  const perform = async (action: 'save' | 'models' | 'test') => {
    setBusy(true);
    try {
      if (action === 'models') {
        const listed = await fetchModels(draft.api);
        setModels(listed);
        const flash = listed.filter(model => /flash/i.test(model)).sort((a, b) => Number(/preview|exp/i.test(a)) - Number(/preview|exp/i.test(b)))[0];
        if (!draft.api.model && flash) patchApi({ model: flash });
        onMessage(`发现 ${listed.length} 个模型${flash ? `；推荐 ${flash}` : '；请明确选择拆解模型'}。`);
      } else if (action === 'test') {
        const result = await testConnection(draft.api);
        onMessage(`${result.success ? '连接通过' : '连接失败'}：${result.message}`);
      } else { await save(draft); onMessage('拆解专用配置已保存，密钥使用项目密钥库保护。'); }
    } catch (error) { onMessage(`配置操作失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };
  return <details className="novel-import-workbench__settings" open={!config.api.model}>
    <summary>拆解专用 API 与检索配置</summary>
    <fieldset disabled={disabled || busy}>
      <p className="novel-import-workbench__hint">修改后保存生效。设置独立于游戏对话；模型列表优先推荐稳定 Flash，不自动切换 Pro。</p>
      <div className="novel-import-workbench__range-fields">
        <label className="novel-import-workbench__field">接口协议<select value={draft.api.provider} onChange={e => patchApi({ provider: e.target.value as NovelWorkbenchConfig['api']['provider'] })}><option value="custom">OpenAI 兼容</option><option value="google">Google</option><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option></select></label>
        <label className="novel-import-workbench__field">接口地址<input type="url" value={draft.api.baseUrl} placeholder="https://example.com/v1" onChange={e => patchApi({ baseUrl: e.target.value })} autoComplete="off" /></label>
      </div>
      <div className="novel-import-workbench__range-fields">
        <label className="novel-import-workbench__field">API 密钥<input type="password" value={draft.api.apiKey} onChange={e => patchApi({ apiKey: e.target.value })} autoComplete="new-password" /></label>
        <label className="novel-import-workbench__field">拆解模型<input list="novel-model-options" value={draft.api.model} onChange={e => patchApi({ model: e.target.value })} placeholder="获取模型列表后选择 Flash" /><datalist id="novel-model-options">{models.map(model => <option key={model} value={model} />)}</datalist></label>
      </div>
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
        {shared && <button type="button" onClick={() => setDraft(current => ({ ...current, api: { ...shared } }))}>复制游戏 API 配置</button>}
        <button type="button" onClick={() => void perform('models')}>获取模型列表</button>
        <button type="button" onClick={() => void perform('test')}>测试生成连接</button>
        <button type="button" onClick={() => void perform('save')}>保存专用配置</button>
      </div>
    </fieldset>
  </details>;
}
