// ============================================================
// 管线监控弹窗 - 独立 UI，从输入框旁按钮打开
// ============================================================

import { useState } from 'react';
import type { PipelineStatus as PipelineStatusType, PipelineStageResult, PipelineTaskId } from '../../../engine/pipelineTypes';
import { STAGE_LABELS } from '../../../engine/pipelineTypes';
import { STAGE_META, STAGE_ORDER, STATUS_CONFIG, formatMs } from './pipelineUI';
import { RETRYABLE_STAGES } from '../../../engine/pipelineExecutor';
import { X, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

interface Props {
  status: PipelineStatusType | null;
  onClose: () => void;
  onRetrySingleStage?: (taskId: PipelineTaskId) => void;
  isGenerating?: boolean;
}

export default function PipelineMonitorModal({ status, onClose, onRetrySingleStage, isGenerating }: Props) {
  const [expanded, setExpanded] = useState(true);

  if (!status) return null;

  const stages = STAGE_ORDER
    .map(id => ({ id, stage: status.stages[id] }))
    .filter((s): s is { id: PipelineTaskId; stage: PipelineStageResult } => Boolean(s.stage));

  const allDone = stages.every(s => s.stage.status !== 'pending' && s.stage.status !== 'running');
  const elapsed = status.endTime ? status.endTime - status.startTime : undefined;
  const successCount = stages.filter(s => s.stage.status === 'success').length;
  const skipCount = stages.filter(s => s.stage.status === 'skipped').length;
  const errorCount = stages.filter(s => s.stage.status === 'error').length;
  const runningStage = stages.find(s => s.stage.status === 'running');

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>管线监控</h3>
            <p style={styles.subtitle}>
              {runningStage
                ? `${STAGE_LABELS[runningStage.id]} 执行中...`
                : allDone
                  ? `本轮完成 · ${formatMs(elapsed)}`
                  : `第 ${status.round} 轮`
              }
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {successCount > 0 && <span style={{ fontSize: 'var(--font-size-sm)', color: '#4caf50' }}>✓{successCount}</span>}
            {skipCount > 0 && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>-{skipCount}</span>}
            {errorCount > 0 && <span style={{ fontSize: 'var(--font-size-sm)', color: '#f44336' }}>✕{errorCount}</span>}
            <button onClick={onClose} style={styles.closeBtn}><X size={16} /></button>
          </div>
        </div>

        {/* 流程可视化（横向滑动） */}
        <div style={{
          ...styles.flowBar,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 'max-content' }}>
            {stages.map(({ id, stage }, i) => {
              const meta = STAGE_META[id];
              const isRunning = stage.status === 'running';
              const isSuccess = stage.status === 'success';
              const isSkipped = stage.status === 'skipped';
              const isError = stage.status === 'error';

              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    padding: '6px 8px', borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${isRunning ? meta.color : isSuccess ? `${meta.color}88` : 'var(--border)'}`,
                    background: isSuccess ? `${meta.color}11` : isError ? 'rgba(244,67,54,0.08)' : isRunning ? `${meta.color}11` : 'var(--bg-primary)',
                    minWidth: '52px', position: 'relative',
                  }}>
                    {isRunning && (
                      <div style={{
                        position: 'absolute', inset: '-2px', borderRadius: 'var(--radius-md)',
                        border: `2px solid ${meta.color}44`,
                        animation: 'pipeline-pulse 1.5s ease-in-out infinite',
                      }} />
                    )}
                    <span style={{ display: 'flex', marginBottom: '2px', color: meta.color }}><meta.icon size={16} /></span>
                    <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: isRunning || isSuccess ? meta.color : 'var(--text-muted)' }}>
                      {STAGE_LABELS[id]}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: STATUS_CONFIG[stage.status]?.color || '#666', marginTop: '1px' }}>
                      {isRunning ? '...' : isSuccess ? `✓${formatMs(stage.startTime && stage.endTime ? stage.endTime - stage.startTime : undefined)}` : isSkipped ? '-' : isError ? '✕' : '○'}
                    </span>
                  </div>
                  {i < stages.length - 1 && (
                    <div style={{ width: '6px', height: '2px', background: isSuccess ? `${meta.color}44` : 'var(--border)' }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 详情列表 */}
        <div style={styles.detailList}>
          {stages.map(({ id, stage }) => {
            const meta = STAGE_META[id];
            const statusCfg = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending;
            const elapsed = stage.startTime && stage.endTime ? stage.endTime - stage.startTime : undefined;

            return (
              <div key={id} style={{
                ...styles.detailRow,
                borderLeftColor: stage.status === 'running' ? meta.color
                  : stage.status === 'success' ? meta.color
                  : stage.status === 'error' ? '#f44336'
                  : 'var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                  <span style={{ display: 'flex', color: meta.color }}><meta.icon size={14} /></span>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {STAGE_LABELS[id]}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '1px' }}>
                      {meta.desc}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'right' }}>
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: statusCfg.color }}>
                      {statusCfg.label}
                      {stage.status === 'success' && elapsed != null ? ` · ${formatMs(elapsed)}` : ''}
                    </div>
                    {stage.status === 'error' && stage.error && (
                      <div style={{ fontSize: 'var(--font-size-xs)', color: '#f44336', marginTop: '2px', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {stage.error}
                      </div>
                    )}
                    {stage.dataLength != null && (
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                        {stage.dataLength} 字
                      </div>
                    )}
                  </div>
                  {allDone && (stage.status === 'success' || stage.status === 'error') && RETRYABLE_STAGES.has(id) && onRetrySingleStage && (
                    <button
                      onClick={() => { onRetrySingleStage(id); }}
                      disabled={isGenerating}
                      title="重试此步骤"
                      style={styles.retrySmallBtn}
                    >
                      <RefreshCw size={11} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 总耗时 */}
        <div style={styles.footer}>
          <span>总耗时</span>
          <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{formatMs(elapsed)}</span>
        </div>
      </div>

      <style>{`
        @keyframes pipeline-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9980,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(6,6,14,0.5)',
    backdropFilter: 'blur(8px)',
  },
  modal: {
    width: 'min(700px, 92vw)',
    borderRadius: 'var(--radius-xl)',
    border: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
  },
  title: { margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' },
  subtitle: { margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' },
  closeBtn: {
    width: '28px', height: '28px', borderRadius: '50%',
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text-muted)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  flowBar: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '14px 16px', gap: '2px', flexWrap: 'wrap',
    borderBottom: '1px solid var(--border)',
  },
  detailList: {
    padding: '12px 16px',
    display: 'flex', flexDirection: 'column', gap: '8px',
    maxHeight: '440px', overflow: 'auto',
  },
  detailRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-primary)',
    borderLeft: '3px solid',
  },
  footer: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 20px',
    borderTop: '1px solid var(--border)',
    fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)',
  },
  retryBtn: {
    display: 'flex', alignItems: 'center', gap: '4px',
    padding: '5px 12px', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--accent)', background: 'transparent',
    color: 'var(--accent)', cursor: 'pointer',
    fontSize: 'var(--font-size-sm)', fontWeight: 600,
  },
  retrySmallBtn: {
    width: '24px', height: '24px', borderRadius: '50%',
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text-muted)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'all 0.15s',
  },
};
