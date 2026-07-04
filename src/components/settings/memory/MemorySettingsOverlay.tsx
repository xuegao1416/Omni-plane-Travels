// 记忆系统设置 — overlay（弹窗）/ inline（Tab 内嵌）两种模式

import { useState, useEffect, useCallback } from 'react';
import { Brain } from 'lucide-react';
import { useMemoryStore } from '../../../memory/memoryStore';
import { loadPresets } from '../apiPresetUtils';
import { Section, SettingRow, Select } from '../SettingsUIComponents';
import { WriteConfigPanel } from './WriteConfigPanel';
import { VectorConfigPanel } from './VectorConfigPanel';
import { RetrievalConfigPanel } from './RetrievalConfigPanel';
import { PromptTemplatesPanel } from './PromptTemplatesPanel';
import { RuntimeGraphPanel } from './RuntimeGraphPanel';
import { ExportPickerDialog } from './ExportPickerDialog';
import { VectorExtractDialog } from './VectorExtractDialog';
import { MemoryHeader } from './MemoryHeader';
import { MemoryFooter } from './MemoryFooter';
import { RawEditor } from './RawEditor';
import { useMemoryConfig } from './useMemoryConfig';
import { useRawEditor } from './useRawEditor';
import '../MemorySettingsOverlay.css';

export function MemorySettingsOverlay({ visible, onClose, onSave, mode = 'overlay' }: {
  visible: boolean; onClose: () => void; onSave: () => void; mode?: 'overlay' | 'inline';
}) {
  const store = useMemoryStore();
  const { config, memoryRuntime, vectorMemory } = store;
  const apiPresets = loadPresets();
  const [localConfig, setLocalConfig] = useState(() => ({ ...config }));
  const [localPromptTemplates, setLocalPromptTemplates] = useState(() => ({ ...config.narrativePromptTemplates }));
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({});
  const [runtimeSearch, setRuntimeSearch] = useState('');
  const [activeRuntimeTab, setActiveRuntimeTab] = useState('scene');
  const [exportPickerVisible, setExportPickerVisible] = useState(false);
  const [vectorExtractVisible, setVectorExtractVisible] = useState(false);

  const {
    updateConfig, updateWritePipeline, updateRetrieval,
    updateCompiler, updateRetention, isSimple, modeLabel, configDesc,
  } = useMemoryConfig(localConfig, setLocalConfig);

  const {
    rawEditorVisible, setRawEditorVisible, rawEditorTabKey,
    rawEditorText, setRawEditorText, rawEditorSaving, rawEditorError,
    openRawEditor, saveRawEditor,
  } = useRawEditor(store, vectorMemory);

  // Escape 键关闭
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (rawEditorVisible || exportPickerVisible || vectorExtractVisible) return;
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, rawEditorVisible, exportPickerVisible, vectorExtractVisible, onClose]);

  // 运行态统计 & 提示词重置
  const rt = memoryRuntime;
  const sc = rt?.sceneAnchor ? 1 : 0, tc = rt?.activeThreads?.length ?? 0,
    stc = rt?.stateSlots?.length ?? 0, rc = rt?.relationEdges?.length ?? 0,
    ec = rt?.eventCards?.length ?? 0, enc = rt?.entityCards?.length ?? 0,
    ac = rt?.archiveCards?.length ?? 0;
  const stats = {
    sceneCount: sc, threadCount: tc, stateCount: stc, relationCount: rc,
    eventCount: ec, entityCount: enc, archiveCount: ac,
    mutationCount: rt?.mutationLog?.length ?? 0, checkpointCount: rt?.checkpoints?.length ?? 0,
    lastIngestCursor: rt?.lastIngestCursor ?? 0,
    totalObjects: sc + tc + stc + rc + ec + enc + ac,
  };
  const handlePromptReset = useCallback((key: string) => {
    import('../../../memory/memoryPrompts').then(m => {
      const d: Record<string, () => string> = {
        ingest: m.getDefaultNarrativeIngestPrompt, summary: m.getDefaultNarrativeSummaryPrompt,
        retrievePlanner: m.getDefaultNarrativeRetrievePlannerPrompt,
        multiRoundRetrievePlanner: m.getDefaultMultiRoundRetrievePlannerPrompt,
        multiRoundRetrievePlannerFinal: m.getDefaultMultiRoundRetrievePlannerFinalPrompt,
        queryRewrite: m.getDefaultNarrativeQueryRewritePrompt, rerank: m.getDefaultNarrativeRerankPrompt,
        conflictJudge: m.getDefaultNarrativeConflictJudgePrompt,
        vectorExtract: m.getDefaultVectorExtractPrompt,
        vectorQueryRewrite: m.getDefaultVectorQueryRewritePrompt, vectorRerank: m.getDefaultVectorRerankPrompt,
      };
      if (d[key]) setLocalPromptTemplates(prev => ({ ...prev, [key]: d[key]() }));
    });
  }, []);
  const handleSave = useCallback(() => {
    store.setConfig({ ...localConfig, narrativePromptTemplates: localPromptTemplates });
    onSave();
  }, [localConfig, localPromptTemplates, store, onSave]);
  const toggleMemoryMode = useCallback(() => {
    updateConfig({ memoryMode: isSimple ? 'full' : 'simple' });
  }, [isSimple, updateConfig]);

  if (!visible) return null;

  // ─── 共享的内容区 ───
  const content = (
    <>
      <MemoryHeader modeLabel={modeLabel} onToggleMode={toggleMemoryMode} compact={mode === 'inline'} />
      <div className="ms-scroll" style={mode === 'inline' ? { padding: '12px 14px' } : undefined}>
        <div className="ms-block">
          <div className="ms-block-header">
            <div>
              <div className="ms-block-title">记忆系统配置</div>
              <div className="ms-block-desc">{configDesc}</div>
            </div>
            <button
              className={`ms-toggle-btn ${localConfig.enabled ? 'active' : ''}`}
              role="switch" aria-checked={localConfig.enabled}
              onClick={() => updateConfig({ enabled: !localConfig.enabled })}
            ><div className="ms-toggle-thumb" /></button>
          </div>
          <div className={`ms-config-grid ${isSimple ? 'simple-mode' : ''}`}>
            <Section icon={<Brain size={15} />} title="记忆系统主 API">
              <SettingRow label="默认 API 预设" desc="所有记忆阶段（写入、摘要、检索、向量）的默认 API。各阶段可单独覆盖。" stacked>
                <Select
                  options={[{ label: '跟随主聊天 API', value: '' }, ...apiPresets.map(p => ({ label: p.name, value: p.id }))]}
                  value={localConfig.apiPresetId ?? ''}
                  onChange={v => updateConfig({ apiPresetId: v || null })}
                  width="100%"
                />
              </SettingRow>
            </Section>
            <WriteConfigPanel config={localConfig} apiPresets={apiPresets} isSimple={isSimple}
              onUpdate={updateConfig} onWritePipelineUpdate={updateWritePipeline}
              onRetentionUpdate={updateRetention} onCompilerUpdate={updateCompiler} />
            {!isSimple && <VectorConfigPanel config={localConfig} apiPresets={apiPresets} onUpdate={updateConfig} />}
            <RetrievalConfigPanel config={localConfig} apiPresets={apiPresets}
              onUpdate={updateConfig} onRetrievalUpdate={updateRetrieval} />
          </div>
        </div>
        <div className="ms-divider" />
        {!isSimple && (<>
          <PromptTemplatesPanel templates={localPromptTemplates} expanded={expandedPrompts}
            onToggle={key => setExpandedPrompts(prev => ({ ...prev, [key]: !prev[key] }))}
            onChange={(key, value) => setLocalPromptTemplates(prev => ({ ...prev, [key]: value }))}
            onReset={handlePromptReset} />
          <div className="ms-divider" />
        </>)}
        <RuntimeGraphPanel config={localConfig} memoryRuntime={memoryRuntime} vectorMemory={vectorMemory}
          stats={stats} search={runtimeSearch} activeTab={activeRuntimeTab}
          onSearchChange={setRuntimeSearch} onTabChange={setActiveRuntimeTab}
          onOpenEditor={openRawEditor} onOpenExportPicker={() => setExportPickerVisible(true)}
          onOpenVectorExtract={() => setVectorExtractVisible(true)} isExporting={false} />
      </div>
      <MemoryFooter mode={mode} onClose={onClose} onSave={handleSave} />
    </>
  );

  // ─── 弹窗层 ───
  const dialogs = (<>
    {exportPickerVisible && (
      <ExportPickerDialog onClose={() => setExportPickerVisible(false)}
        store={store} vectorMemory={vectorMemory} memoryRuntime={memoryRuntime} />
    )}
    {vectorExtractVisible && <VectorExtractDialog onClose={() => setVectorExtractVisible(false)} />}
    {rawEditorVisible && (
      <RawEditor tabKey={rawEditorTabKey} text={rawEditorText} saving={rawEditorSaving}
        error={rawEditorError} onTextChange={setRawEditorText}
        onSave={saveRawEditor} onClose={() => setRawEditorVisible(false)} />
    )}
  </>);

  if (mode === 'inline') {
    return (<>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>{content}</div>
      {dialogs}
    </>);
  }

  return (
    <div className="ms-overlay ms-root">
      <div className="ms-bg"><div className="ms-bg-gradient" /><div className="ms-bg-overlay" /></div>
      <div className="ms-main">
        <div className="ms-header">
          <div className="ms-header-icon"><Brain size={22} /></div>
          <h2 className="ms-page-title">记忆系统</h2>
          <p className="ms-page-subtitle">COMPILED NARRATIVE MEMORY</p>
          <div className="ms-title-deco">
            <span className="ms-deco-line ms-deco-line-left" />
            <span className="ms-deco-diamond" />
            <span className="ms-deco-line ms-deco-line-right" />
          </div>
        </div>
        <div className="ms-card">
          <div className="ms-card-glow" />
          <div className="ms-card-frame">
            <div className="ms-corner ms-corner-tl" /><div className="ms-corner ms-corner-tr" />
            <div className="ms-corner ms-corner-bl" /><div className="ms-corner ms-corner-br" />
          </div>
          {content}
        </div>
      </div>
      {dialogs}
    </div>
  );
}
