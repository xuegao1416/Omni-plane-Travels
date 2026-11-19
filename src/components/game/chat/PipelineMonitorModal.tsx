// ============================================================
// 管线监控弹窗 - 独立 UI，从输入框旁按钮打开
// ============================================================

import { useState,type CSSProperties } from 'react';
import type { PipelineStatus as PipelineStatusType,PipelineStageResult,PipelineTaskId } from '../../../engine/pipelineTypes';
import { STAGE_LABELS } from '../../../engine/pipelineTypes';
import { STAGE_META,STAGE_ORDER,STATUS_CONFIG,formatMs } from './pipelineUI';
import { RETRYABLE_STAGES } from '../../../engine/pipelineExecutor';
import { X,ChevronDown,ChevronRight,RefreshCw,Copy,Check,Minus } from 'lucide-react';
import OverlayPortal from '../../shared/OverlayPortal';
import PlanarFrame from '../../../ui/planar/PlanarFrame';
import '../../../ui/screens/pipeline-monitor.css';

interface Props {
  status: PipelineStatusType | null;
  onClose: () => void;
  onRetrySingleStage?: (taskId: PipelineTaskId) => void;
  onRetryPipeline?: () => void;
  isGenerating?: boolean;
}

const stageElapsed = (stage: PipelineStageResult) => stage.startTime && stage.endTime ? stage.endTime - stage.startTime : undefined;

export default function PipelineMonitorModal({ status, onClose, onRetrySingleStage, onRetryPipeline, isGenerating }: Props) {
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const toggleError = (id: string) => setExpandedErrors((prev) => ({ ...prev, [id]: !prev[id] }));
  const copyError = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      /* 复制失败静默处理 */
    }
  };

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
  const settled = stages.filter(s => s.stage.status !== 'pending' && s.stage.status !== 'running').length;
  const progress = stages.length ? settled / stages.length : 0;

  return (
    <OverlayPortal className="game-journey__nested-overlay pm-overlay" ariaLabel="管线监控" onClose={onClose}>
      <PlanarFrame className="pm-dialog" variant="plate" onClick={e => e.stopPropagation()}>
        <header className="pm-header">
          <div className="pm-header__copy">
            <small>第 {status.round} 轮 · 回合管线</small>
            <h2 className="pk-title">管线监控</h2>
            <p className={runningStage ? 'is-running' : undefined}>
              {runningStage
                ? `${STAGE_LABELS[runningStage.id]} 执行中`
                : allDone
                  ? `本轮完成 · ${formatMs(elapsed)}`
                  : '等待开始'}
            </p>
          </div>
          <div className="pm-header__tally">
            {successCount > 0 && <span className="pm-tally is-success"><Check />{successCount}</span>}
            {skipCount > 0 && <span className="pm-tally is-skipped"><Minus />{skipCount}</span>}
            {errorCount > 0 && <span className="pm-tally is-error"><X />{errorCount}</span>}
            {onRetryPipeline && status.stages.main.status === 'success' && (
              <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm" onClick={onRetryPipeline} disabled={isGenerating}>补交未完成步骤</button>
            )}
            <button type="button" className="pm-close" onClick={onClose} aria-label="关闭管线监控"><X /></button>
          </div>
        </header>

        {/* 流程轨道：每个任务一枚刻度珠，已结算部分沿黄铜轨点亮 */}
        <div className="pm-flow" style={{ '--pm-progress': progress } as CSSProperties}>
          <ol className="pm-flow__track">
            {stages.map(({ id, stage }) => {
              const meta = STAGE_META[id];
              return (
                <li key={id} className={`pm-node is-${stage.status}`} style={{ '--c': meta.color } as CSSProperties} title={`${STAGE_LABELS[id]} · ${STATUS_CONFIG[stage.status]?.label ?? ''}`}>
                  <span className="pm-node__bead"><meta.icon /></span>
                  <span className="pm-node__label">{STAGE_LABELS[id]}</span>
                  <span className="pm-node__state">
                    {stage.status === 'running' ? '…' : stage.status === 'success' ? formatMs(stageElapsed(stage)) : stage.status === 'skipped' ? '跳过' : stage.status === 'error' ? '异常' : stage.status === 'warning' ? '降级' : '待命'}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="pm-list">
          {stages.map(({ id, stage }, index) => {
            const meta = STAGE_META[id];
            const statusCfg = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending;
            const took = stageElapsed(stage);
            const retryable = !isGenerating && id !== 'main' && (stage.status === 'error' || stage.status === 'warning') && RETRYABLE_STAGES.has(id) && onRetrySingleStage;
            return (
              <div key={id} className={`pm-row is-${stage.status}`} style={{ '--c': meta.color, animationDelay: `${Math.min(index, 8) * 24}ms` } as CSSProperties}>
                <div className="pm-row__main">
                  <span className="pm-row__icon"><meta.icon /></span>
                  <div className="pm-row__copy">
                    <strong>{STAGE_LABELS[id]}</strong>
                    <span>{meta.desc}</span>
                  </div>
                  <div className="pm-row__status">
                    <b>{statusCfg.label}{stage.status === 'success' && took != null ? ` · ${formatMs(took)}` : ''}</b>
                    {stage.dataLength != null && <small>{stage.dataLength} 字</small>}
                  </div>
                  {retryable && (
                    <button type="button" className="pm-icon-btn" onClick={() => onRetrySingleStage(id)} title="重试此步骤" aria-label={`重试${STAGE_LABELS[id]}`}>
                      <RefreshCw />
                    </button>
                  )}
                </div>
                {stage.status === 'error' && stage.error && (
                  <div className="pm-row__error">
                    <div className="pm-row__error-actions">
                      <button type="button" className="pm-chip" onClick={() => toggleError(id)} aria-expanded={Boolean(expandedErrors[id])}>
                        {expandedErrors[id] ? <ChevronDown /> : <ChevronRight />}
                        <span>{expandedErrors[id] ? '收起' : '查看详情'}</span>
                      </button>
                      <button type="button" className="pm-chip" onClick={() => copyError(id, stage.error!)}>
                        <Copy />
                        <span>{copiedId === id ? '已复制' : '复制'}</span>
                      </button>
                    </div>
                    {expandedErrors[id] && <pre>{stage.error}</pre>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <footer className="pm-footer">
          <span>总耗时</span>
          <strong>{formatMs(elapsed) || '—'}</strong>
        </footer>
      </PlanarFrame>
    </OverlayPortal>
  );
}
