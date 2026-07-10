/**
 * 生存资源详情覆盖层
 *
 * 对标 BusinessOverlay，包含：
 * - 资源总览（所有资源 + 进度条 + 详细描述）
 * - 资源详情（gatherRate、usage、description）
 * - 变更日志（最近 N 次资源变化 + 原因）
 * - 演化蓝图进度（当前阶段 + 下一阶段触发条件）
 */
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, X, Leaf, ScrollText, AlertTriangle, Clock, Zap } from 'lucide-react';
import type { SurvivalModuleSchema, ResourceEvolutionStep } from '../../../modules/schema';
import type { ResourceChangeLog } from '../gameScreen/hooks/useSurvivalSettlement';

interface SurvivalOverlayProps {
  open: boolean;
  data: SurvivalModuleSchema;
  title?: string;
  onClose: () => void;
  /** 运行时资源数量（来自变量系统） */
  runtimeResources?: Record<string, { 数量: number }>;
  /** 资源变更日志 */
  changeLog?: ResourceChangeLog[];
}

export default function SurvivalOverlay({
  open, data, title, onClose, runtimeResources, changeLog,
}: SurvivalOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [expandedResource, setExpandedResource] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => setAnimating(true));
    } else {
      setAnimating(false);
      const timer = setTimeout(() => { setVisible(false); setExpandedResource(null); }, 250);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!visible) return null;

  const threshold = data.rules?.criticalThreshold ?? 2;

  // 合并静态资源定义和运行时数量
  const mergedResources = (data.resources ?? []).map(res => ({
    ...res,
    amount: runtimeResources?.[res.id]?.数量 ?? res.amount,
  }));

  // 追加运行时存在但静态定义中没有的资源（演化新增）
  if (runtimeResources) {
    for (const [id, rt] of Object.entries(runtimeResources)) {
      if (!mergedResources.some(r => r.id === id)) {
        mergedResources.push({
          id, name: id, symbol: '❓',
          amount: rt.数量, max: 99, scarce: false,
          description: '新发现的资源',
        });
      }
    }
  }

  return (
    <>
      {/* 背景遮罩 */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.4)', zIndex: 99,
          opacity: animating ? 1 : 0, transition: 'opacity 0.25s ease',
        }}
      />
      {/* 面板 */}
      <div
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: '380px', maxWidth: '100vw',
          background: 'var(--bg-primary)',
          zIndex: 100, display: 'flex', flexDirection: 'column',
          transform: animating ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          borderLeft: '1px solid var(--border)',
        }}
      >
        {/* ── 顶部栏 ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-secondary)', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            background: 'var(--bg-tertiary)', border: 'none', borderRadius: '8px',
            width: '32px', height: '32px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
          }}>
            <ArrowLeft size={16} />
          </button>
          <span style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)', flex: 1 }}>
            {title || '生存资源'}
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* ── 内容区 ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* ── 系统描述 ── */}
          {data.description && (
            <div className="surface-card" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <Leaf size={16} color="var(--accent)" />
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>系统说明</span>
              </div>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                {data.description}
              </p>
              {data.rules?.consumePerCycle && (
                <div style={{
                  fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
                  marginTop: '6px', padding: '4px 8px', borderRadius: '6px',
                  background: 'var(--bg-tertiary)',
                }}>
                  ⏱ {data.rules.consumePerCycle}
                </div>
              )}
            </div>
          )}

          {/* ── 资源详情列表 ── */}
          <div>
            <div style={{
              fontSize: 'var(--font-size-sm)', fontWeight: 600,
              color: 'var(--text-muted)', marginBottom: '8px',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              资源详情 ({mergedResources.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {mergedResources.map(res => {
                const pct = res.max > 0 ? Math.round((res.amount / res.max) * 100) : 0;
                const isCritical = res.amount > 0 && res.amount <= threshold;
                const isEmpty = res.amount === 0;
                const isExpanded = expandedResource === res.id;
                const barColor = isEmpty ? 'var(--text-muted)' : isCritical ? '#ef4444' : res.scarce ? '#f59e0b' : '#22c55e';

                return (
                  <div
                    key={res.id}
                    onClick={() => setExpandedResource(isExpanded ? null : res.id)}
                    style={{
                      padding: '10px 12px', borderRadius: '8px',
                      border: `1px solid ${isCritical ? '#ef444440' : 'var(--border)'}`,
                      background: isCritical ? '#ef444408' : 'var(--bg-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {/* 头部：名称 + 数量 */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: '6px',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '16px' }}>{res.symbol}</span>
                        <span style={{ fontWeight: 600, color: isCritical ? '#ef4444' : 'var(--text-primary)' }}>
                          {res.name}
                        </span>
                        {res.scarce && (
                          <span style={{
                            fontSize: '10px', padding: '0 4px', borderRadius: '6px',
                            background: '#f59e0b20', color: '#f59e0b',
                          }}>稀缺</span>
                        )}
                        {isCritical && <AlertTriangle size={12} color="#ef4444" />}
                        {isEmpty && <span style={{ fontSize: '10px', color: '#ef4444' }}>已耗尽</span>}
                      </span>
                      <span style={{
                        fontWeight: 600, fontSize: 'var(--font-size-sm)',
                        color: isEmpty ? 'var(--text-muted)' : isCritical ? '#ef4444' : 'var(--text-primary)',
                      }}>
                        {res.amount}/{res.max}
                      </span>
                    </div>

                    {/* 进度条 */}
                    <div style={{
                      height: '6px', background: 'var(--bg-tertiary)',
                      borderRadius: '3px', overflow: 'hidden', marginBottom: '4px',
                    }}>
                      <div style={{
                        width: `${pct}%`, height: '100%',
                        background: barColor, borderRadius: '3px',
                        transition: 'width 0.3s',
                      }} />
                    </div>

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div style={{
                        marginTop: '8px', paddingTop: '8px',
                        borderTop: '1px solid var(--border)',
                        fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)',
                        display: 'flex', flexDirection: 'column', gap: '4px',
                      }}>
                        {res.description && (
                          <div style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            {res.description}
                          </div>
                        )}
                        {res.gatherRate && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Zap size={10} color="var(--accent)" />
                            <span>采集：{res.gatherRate}</span>
                          </div>
                        )}
                        {res.usage && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={10} color="var(--text-muted)" />
                            <span>消耗：{res.usage}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 演化蓝图 ── */}
          {data.resourceEvolution && data.resourceEvolution.length > 0 && (
            <div className="surface-card" style={{ padding: '12px 16px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: 'var(--font-size-sm)', fontWeight: 600,
                color: 'var(--text-muted)', marginBottom: '8px',
              }}>
                🧬 演化蓝图
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {data.resourceEvolution.map((step, i) => (
                  <EvolutionStepCard key={step.id} step={step} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* ── 变更日志 ── */}
          {changeLog && changeLog.length > 0 && (
            <div className="surface-card" style={{ padding: '12px 16px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: 'var(--font-size-sm)', fontWeight: 600,
                color: 'var(--text-muted)', marginBottom: '8px',
              }}>
                <ScrollText size={14} />
                变更日志
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {changeLog.slice(-10).reverse().map((entry, i) => (
                  <div key={i} style={{
                    fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)',
                    padding: '4px 0',
                    borderBottom: i < Math.min(changeLog.length, 10) - 1 ? '1px solid var(--border)' : undefined,
                  }}>
                    {entry.changes.map((c, j) => (
                      <div key={j} style={{
                        display: 'flex', alignItems: 'center', gap: '4px',
                        color: c.after < c.before ? '#ef4444' : c.after > c.before ? '#22c55e' : 'var(--text-muted)',
                      }}>
                        <span>{c.symbol}</span>
                        <span>{c.resourceName}</span>
                        <span style={{ fontWeight: 600 }}>{c.before}→{c.after}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>{c.reason}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/** 演化蓝图单步卡片 */
function EvolutionStepCard({ step, index }: { step: ResourceEvolutionStep; index: number }) {
  return (
    <div style={{
      padding: '8px 10px', borderRadius: '6px',
      border: '1px solid var(--border)', background: 'var(--bg-tertiary)',
    }}>
      <div style={{
        fontSize: 'var(--font-size-xs)', fontWeight: 600,
        color: 'var(--text-primary)', marginBottom: '4px',
      }}>
        阶段 {index + 1}：{step.id}
      </div>

      {/* 触发条件 */}
      {step.trigger?.keywords?.length > 0 && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
          触发词：{step.trigger.keywords.join('、')}
        </div>
      )}

      {/* 新增资源 */}
      {step.add && step.add.length > 0 && (
        <div style={{ fontSize: '10px', color: '#22c55e' }}>
          + 新增：{step.add.map(r => `${r.symbol}${r.name}`).join('、')}
        </div>
      )}

      {/* 淘汰资源 */}
      {step.remove && step.remove.length > 0 && (
        <div style={{ fontSize: '10px', color: '#ef4444' }}>
          - 淘汰：{step.remove.join('、')}
        </div>
      )}

      {/* 叙事提示 */}
      {step.narrateHint && (
        <div style={{
          fontSize: '10px', color: 'var(--text-muted)',
          fontStyle: 'italic', marginTop: '4px',
        }}>
          "{step.narrateHint}"
        </div>
      )}
    </div>
  );
}
