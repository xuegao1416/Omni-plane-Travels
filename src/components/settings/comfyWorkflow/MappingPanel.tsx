// ComfyUI 工作流编辑器 — 映射配置面板
import { CheckCircle } from 'lucide-react';
import { ROLE_LABELS, ROLE_ORDER } from './constants';
import { getMappingParam } from './utils';
import type { DetectedNode, WorkflowParamMapping } from '@/api/imageGenTypes';

export function MappingPanel({
  detectedNodes,
  mapping,
  onOverride,
}: {
  detectedNodes: DetectedNode[];
  mapping: WorkflowParamMapping;
  onOverride: (role: string, nodeId: string, inputKey: string) => void;
}) {
  // 构建所有可选注入点
  const allInjectPoints: { label: string; nodeId: string; inputKey: string }[] = [];
  for (const n of detectedNodes) {
    for (const ik of n.inputs) {
      allInjectPoints.push({
        label: `[${n.classType}] #${n.nodeId} → ${ik}`,
        nodeId: n.nodeId,
        inputKey: ik,
      });
    }
  }

  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: '6px',
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      fontSize: '12px',
    }}>
      <div style={{ fontWeight: 600, marginBottom: '8px' }}>参数映射配置</div>

      {/* 按角色顺序显示映射 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {ROLE_ORDER.map((role) => {
          const current = getMappingParam(mapping, role as keyof WorkflowParamMapping);
          return (
            <div key={role} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '80px', fontWeight: 500, flexShrink: 0, color: current ? 'var(--success, #10b981)' : 'var(--text-secondary)' }}>
                {current ? <CheckCircle size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> : null}
                {ROLE_LABELS[role] || role}
              </span>
              <select
                className="input-field"
                style={{ flex: 1, padding: '4px 8px', fontSize: '12px' }}
                value={current ? `${current.nodeId}.${current.inputKey}` : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) {
                    onOverride(role, '', '');
                  } else {
                    const dotIdx = val.indexOf('.');
                    const nid = val.slice(0, dotIdx);
                    const ik = val.slice(dotIdx + 1);
                    onOverride(role, nid, ik);
                  }
                }}
              >
                <option value="">（未映射）</option>
                {allInjectPoints.map((p) => (
                  <option key={`${p.nodeId}.${p.inputKey}`} value={`${p.nodeId}.${p.inputKey}`}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
