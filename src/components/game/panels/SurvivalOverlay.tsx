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
import { ArrowLeft, X, Leaf, ScrollText, AlertTriangle, Clock, Zap, Backpack, Hammer, Sparkle, Trash2 } from 'lucide-react';
import type { InventoryItem } from '../../../schema/variables';
import type { SurvivalModuleSchema, ResourceEvolutionStep, SurvivalRecipe } from '../../../modules/schema';
import type { ResourceChangeLog } from '../gameScreen/hooks/useSurvivalSettlement';

interface SurvivalOverlayProps {
  open: boolean;
  data: SurvivalModuleSchema;
  title?: string;
  onClose: () => void;
  /** 运行时资源（来自变量系统，可能携带 name/symbol/最大值/scarse 等元数据） */
  runtimeResources?: Record<string, {
    数量: number;
    最大值?: number;
    name?: string;
    symbol?: string;
    scarce?: boolean;
    description?: string;
    gatherRate?: string;
    usage?: string;
  }>;
  /** 资源变更日志 */
  changeLog?: ResourceChangeLog[];
  /** 玩家物品栏（与生存资源共用同一个存档状态） */
  inventory?: Record<string, InventoryItem>;
  /** 静态配方 + 运行时配方，显示在覆盖层工作台 */
  recipes?: SurvivalRecipe[];
  stamina?: number;
  worldTime?: string;
  onGather?: (resourceId: string) => void;
  onCraft?: (recipe: SurvivalRecipe) => void;
  onUnlock?: (recipe: SurvivalRecipe) => void;
  unlockedRecipeIds?: string[];
  onDeleteRecipe?: (recipeId: string) => void;
}

export default function SurvivalOverlay({
  open, data, title, onClose, runtimeResources, changeLog, inventory, recipes, stamina, worldTime, onGather, onCraft, onUnlock, unlockedRecipeIds = [], onDeleteRecipe,
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
  const safeRecipes = recipes ?? data.recipes ?? [];
  const inventoryEntries = Object.entries(inventory ?? {});

  // 合并静态资源定义和运行时数量
  const mergedResources = (data.resources ?? []).map(res => ({
    ...res,
    amount: runtimeResources?.[res.id]?.数量 ?? res.amount,
  }));

  // 追加运行时存在但静态定义中没有的资源（演化新增）
  // 优先使用运行时携带的元数据（name/symbol/最大值/scarce），避免匿名 ❓ 显示
  if (runtimeResources) {
    for (const [id, rt] of Object.entries(runtimeResources)) {
      if (!mergedResources.some(r => r.id === id)) {
        mergedResources.push({
          id,
          name: rt.name || id,
          symbol: rt.symbol || '❓',
          amount: rt.数量,
          max: rt.最大值 ?? 99,
          scarce: rt.scarce ?? false,
          description: rt.description || '新发现的资源',
          gatherRate: rt.gatherRate,
          usage: rt.usage,
        });
      }
    }
  }

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="game-journey__nested-overlay game-journey__nested-overlay--contained"
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          zIndex: 99,
          opacity: animating ? 1 : 0, transition: 'opacity 0.25s ease',
        }}
      />
      {/* 面板 */}
      <div
        className="game-journey__nested-panel game-journey__nested-panel--side"
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: '380px', maxWidth: '100vw',
          zIndex: 100, display: 'flex', flexDirection: 'column',
          transform: animating ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          borderLeft: '1px solid var(--border)',
        }}
      >
        {/* ── 顶部栏 ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-secondary)', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{
            background: 'var(--bg-tertiary)', border: 'none', borderRadius: 'var(--radius-md)',
            width: 'var(--space-8)', height: 'var(--space-8)', cursor: 'pointer',
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
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

          {/* ── 系统描述 ── */}
          {data.description && (
            <div className="surface-card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '6px' }}>
                <Leaf size={16} color="var(--accent)" />
                <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>系统说明</span>
              </div>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                {data.description}
              </p>
              {data.rules?.consumePerCycle && (
                <div style={{
                  fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
                  marginTop: '6px', padding: 'var(--space-1) var(--space-2)', borderRadius: '6px',
                  background: 'var(--bg-tertiary)',
                }}>
                  ⏱ {data.rules.consumePerCycle}
                </div>
              )}
            </div>
          )}

          {/* ── 资源与采集 ── */}
          <div>
            <div style={{
              fontSize: 'var(--font-size-sm)', fontWeight: 600,
              color: 'var(--text-muted)', marginBottom: 'var(--space-2)',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              资源与采集 ({mergedResources.length})
            </div>
            {(worldTime || stamina != null) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                {worldTime && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Clock size={11} /> {worldTime}</span>}
                {stamina != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Zap size={11} /> 体力 {Math.max(0, Number(stamina) || 0)}</span>}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {mergedResources.map(res => {
                const pct = res.max > 0 ? Math.round((res.amount / res.max) * 100) : 0;
                const isCritical = res.amount > 0 && res.amount <= threshold;
                const isEmpty = res.amount === 0;
                const isExpanded = expandedResource === res.id;
                const barColor = isEmpty ? 'var(--text-muted)' : isCritical ? 'var(--danger)' : res.scarce ? 'var(--warning)' : 'var(--success)';

                return (
                  <div
                    key={res.id}
                    onClick={() => setExpandedResource(isExpanded ? null : res.id)}
                    style={{
                      padding: '10px 12px', borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isCritical ? 'var(--danger-bg-soft)' : 'var(--border)'}`,
                      background: isCritical ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'var(--bg-secondary)',
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
                        <span style={{ fontWeight: 600, color: isCritical ? 'var(--danger)' : 'var(--text-primary)' }}>
                          {res.name}
                        </span>
                        {res.scarce && (
                          <span style={{
                            fontSize: '10px', padding: '0 4px', borderRadius: '6px',
                            background: 'var(--warning-bg-soft)', color: 'var(--warning)',
                          }}>稀缺</span>
                        )}
                        {isCritical && <AlertTriangle size={12} color="var(--danger)" />}
                        {isEmpty && <span style={{ fontSize: '10px', color: 'var(--danger)' }}>已耗尽</span>}
                      </span>
                      <span style={{
                        fontWeight: 600, fontSize: 'var(--font-size-sm)',
                        color: isEmpty ? 'var(--text-muted)' : isCritical ? 'var(--danger)' : 'var(--text-primary)',
                      }}>
                        {res.amount}/{res.max}
                      </span>
                    </div>

                    {/* 进度条 */}
                    <div style={{
                      height: '6px', background: 'var(--bg-tertiary)',
                      borderRadius: '3px', overflow: 'hidden', marginBottom: 'var(--space-1)',
                    }}>
                      <div style={{
                        width: `${pct}%`, height: '100%',
                        background: barColor, borderRadius: '3px',
                        transition: 'width 0.3s',
                      }} />
                    </div>

                    {onGather && data.resources?.some(resource => resource.id === res.id) && (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onGather(res.id); }}
                        disabled={res.amount >= res.max}
                        style={{
                          marginTop: '6px', width: '100%', minHeight: '32px',
                          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                          background: res.amount >= res.max ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                          color: res.amount >= res.max ? 'var(--text-muted)' : 'var(--accent)',
                          cursor: res.amount >= res.max ? 'not-allowed' : 'pointer',
                          fontSize: 'var(--font-size-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                        }}
                      >
                        <Sparkle size={12} />
                        {res.amount >= res.max ? '容量已满' : `采集 +${res.gatherAmount ?? 1} · ${res.gatherTimeMinutes ?? 30} 分钟 · -${res.gatherStaminaCost ?? 5} 体力`}
                      </button>
                    )}

                    {/* 展开详情 */}
                    {isExpanded && (
                      <div style={{
                        marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)',
                        borderTop: '1px solid var(--border)',
                        fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)',
                        display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
                      }}>
                        {res.description && (
                          <div style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            {res.description}
                          </div>
                        )}
                        {res.gatherRate && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                            <Zap size={10} color="var(--accent)" />
                            <span>采集：{res.gatherRate}</span>
                          </div>
                        )}
                        {res.usage && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
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

          {/* ── 背包 ── */}
          <div className="surface-card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
              <Backpack size={14} /> 背包 ({inventoryEntries.length})
            </div>
            {inventoryEntries.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>背包是空的。资源会显示在上方，物品会在这里保留。</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '6px' }}>
                {inventoryEntries.map(([id, item]) => (
                  <div key={id} style={{ minWidth: 0, padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}>
                    <div style={{ overflowWrap: 'anywhere', color: 'var(--text-primary)', fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{id}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px' }}>数量 {Number(item.数量) || 0} · {item.品质 || '普通'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 制作台 ── */}
          <div className="surface-card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
              <Hammer size={14} /> 制作台 ({safeRecipes.length})
            </div>
            {safeRecipes.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>暂无配方，可在生存卡片中让 AI 根据当前资源创建配方。</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {safeRecipes.map(recipe => {
                  const requirements = Object.entries(recipe.inputs).map(([resourceId, amount]) => {
                    const current = runtimeResources?.[resourceId]?.数量 ?? mergedResources.find(resource => resource.id === resourceId)?.amount ?? 0;
                    return { resourceId, amount, current, enough: current >= amount };
                  });
                  const requiresUnlock = Boolean(recipe.unlockConditions?.length || recipe.unlockCost?.length);
                  const unlocked = !requiresUnlock || unlockedRecipeIds.includes(recipe.id);
                  const craftable = unlocked && requirements.every(item => item.enough) && Boolean(runtimeResources?.[recipe.output.resourceId] || mergedResources.some(resource => resource.id === recipe.output.resourceId));
                  return (
                    <div key={recipe.id} style={{ padding: '8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontWeight: 600, fontSize: 'var(--font-size-xs)' }}>{recipe.name}</span>
                        <span style={{ flexShrink: 0, color: 'var(--accent)', fontSize: '10px' }}>→ {recipe.output.resourceId} ×{recipe.output.amount}</span>
                      </div>
                      <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '10px', overflowWrap: 'anywhere' }}>
                        {requirements.map(item => `${item.resourceId} ${item.current}/${item.amount}`).join(' · ')}
                      </div>
                      {requiresUnlock && !unlocked && (
                        <div style={{ marginTop: '3px', color: 'var(--warning)', fontSize: '10px' }}>
                          🔒 需要解锁{recipe.unlockCost?.length ? ` · ${recipe.unlockCost.map(cost => `${cost.label || cost.id || cost.path}×${cost.amount}`).join('、')}` : ' · 满足前置条件'}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '5px', marginTop: '6px' }}>
                        {requiresUnlock && !unlocked && onUnlock ? <button type="button" onClick={() => onUnlock(recipe)} style={{ flex: 1, minHeight: '30px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--warning)', color: '#fff', cursor: 'pointer', fontSize: 'var(--font-size-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><Hammer size={11} /> 解锁</button> : onCraft && <button type="button" onClick={() => onCraft(recipe)} disabled={!craftable} style={{ flex: 1, minHeight: '30px', border: 'none', borderRadius: 'var(--radius-sm)', background: craftable ? 'var(--accent)' : 'var(--bg-tertiary)', color: craftable ? '#fff' : 'var(--text-muted)', cursor: craftable ? 'pointer' : 'not-allowed', fontSize: 'var(--font-size-xs)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><Hammer size={11} /> 制作</button>}
                        {onDeleteRecipe && <button type="button" onClick={() => onDeleteRecipe(recipe.id)} title="删除配方" style={{ width: '34px', minHeight: '30px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={12} /></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 演化蓝图 ── */}
          {data.resourceEvolution && data.resourceEvolution.length > 0 && (
            <div className="surface-card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: 'var(--font-size-sm)', fontWeight: 600,
                color: 'var(--text-muted)', marginBottom: 'var(--space-2)',
              }}>
                🧬 演化蓝图
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {data.resourceEvolution.map((step, i) => (
                  <EvolutionStepCard key={step.id} step={step} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* ── 变更日志 ── */}
          {changeLog && changeLog.length > 0 && (
            <div className="surface-card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: 'var(--font-size-sm)', fontWeight: 600,
                color: 'var(--text-muted)', marginBottom: 'var(--space-2)',
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
                        display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                        color: c.after < c.before ? 'var(--danger)' : c.after > c.before ? 'var(--success)' : 'var(--text-muted)',
                      }}>
                        <span>{c.symbol}</span>
                        <span>{c.resourceName}</span>
                        <span style={{ fontWeight: 600 }}>{c.before}→{c.after}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 'var(--space-1)' }}>{c.reason}</span>
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
        color: 'var(--text-primary)', marginBottom: 'var(--space-1)',
      }}>
        阶段 {index + 1}：{step.id}
      </div>

      {/* 触发条件 */}
      {step.trigger?.keywords?.length > 0 && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
          触发词：{step.trigger.keywords.join('、')}
        </div>
      )}

      {/* 新增资源 */}
      {step.add && step.add.length > 0 && (
        <div style={{ fontSize: '10px', color: 'var(--success)' }}>
          + 新增：{step.add.map(r => `${r.symbol}${r.name}`).join('、')}
        </div>
      )}

      {/* 淘汰资源 */}
      {step.remove && step.remove.length > 0 && (
        <div style={{ fontSize: '10px', color: 'var(--danger)' }}>
          - 淘汰：{step.remove.join('、')}
        </div>
      )}

      {/* 叙事提示 */}
      {step.narrateHint && (
        <div style={{
          fontSize: '10px', color: 'var(--text-muted)',
          fontStyle: 'italic', marginTop: 'var(--space-1)',
        }}>
          "{step.narrateHint}"
        </div>
      )}
    </div>
  );
}
