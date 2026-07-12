// ComfyUI 工作流编辑器 — 验证面板
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import type { WorkflowValidation } from '@/api/imageGenTypes';

export function ValidationPanel({ validation }: { validation: WorkflowValidation }) {
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: '6px',
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      fontSize: '12px',
    }}>
      <div style={{ fontWeight: 600, marginBottom: '6px' }}>
        {validation.valid ? (
          <span style={{ color: 'var(--success)' }}>
            <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            验证通过
          </span>
        ) : (
          <span style={{ color: 'var(--danger)' }}>
            <XCircle size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            发现问题
          </span>
        )}
      </div>

      {validation.fatalErrors.length > 0 && (
        <div style={{ marginBottom: '4px' }}>
          {validation.fatalErrors.map((e, i) => (
            <div key={i} style={{ color: 'var(--danger)', marginBottom: '2px' }}>
              <XCircle size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
              {e}
            </div>
          ))}
        </div>
      )}

      {validation.missing.length > 0 && (
        <div>
          <div style={{ color: 'var(--warning)', fontWeight: 500, marginBottom: '2px' }}>
            <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            缺失节点（本地 ComfyUI 中未安装）:
          </div>
          {validation.missing.map((m, i) => (
            <div key={i} style={{ color: 'var(--warning)', paddingLeft: '16px' }}>
              {m}
            </div>
          ))}
        </div>
      )}

      {validation.modelWarnings.length > 0 && (
        <div>
          <div style={{ color: 'var(--warning)', fontWeight: 500, marginBottom: '2px' }}>
            <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            资源不可用（模型 / VAE / Lora 等）:
          </div>
          {validation.modelWarnings.map((w, i) => (
            <div key={i} style={{ color: 'var(--warning)', paddingLeft: '16px' }}>
              {w}
            </div>
          ))}
        </div>
      )}

      {validation.fatalErrors.length === 0 && validation.missing.length === 0 && validation.modelWarnings.length === 0 && (
        <div style={{ color: 'var(--text-secondary)' }}>
          已识别 {validation.nodeTypes.length} 种节点类型，全部可用
        </div>
      )}
    </div>
  );
}
