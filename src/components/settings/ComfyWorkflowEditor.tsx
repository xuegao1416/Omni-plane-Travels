// ComfyUI 自定义工作流编辑器 — 导入、验证、映射、管理
import { useState, useCallback } from 'react';
import { useImageStore } from '@/stores/imageStore';
import { useImageGen } from '@/hooks/useImageGen';
import { validateWorkflow, detectWorkflowNodes } from '@/api/imageGen';
import type { ComfyWorkflowPreset, WorkflowParamMapping, WorkflowValidation, DetectedNode } from '@/api/imageGenTypes';
import { Section, Toggle } from './SettingsUIComponents';
import { Wand2 } from 'lucide-react';
import { PresetCard, ImportPanel, parseWorkflowJson, buildAutoMapping, setMappingParam } from './comfyWorkflow';

export default function ComfyWorkflowEditor() {
  const config = useImageStore((s) => s.config);
  const updateConfig = useImageStore((s) => s.updateConfig);
  const comfyData = useImageStore((s) => s.comfyData);
  const { loadComfyUIData } = useImageGen();

  const [draftJson, setDraftJson] = useState('');
  const [draftName, setDraftName] = useState('');
  const [importError, setImportError] = useState('');
  const [validation, setValidation] = useState<WorkflowValidation | null>(null);
  const [detectedNodes, setDetectedNodes] = useState<DetectedNode[]>([]);
  const [mapping, setMapping] = useState<WorkflowParamMapping>({ custom: {} });
  const [editingPreset, setEditingPreset] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const presets = config.comfyWorkflowPresets || [];
  const activeId = config.comfyActiveWorkflowId;

  const resetDraft = () => {
    setDraftJson(''); setDraftName(''); setImportError('');
    setValidation(null); setDetectedNodes([]); setMapping({ custom: {} }); setEditingPreset(null);
  };

  const handleImportAndValidate = useCallback(async () => {
    setImportError(''); setValidation(null);
    const workflow = parseWorkflowJson(draftJson);
    if (!workflow) { setImportError('JSON 解析失败，请检查格式'); return; }
    const hasNodes = Object.values(workflow).some((n) => n && typeof n === 'object' && n.class_type);
    if (!hasNodes) { setImportError('未找到有效的 ComfyUI 节点（缺少 class_type 字段）'); return; }

    if (comfyData.objectInfo && Object.keys(comfyData.objectInfo).length > 0) {
      setValidation(validateWorkflow(workflow, comfyData.objectInfo));
    } else {
      setValidation({
        nodeTypes: Object.values(workflow).filter((n) => n?.class_type).map((n) => String(n.class_type)),
        available: [], missing: [], modelWarnings: [], fatalErrors: [], valid: true,
      });
    }
    const nodes = detectWorkflowNodes(workflow);
    setDetectedNodes(nodes);
    setMapping(buildAutoMapping(nodes));
  }, [draftJson, comfyData.objectInfo]);

  const handleSavePreset = useCallback(() => {
    if (!draftName.trim()) return;
    const workflow = parseWorkflowJson(draftJson);
    if (!workflow) return;
    const now = Date.now();
    const id = editingPreset || `wf_${now}_${Math.random().toString(36).substr(2, 6)}`;
    const preset: ComfyWorkflowPreset = {
      id, name: draftName.trim(), workflow, paramMapping: mapping,
      validation: validation || { nodeTypes: [], available: [], missing: [], modelWarnings: [], fatalErrors: [], valid: true },
      createdAt: editingPreset ? (presets.find((p) => p.id === id)?.createdAt || now) : now, updatedAt: now,
    };
    const newPresets = editingPreset ? presets.map((p) => (p.id === id ? preset : p)) : [...presets, preset];
    updateConfig('comfyWorkflowPresets', newPresets);
    if (!editingPreset) { updateConfig('comfyActiveWorkflowId', id); updateConfig('comfyUseCustomWorkflow', true); }
    resetDraft();
  }, [draftJson, draftName, mapping, validation, editingPreset, presets, updateConfig]);

  const handleEditPreset = useCallback((preset: ComfyWorkflowPreset) => {
    setEditingPreset(preset.id); setDraftName(preset.name);
    setDraftJson(JSON.stringify(preset.workflow, null, 2));
    setMapping(preset.paramMapping); setValidation(preset.validation);
    setDetectedNodes(detectWorkflowNodes(preset.workflow)); setImportError('');
  }, []);

  const handleDeletePreset = useCallback((id: string) => {
    const newPresets = presets.filter((p) => p.id !== id);
    updateConfig('comfyWorkflowPresets', newPresets);
    if (activeId === id) {
      updateConfig('comfyActiveWorkflowId', newPresets.length > 0 ? newPresets[0].id : '');
      if (newPresets.length === 0) updateConfig('comfyUseCustomWorkflow', false);
    }
    if (editingPreset === id) resetDraft();
  }, [presets, activeId, editingPreset, updateConfig]);

  const handleRevalidate = useCallback(async () => {
    setConnecting(true);
    try { await loadComfyUIData(config.comfyUrl); } catch { /* error logged in hook */ }
    setConnecting(false);
    if (draftJson) handleImportAndValidate();
  }, [config.comfyUrl, draftJson, loadComfyUIData, handleImportAndValidate]);

  const handleOverrideMapping = useCallback((role: string, nodeId: string, inputKey: string) => {
    setMapping((prev) => {
      const next = { ...prev, custom: { ...prev.custom } } as WorkflowParamMapping;
      setMappingParam(next, role as keyof WorkflowParamMapping, (nodeId && inputKey) ? { nodeId, inputKey } : undefined);
      return next;
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Section icon={<Wand2 size={16} />} title="自定义工作流">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: '2px' }}>使用自定义工作流</div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                关闭则使用内置默认流程（Checkpoint → KSampler → VAE Decode）
              </div>
            </div>
            <Toggle value={config.comfyUseCustomWorkflow} onChange={(v) => updateConfig('comfyUseCustomWorkflow', v)} />
          </div>
        </div>
        {presets.length > 0 && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 500, marginBottom: '8px', fontSize: '13px' }}>已保存的工作流</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {presets.map((p) => (
                <PresetCard key={p.id} preset={p} isActive={activeId === p.id}
                  onActivate={() => updateConfig('comfyActiveWorkflowId', p.id)}
                  onEdit={() => handleEditPreset(p)} onDelete={() => handleDeletePreset(p.id)} />
              ))}
            </div>
          </div>
        )}
        <ImportPanel
          editingPreset={editingPreset} draftName={draftName} draftJson={draftJson}
          importError={importError} validation={validation} detectedNodes={detectedNodes}
          mapping={mapping} presetsCount={presets.length} connecting={connecting}
          onNameChange={setDraftName} onJsonChange={setDraftJson}
          onValidate={handleImportAndValidate} onRevalidate={handleRevalidate}
          onOverrideMapping={handleOverrideMapping} onSave={handleSavePreset} onCancel={resetDraft}
        />
      </Section>
    </div>
  );
}
