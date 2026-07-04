import { useState } from 'react';
import type { PipelineStatus as PipelineStatusType, PipelineStageResult, PipelineTaskId } from '../../../engine/pipelineTypes';
import { STAGE_LABELS } from '../../../engine/pipelineTypes';
import { STAGE_META, STAGE_ORDER, STATUS_CONFIG, formatMs } from './pipelineUI';
import { ChevronDown, ChevronRight } from 'lucide-react';

// ─── 流程节点 ───

function StageNode({ taskId, stage, isLast }: {
  taskId: PipelineTaskId;
  stage: PipelineStageResult;
  isLast: boolean;
}) {
  const meta = STAGE_META[taskId];
  const statusCfg = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending;
  const elapsed = stage.startTime && stage.endTime ? stage.endTime - stage.startTime : undefined;
  const isActive = stage.status === 'running';

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {/* 节点 */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '4px 6px', borderRadius: 'var(--radius-md)',
        border: `1.5px solid ${isActive ? meta.color : stage.status === 'success' ? `${meta.color}66` : stage.status === 'warning' ? '#ff980066' : 'var(--border)'}`,
        background: stage.status === 'success' ? `${meta.color}11`
          : stage.status === 'warning' ? 'rgba(255,152,0,0.08)'
          : stage.status === 'error' ? 'rgba(244,67,54,0.08)'
          : isActive ? `${meta.color}11`
          : 'var(--bg-secondary)',
        minWidth: '48px', position: 'relative',
        transition: 'all 0.3s',
      }}>
        {/* 脉冲动画 */}
        {isActive && (
          <div style={{
            position: 'absolute', inset: '-2px', borderRadius: 'var(--radius-md)',
            border: `2px solid ${meta.color}44`,
            animation: 'pipeline-pulse 1.5s ease-in-out infinite',
          }} />
        )}

        <span style={{ display: 'flex', marginBottom: '2px', color: meta.color }}><meta.icon size={14} /></span>

        <span style={{
          fontSize: 'var(--font-size-sm)', fontWeight: 600, whiteSpace: 'nowrap',
          color: isActive ? meta.color : stage.status === 'success' ? meta.color : 'var(--text-muted)',
        }}>
          {STAGE_LABELS[taskId]}
        </span>

        <span style={{
          fontSize: 'var(--font-size-xs)', marginTop: '1px',
          color: statusCfg.color,
        }}>
          {isActive ? '...'
            : stage.status === 'success' ? `✓${elapsed != null ? formatMs(elapsed) : ''}`
            : stage.status === 'warning' ? '⚠'
            : stage.status === 'error' ? '✕'
            : stage.status === 'skipped' ? '-'
            : '○'}
        </span>
      </div>

      {/* 连接线 */}
      {!isLast && (
        <div style={{
          width: '8px', height: '2px',
          background: stage.status === 'success' ? `${meta.color}55` : 'var(--border)',
          transition: 'background 0.3s',
        }} />
      )}
    </div>
  );
}

// ─── 主组件 ───

export default function PipelineStatusPanel({ status }: { status: PipelineStatusType | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!status) return null;

  const stages = STAGE_ORDER
    .map(id => ({ id, stage: status.stages[id] }))
    .filter((s): s is { id: PipelineTaskId; stage: PipelineStageResult } => Boolean(s.stage));

  const allDone = stages.every(s => s.stage.status !== 'pending' && s.stage.status !== 'running');
  const hasError = stages.some(s => s.stage.status === 'error');
  const warningCount = stages.filter(s => s.stage.status === 'warning').length;
  const successCount = stages.filter(s => s.stage.status === 'success').length;
  const runningStage = stages.find(s => s.stage.status === 'running');
  const elapsed = status.endTime ? status.endTime - status.startTime : undefined;

  // 分组：主链 + 记忆链 + 变量
  const mainStage = stages.filter(s => s.id === 'main');
  const memoryStages = stages.filter(s => s.id.startsWith('memory_'));
  const varStage = stages.filter(s => s.id === 'variable');

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border)',
      fontSize: 'var(--font-size-sm)',
      userSelect: 'none',
    }}>
      {/* ── 流程可视化（横向滑动） ── */}
      <div style={{
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        padding: '8px 12px 4px',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center',
          gap: '4px', minWidth: 'max-content',
        }}>
          {/* 主链 */}
          {mainStage.map((s, i) => (
            <StageNode key={s.id} taskId={s.id} stage={s.stage} isLast={false} />
          ))}

          {/* 分隔 */}
          <div style={{
            width: '1px', height: '28px', background: 'var(--border)',
            margin: '0 4px', flexShrink: 0,
          }} />

          {/* 记忆链 */}
          {memoryStages.map((s, i) => (
            <StageNode key={s.id} taskId={s.id} stage={s.stage} isLast={i === memoryStages.length - 1} />
          ))}

          {/* 分隔 */}
          <div style={{
            width: '1px', height: '28px', background: 'var(--border)',
            margin: '0 4px', flexShrink: 0,
          }} />

          {/* 变量 */}
          {varStage.map((s) => (
            <StageNode key={s.id} taskId={s.id} stage={s.stage} isLast />
          ))}
        </div>
      </div>

      {/* ── 折叠头部 ── */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '3px 14px 5px',
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: 'var(--font-size-xs)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          <span>
            {runningStage
              ? `${STAGE_LABELS[runningStage.id]} 执行中...`
              : allDone
                ? `本轮完成 · ${formatMs(elapsed)}`
                : '管线监测'}
          </span>
          {!allDone && (
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: 'var(--font-size-xs)' }}>◉</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-xs)' }}>
          {successCount > 0 && <span style={{ color: '#4caf50' }}>✓{successCount}</span>}
          {warningCount > 0 && <span style={{ color: '#ff9800' }}>⚠{warningCount}</span>}
          {hasError && <span style={{ color: '#f44336' }}>✕</span>}
          {elapsed != null && <span style={{ color: 'var(--text-muted)' }}>{formatMs(elapsed)}</span>}
        </div>
      </button>

      {/* ── 展开详情 ── */}
      {expanded && (
        <div style={{
          padding: '2px 14px 8px 24px',
          display: 'flex', flexDirection: 'column', gap: '3px',
        }}>
          {stages.map(({ id, stage }) => {
            const meta = STAGE_META[id];
            const statusCfg = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending;
            const elapsed = stage.startTime && stage.endTime ? stage.endTime - stage.startTime : undefined;

            return (
              <div key={id} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                background: stage.status === 'running' ? `${meta.color}08` : 'transparent',
              }}>
                {/* 状态点 */}
                <span style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: statusCfg.color, flexShrink: 0,
                  boxShadow: stage.status === 'running' ? `0 0 6px ${statusCfg.color}` : 'none',
                  animation: stage.status === 'running' ? 'pipeline-pulse 1.5s ease-in-out infinite' : 'none',
                }} />

                <span style={{ display: 'flex', color: meta.color, minWidth: '10px' }}><meta.icon size={12} /></span>
                <span style={{ color: 'var(--text-secondary)', minWidth: '60px', fontSize: 'var(--font-size-sm)' }}>
                  {STAGE_LABELS[id]}
                </span>

                {stage.status === 'success' && (
                  <span style={{ color: '#4caf50', fontSize: 'var(--font-size-sm)' }}>
                    成功{elapsed != null ? ` ${formatMs(elapsed)}` : ''}
                    {stage.dataLength != null ? ` (${stage.dataLength}字)` : ''}
                    {stage.extra?.count != null ? ` · ${stage.extra.count}条` : ''}
                  </span>
                )}
                {stage.status === 'warning' && (
                  <span style={{ color: '#ff9800', fontSize: 'var(--font-size-sm)' }}>
                    ⚠ 降级{stage.error ? `: ${stage.error.replace('[降级] ', '')}` : ''}
                  </span>
                )}
                {stage.status === 'error' && (
                  <span style={{ color: '#f44336', fontSize: 'var(--font-size-sm)' }}>
                    异常{stage.error ? `: ${stage.error}` : ''}
                  </span>
                )}
                {stage.status === 'running' && (
                  <span style={{ color: meta.color, fontSize: 'var(--font-size-sm)' }}>执行中...</span>
                )}
                {stage.status === 'skipped' && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>跳过</span>
                )}
                {stage.status === 'pending' && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>等待</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes pipeline-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
