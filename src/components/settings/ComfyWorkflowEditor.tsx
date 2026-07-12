// ComfyUI 自定义工作流编辑器 — 导入、验证、映射、管理
import { useState, useCallback } from 'react';
import { useImageStore } from '@/stores/imageStore';
import { useImageGen } from '@/hooks/useImageGen';
import { validateWorkflow, detectWorkflowNodes } from '@/api/imageGen';
import type { ComfyWorkflowPreset, WorkflowParamMapping, WorkflowValidation, DetectedNode } from '@/api/imageGenTypes';
import {
  createImportedComfyWorkflowRecord,
  validateAndRepairComfyApiPromptResources,
} from '@/api/comfy/comfyWorkflow';
import type { ApiPromptWorkflow } from '@/api/comfy/comfyWorkflow';
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
  const [importedApiPrompt, setImportedApiPrompt] = useState<ApiPromptWorkflow | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<Array<{ label: string; value: string }>>([]);

  const presets = config.comfyWorkflowPresets || [];
  const activeId = config.comfyActiveWorkflowId;

  const resetDraft = () => {
    setDraftJson(''); setDraftName(''); setImportError('');
    setValidation(null); setDetectedNodes([]); setMapping({ custom: {} }); setEditingPreset(null);
    setImportedApiPrompt(null); setWorkflowSummary([]);
  };

  const handleImportAndValidate = useCallback(async () => {
    setImportError(''); setValidation(null);

    try {
      // 新管线：自动检测格式（API prompt / 标准 workflow）+ 转换 + 生成摘要
      const objectInfo = (comfyData.objectInfo || {}) as Record<string, unknown>;
      const record = createImportedComfyWorkflowRecord(draftJson, {
        objectInfo,
        fileName: draftName,
      });

      const apiPrompt = record.apiPrompt;
      setImportedApiPrompt(apiPrompt);
      setWorkflowSummary(record.summaryItems);

      // 节点验证（检查缺失节点和输出节点）
      let valResult: WorkflowValidation;
      if (Object.keys(objectInfo).length > 0) {
        valResult = validateWorkflow(
          apiPrompt as unknown as Record<string, Record<string, unknown>>,
          objectInfo,
        );

        // 资源校验（新管线：检查 model/VAE/Lora 是否可用，自动修复可修复项）
        const resourceValidation = validateAndRepairComfyApiPromptResources(
          apiPrompt,
          objectInfo,
          {
            model: config.comfyModel || '',
            vae: config.comfyVae || '',
            sampler_name: config.comfySampler || '',
            scheduler: config.comfyScheduler || '',
          },
        );

        valResult.modelWarnings = resourceValidation.unresolved.map(
          (u) => `节点 ${u.nodeId}（${u.classType}）的 ${u.assetLabel} "${u.currentValue}" 不可用`,
        );
      } else {
        valResult = {
          nodeTypes: Object.values(apiPrompt).map((n) => n.class_type),
          available: [], missing: [], modelWarnings: [], fatalErrors: [], valid: true,
        };
      }
      setValidation(valResult);

      // 节点检测 + 自动映射（映射作为可选覆盖，新管线已能自动注入）
      const nodes = detectWorkflowNodes(apiPrompt as unknown as Record<string, Record<string, unknown>>);
      setDetectedNodes(nodes);
      setMapping(buildAutoMapping(nodes));
    } catch (e) {
      setImportError((e as Error).message);
      setImportedApiPrompt(null);
      setWorkflowSummary([]);
    }
  }, [draftJson, draftName, comfyData.objectInfo, config.comfyModel, config.comfyVae, config.comfySampler, config.comfyScheduler]);

  const handleSavePreset = useCallback(() => {
    if (!draftName.trim() || !importedApiPrompt) return;
    const now = Date.now();
    const id = editingPreset || `wf_${now}_${Math.random().toString(36).substr(2, 6)}`;
    const preset: ComfyWorkflowPreset = {
      id, name: draftName.trim(),
      workflow: importedApiPrompt as unknown as Record<string, Record<string, unknown>>,
      paramMapping: mapping,
      validation: validation || { nodeTypes: [], available: [], missing: [], modelWarnings: [], fatalErrors: [], valid: true },
      createdAt: editingPreset ? (presets.find((p) => p.id === id)?.createdAt || now) : now, updatedAt: now,
    };
    const newPresets = editingPreset ? presets.map((p) => (p.id === id ? preset : p)) : [...presets, preset];
    updateConfig('comfyWorkflowPresets', newPresets);
    if (!editingPreset) { updateConfig('comfyActiveWorkflowId', id); updateConfig('comfyUseCustomWorkflow', true); }
    resetDraft();
  }, [draftName, importedApiPrompt, mapping, validation, editingPreset, presets, updateConfig]);

  const handleEditPreset = useCallback((preset: ComfyWorkflowPreset) => {
    setEditingPreset(preset.id); setDraftName(preset.name);
    setDraftJson(JSON.stringify(preset.workflow, null, 2));
    setMapping(preset.paramMapping); setValidation(preset.validation);
    setDetectedNodes(detectWorkflowNodes(preset.workflow));
    setImportedApiPrompt(preset.workflow as unknown as ApiPromptWorkflow);
    setWorkflowSummary([]); setImportError('');
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
          workflowSummary={workflowSummary}
          onNameChange={setDraftName} onJsonChange={setDraftJson}
          onValidate={handleImportAndValidate} onRevalidate={handleRevalidate}
          onOverrideMapping={handleOverrideMapping} onSave={handleSavePreset} onCancel={resetDraft}
        />
      </Section>
    </div>
  );
}
