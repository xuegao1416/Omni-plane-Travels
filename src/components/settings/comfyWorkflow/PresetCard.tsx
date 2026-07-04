// ComfyUI 工作流编辑器 — 预设卡片
import { CheckCircle, XCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '../SettingsUIComponents';
import type { ComfyWorkflowPreset } from '@/api/imageGenTypes';

export function PresetCard({
  preset,
  isActive,
  onActivate,
  onEdit,
  onDelete,
}: {
  preset: ComfyWorkflowPreset;
  isActive: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const nodeCount = Object.values(preset.workflow).filter((n) => n?.class_type).length;
  const hasMissing = preset.validation.missing.length > 0;
  const hasFatal = preset.validation.fatalErrors.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderRadius: '6px',
        background: isActive ? 'var(--accent-dim)' : 'var(--bg-secondary)',
        border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
        cursor: 'pointer',
      }}
      onClick={onActivate}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
        <span style={{
          fontWeight: 500,
          fontSize: '13px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {preset.name}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
          {nodeCount} 节点
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {hasFatal ? (
          <XCircle size={14} color="var(--danger)" />
        ) : hasMissing ? (
          <AlertTriangle size={14} color="var(--warning, #f59e0b)" />
        ) : (
          <CheckCircle size={14} color="var(--success, #10b981)" />
        )}
        {isActive && (
          <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 500 }}>使用中</span>
        )}
        <div onClick={(e) => e.stopPropagation()}>
          <Button onClick={onEdit}>编辑</Button>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Button onClick={onDelete}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
