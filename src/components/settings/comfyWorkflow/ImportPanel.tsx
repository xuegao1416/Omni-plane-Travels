// ComfyUI 工作流编辑器 — 导入/验证面板
import { XCircle, RefreshCw } from 'lucide-react';
import { Collapsible, Field, Button, TextArea } from '../SettingsUIComponents';
import { ValidationPanel } from './ValidationPanel';
import { MappingPanel } from './MappingPanel';
import type { WorkflowValidation, DetectedNode, WorkflowParamMapping } from '@/api/imageGenTypes';

export interface ImportPanelProps {
  editingPreset: string | null;
  draftName: string;
  draftJson: string;
  importError: string;
  validation: WorkflowValidation | null;
  detectedNodes: DetectedNode[];
  mapping: WorkflowParamMapping;
  presetsCount: number;
  connecting: boolean;
  workflowSummary: Array<{ label: string; value: string }>;
  onNameChange: (name: string) => void;
  onJsonChange: (json: string) => void;
  onValidate: () => void;
  onRevalidate: () => void;
  onOverrideMapping: (role: string, nodeId: string, inputKey: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ImportPanel({
  editingPreset,
  draftName,
  draftJson,
  importError,
  validation,
  detectedNodes,
  mapping,
  presetsCount,
  connecting,
  workflowSummary,
  onNameChange,
  onJsonChange,
  onValidate,
  onRevalidate,
  onOverrideMapping,
  onSave,
  onCancel,
}: ImportPanelProps) {
  return (
    <Collapsible
      title={editingPreset ? `编辑: ${draftName || '未命名'}` : '导入新工作流'}
      desc="支持 ComfyUI 导出的 API 格式或标准 Workflow 格式，自动识别并转换"
      defaultOpen={presetsCount === 0}
    >
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Field label="工作流名称" hint="给这个工作流起个名字">
          <input
            className="input-field"
            style={{ width: '100%', padding: '6px 10px' }}
            value={draftName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="例如：Hires Fix + ControlNet"
          />
        </Field>

        <Field label="Workflow JSON" hint="ComfyUI 中 Workflow → Export 或 Export (API) 均可，自动识别格式">
          <TextArea
            value={draftJson}
            onChange={onJsonChange}
            placeholder={`{ "3": { "class_type": "CheckpointLoaderSimple", ... }, ... }  或  { "nodes": [...], "links": [...] }`}
            rows={8}
            mono
          />
        </Field>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button onClick={onValidate} primary disabled={!draftJson.trim()}>
            验证并识别节点
          </Button>
          <Button onClick={onRevalidate} disabled={connecting}>
            <RefreshCw size={14} style={{ marginRight: '4px' }} />
            {connecting ? '连接中...' : '重新连接验证'}
          </Button>
          {importError && (
            <span style={{ color: 'var(--danger)', fontSize: '12px' }}>
              <XCircle size={12} style={{ verticalAlign: 'middle', marginRight: '2px' }} />
              {importError}
            </span>
          )}
        </div>

        {/* 验证结果 */}
        {validation && (
          <ValidationPanel validation={validation} />
        )}

        {/* 工作流摘要 */}
        {workflowSummary.length > 0 && (
          <div style={{
            padding: '8px 12px',
            borderRadius: '6px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            fontSize: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
          }}>
            {workflowSummary.map((item) => (
              <span key={item.label} style={{ color: 'var(--text-secondary)' }}>
                <strong>{item.label}:</strong> {item.value}
              </span>
            ))}
          </div>
        )}

        {/* 映射配置 */}
        {detectedNodes.length > 0 && (
          <MappingPanel
            detectedNodes={detectedNodes}
            mapping={mapping}
            onOverride={onOverrideMapping}
          />
        )}

        {/* 保存 */}
        {validation && detectedNodes.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <Button onClick={onSave} primary disabled={!draftName.trim()}>
              {editingPreset ? '更新工作流' : '保存工作流'}
            </Button>
            {editingPreset && (
              <Button onClick={onCancel}>
                取消
              </Button>
            )}
          </div>
        )}
      </div>
    </Collapsible>
  );
}
