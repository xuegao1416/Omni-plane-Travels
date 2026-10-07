import { useState,useCallback,useImperativeHandle,forwardRef,useRef,useEffect } from 'react';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { useConfigStore } from '../../stores/configStore';
import { fetchModels,testConnection } from '../../api/client';
import type { ApiConfig,ApiProvider } from '../../api/types';
import { ProviderForm,ConnectionTest,PROVIDERS } from './apiSettings';
import type { ApiSettingsRef,ApiSettingsTabProps } from './apiSettings';
export type { ApiSettingsRef };

const DEFAULT_CONFIG: ApiConfig = {
  apiKey: '', baseUrl: '', model: '', provider: 'openai',
  temperature: 1.2, topP: 0.65, topK: 45, maxTokens: 60000,
  contextSize: 2000000, stream: true, reasoningEffort: '关闭',
};

const ApiSettingsTab = forwardRef<ApiSettingsRef, ApiSettingsTabProps>(
    ({ initialConfig, t, onSave, onBack, active = true }, ref) => {
    const [config, setConfig] = useState<ApiConfig>(initialConfig || DEFAULT_CONFIG);
    const [models, setModels] = useState<string[]>([]);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState('');
    const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
    const [loadingModels, setLoadingModels] = useState(false);
    const [proxyUrl, setProxyUrl] = useState(() => { try { return localStorage.getItem(STORAGE_KEYS.PROXY_URL) || ''; } catch { return ''; } });
    const dirty = useRef(false), revision = useRef(0);
    const requestRef = useRef<AbortController | null>(null);
    const recoveryError = useConfigStore(s => s.apiRecoveryError);
    const cancelRequests = useCallback(() => {
      requestRef.current?.abort(); requestRef.current = null;
      setTesting(false); setLoadingModels(false);
    }, []);
    useEffect(() => () => { requestRef.current?.abort(); requestRef.current = null; }, []);
    useEffect(() => { if (!active) cancelRequests(); }, [active, cancelRequests]);
    useEffect(() => { if (!dirty.current && initialConfig) setConfig(structuredClone(initialConfig)); }, [initialConfig]);

    useImperativeHandle(ref, () => ({ getValues: () => ({ config: structuredClone(config), proxyUrl, dirty: dirty.current, revision: revision.current }) }));

    const set = useCallback(
      <K extends keyof ApiConfig>(key: K, val: ApiConfig[K]) => {
        cancelRequests(); dirty.current = true; revision.current++;
        setConfig(prev => ({ ...prev, [key]: val }));
      },
      [cancelRequests],
    );
    const handleProxyChange = (value: string) => {
      cancelRequests(); dirty.current = true; revision.current++; setProxyUrl(value);
    };

    const handleTest = useCallback(async () => {
      cancelRequests(); const controller = new AbortController(); requestRef.current = controller;
      setTesting(true);
      setTestResult('');
      setTestSuccess(null);
      try {
        const result = await testConnection(config, { signal: controller.signal, proxyUrl });
        if (requestRef.current !== controller || controller.signal.aborted) return;
        setTestSuccess(result.success); setTestResult(result.message);
      } catch (error) {
        if (!controller.signal.aborted) { setTestSuccess(false); setTestResult(error instanceof Error ? error.message : String(error)); }
      } finally { if (requestRef.current === controller) { requestRef.current = null; setTesting(false); } }
    }, [config, proxyUrl, cancelRequests]);

    const handleFetchModels = useCallback(async () => {
      cancelRequests(); const controller = new AbortController(); requestRef.current = controller;
      setLoadingModels(true);
      try {
        const list = await fetchModels(config, { signal: controller.signal, proxyUrl });
        if (requestRef.current !== controller || controller.signal.aborted) return;
        setModels(list);
        if (list.length > 0 && !config.model) set('model', list[0]);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setTestSuccess(false);
        setTestResult(`获取模型失败: ${err instanceof Error ? err.message : String(err)}；模型列表不可用时可直接手动填写模型名称`);
      } finally { if (requestRef.current === controller) { requestRef.current = null; setLoadingModels(false); } }
    }, [config, proxyUrl, set, cancelRequests]);

    const handleLoadPreset = useCallback((presetConfig: ApiConfig) => {
      cancelRequests(); dirty.current = true; revision.current++;
      setConfig({ ...presetConfig });
    }, [cancelRequests]);

    return (
      <div className="settings-tab-panel settings-tab-panel--api">
        {recoveryError && <p role="alert">{recoveryError}</p>}
        <div style={{ marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <span style={{ fontWeight: '600', fontSize: 'var(--font-size-md)' }}>参数配置</span>
            <select
              value={config.provider}
              onChange={e => set('provider', e.target.value as ApiProvider)}
              style={{
                padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '6px',
                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                fontSize: 'var(--font-size-base)', cursor: 'pointer', outline: 'none',
              }}
            >
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
      <ProviderForm
            config={config} set={set}
            models={models} setModels={setModels}
            loadingModels={loadingModels} onFetchModels={handleFetchModels}
            onLoadPreset={handleLoadPreset}
            proxyUrl={proxyUrl} onProxyChange={handleProxyChange}
          />
        </div>
        <ConnectionTest
          testing={testing} testResult={testResult} testSuccess={testSuccess}
          onTest={handleTest} t={t} onSave={onSave} onBack={onBack}
        />
      </div>
    );
  },
);

export default ApiSettingsTab;
