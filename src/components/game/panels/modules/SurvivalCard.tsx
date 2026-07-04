// 生存资源卡片
import { useState, useEffect, useRef, memo } from 'react';
import { Leaf, AlertTriangle, Hammer, Plus, Trash2, ChevronRight, Loader, Sparkles, Sparkle } from 'lucide-react';
import type { SurvivalModuleSchema, SurvivalRecipe } from '../../../../modules/schema';
import type { ResourceChangeLog } from '../../gameScreen/hooks/useSurvivalSettlement';
import { Collapsible } from '../../../shared/Collapsible';

interface SurvivalCardProps {
  data: SurvivalModuleSchema;
  title?: string;
  /** 当前运行时资源数量（来自变量系统，用于覆盖 data.resources 中的 amount） */
  runtimeResources?: Record<string, { 数量: number }>;
  /** 生成配方回调（玩家需求 → AI生成） */
  onGenerateRecipe?: (request: string) => Promise<void>;
  /** 制作回调（消耗资源+产出） */
  onCraft?: (recipe: SurvivalRecipe) => void;
  /** 删除配方回调 */
  onDeleteRecipe?: (recipeId: string) => void;
  /** 是否正在生成配方 */
  isGeneratingRecipe?: boolean;
  /** 打开详情覆盖层 */
  onOpenOverlay?: () => void;
  /** 最近的资源变更日志（用于在卡片上显示最近一次变化） */
  recentChanges?: ResourceChangeLog[];
}

export default memo(function SurvivalCard({
  data, title, runtimeResources, onGenerateRecipe, onCraft, onDeleteRecipe, isGeneratingRecipe, onOpenOverlay, recentChanges,
}: SurvivalCardProps) {
  const displayTitle = title || '生存资源';
  const threshold = data.rules?.criticalThreshold ?? 2;
  const recipes = Array.isArray(data.recipes) ? data.recipes : [];

  const [showRecipeInput, setShowRecipeInput] = useState(false);
  const [recipeRequest, setRecipeRequest] = useState('');
  const [newlyDiscovered, setNewlyDiscovered] = useState<Set<string>>(new Set());
  const prevResourceIdsRef = useRef<Set<string>>(new Set());

  // 合并静态资源定义和运行时资源数量
  // 运行时可能包含演化新增的资源（不在 data.resources 中）
  const mergedResources = (() => {
    const base = data.resources.map(res => ({
      ...res,
      amount: runtimeResources?.[res.id]?.数量 ?? res.amount,
    }));
    // 追加运行时存在但静态定义中没有的资源（演化新增）
    if (runtimeResources) {
      for (const [id, rt] of Object.entries(runtimeResources)) {
        if (!base.some(r => r.id === id)) {
          base.push({
            id, name: id, symbol: '❓',
            amount: rt.数量, max: 99, scarce: false,
            description: '新发现的资源',
          });
        }
      }
    }
    return base;
  })();

  // 检测新发现的资源
  useEffect(() => {
    const currentIds = new Set(mergedResources.map(r => r.id));
    const prevIds = prevResourceIdsRef.current;
    if (prevIds.size > 0) {
      const newIds = new Set<string>();
      for (const id of currentIds) {
        if (!prevIds.has(id)) newIds.add(id);
      }
      if (newIds.size > 0) {
        setNewlyDiscovered(newIds);
        const timer = setTimeout(() => setNewlyDiscovered(new Set()), 3000);
        return () => clearTimeout(timer);
      }
    }
    prevResourceIdsRef.current = currentIds;
  }, [mergedResources.map(r => r.id).join(',')]);

  const handleGenerate = async () => {
    if (!recipeRequest.trim() || !onGenerateRecipe) return;
    await onGenerateRecipe(recipeRequest.trim());
    setRecipeRequest('');
    setShowRecipeInput(false);
  };

  // 检查是否可以制作（资源是否足够）
  const canCraft = (recipe: SurvivalRecipe): boolean => {
    for (const [resId, need] of Object.entries(recipe.inputs)) {
      const res = mergedResources.find(r => r.id === resId);
      if (!res || res.amount < need) return false;
    }
    return true;
  };

  return (
    <Collapsible icon={<Leaf size={15} />} title={displayTitle} defaultOpen={true}>
      {/* 整体描述 */}
      {data.description && (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '6px' }}>
          {data.description}
        </div>
      )}

      {/* 生存规则摘要 */}
      {data.rules?.consumePerCycle && (
        <div style={{
          fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)',
          padding: '4px 8px', borderRadius: '6px',
          background: 'var(--bg-secondary)', marginBottom: '6px',
        }}>
          ⏱ {data.rules.consumePerCycle}
        </div>
      )}

      {/* ── 资源列表 ── */}
      {mergedResources.length === 0 ? (
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          暂无资源
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {mergedResources.map(res => {
            const pct = res.max > 0 ? Math.round((res.amount / res.max) * 100) : 0;
            const isCritical = res.amount > 0 && res.amount <= threshold;
            const isEmpty = res.amount === 0;
            const isNew = newlyDiscovered.has(res.id);
            const barColor = isEmpty ? 'var(--text-muted)' : isCritical ? '#ef4444' : res.scarce ? '#f59e0b' : '#22c55e';

            return (
              <div key={res.id} style={{
                display: 'flex', flexDirection: 'column', gap: '2px',
                animation: isNew ? 'survival-discover 0.6s ease-out' : undefined,
                background: isNew ? 'rgba(34, 197, 94, 0.08)' : undefined,
                borderRadius: isNew ? '6px' : undefined,
                padding: isNew ? '4px 6px' : undefined,
                margin: isNew ? '-4px -6px' : undefined,
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 'var(--font-size-sm)',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>{res.symbol}</span>
                    <span style={{ color: isCritical ? '#ef4444' : isNew ? '#22c55e' : 'var(--text-muted)' }}>{res.name}</span>
                    {isNew && <Sparkle size={12} color="#22c55e" />}
                    {res.scarce && (
                      <span style={{
                        fontSize: '10px', padding: '0 4px', borderRadius: '6px',
                        background: '#ef444420', color: '#ef4444',
                      }}>稀缺</span>
                    )}
                    {isCritical && <AlertTriangle size={12} color="#ef4444" />}
                  </span>
                  <span style={{
                    fontWeight: 600,
                    color: isEmpty ? 'var(--text-muted)' : isCritical ? '#ef4444' : 'var(--text-primary)',
                  }}>
                    {isEmpty ? '未获取' : `${res.amount}/${res.max}`}
                  </span>
                </div>
                <div style={{
                  height: '6px', background: 'var(--bg-tertiary)',
                  borderRadius: '3px', overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: barColor, borderRadius: '3px',
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 配方区域 ── */}
      <div style={{ marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '6px',
        }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
          }}>
            <Hammer size={12} /> 配方 ({recipes.length})
          </span>
          {onGenerateRecipe && (
            <button
              onClick={() => setShowRecipeInput(!showRecipeInput)}
              style={{
                display: 'flex', alignItems: 'center', gap: '2px',
                fontSize: 'var(--font-size-xs)', color: 'var(--accent)',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '2px 6px', borderRadius: '4px',
              }}
            >
              <Plus size={12} /> 创建配方
            </button>
          )}
        </div>

        {/* 配方生成输入框 */}
        {showRecipeInput && (
          <div style={{
            display: 'flex', gap: '4px', marginBottom: '8px',
            padding: '6px', borderRadius: '6px',
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          }}>
            <input
              value={recipeRequest}
              onChange={e => setRecipeRequest(e.target.value)}
              placeholder="描述你想制作的东西（如：石斧、熟肉）"
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              style={{
                flex: 1, background: 'none', border: 'none',
                color: 'var(--text-primary)', fontSize: 'var(--font-size-xs)',
                outline: 'none',
              }}
              disabled={isGeneratingRecipe}
            />
            <button
              onClick={handleGenerate}
              disabled={!recipeRequest.trim() || isGeneratingRecipe}
              style={{
                display: 'flex', alignItems: 'center', gap: '2px',
                fontSize: 'var(--font-size-xs)', padding: '2px 8px',
                background: 'var(--accent)', color: '#fff',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
                opacity: (!recipeRequest.trim() || isGeneratingRecipe) ? 0.5 : 1,
              }}
            >
              {isGeneratingRecipe
                ? <Loader size={11} className="animate-spin" />
                : <Sparkles size={11} />
              }
              生成
            </button>
          </div>
        )}

        {/* 配方卡片列表 */}
        {recipes.length === 0 && !showRecipeInput && (
          <div style={{
            fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
            fontStyle: 'italic', padding: '4px 0',
          }}>
            暂无配方，点击"创建配方"让 AI 生成
          </div>
        )}

        {recipes.map(recipe => {
          const craftable = canCraft(recipe);
          const inputStr = Object.entries(recipe.inputs)
            .map(([k, v]) => {
              const res = mergedResources.find(r => r.id === k);
              const name = res?.name || k;
              const has = res?.amount ?? 0;
              const enough = has >= v;
              return { text: `${name}×${v}`, enough };
            });

          return (
            <div key={recipe.id} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 8px', marginBottom: '4px',
              borderRadius: '6px', border: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              fontSize: 'var(--font-size-xs)',
            }}>
              {/* 配方信息 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                  {recipe.name}
                </div>
                <div style={{ color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '2px', alignItems: 'center' }}>
                  {inputStr.map((item, i) => (
                    <span key={i}>
                      {i > 0 && ' + '}
                      <span style={{ color: item.enough ? 'var(--text-secondary)' : '#ef4444' }}>
                        {item.text}
                      </span>
                    </span>
                  ))}
                  <ChevronRight size={10} style={{ margin: '0 2px' }} />
                  <span style={{ color: 'var(--accent)' }}>
                    {recipe.output.resourceId}×{recipe.output.amount}
                  </span>
                </div>
                {recipe.description && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '1px' }}>
                    {recipe.description}
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                {onCraft && (
                  <button
                    onClick={() => onCraft(recipe)}
                    disabled={!craftable}
                    style={{
                      fontSize: '10px', padding: '2px 8px',
                      background: craftable ? 'var(--accent)' : 'var(--bg-tertiary)',
                      color: craftable ? '#fff' : 'var(--text-muted)',
                      border: 'none', borderRadius: '4px',
                      cursor: craftable ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', gap: '2px',
                    }}
                  >
                    <Hammer size={10} /> 制作
                  </button>
                )}
                {onDeleteRecipe && (
                  <button
                    onClick={() => onDeleteRecipe(recipe.id)}
                    style={{
                      fontSize: '10px', padding: '2px 8px',
                      background: 'none', color: '#ef4444',
                      border: '1px solid #ef444440', borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '2px',
                    }}
                  >
                    <Trash2 size={10} /> 删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 最近变更摘要 ── */}
      {recentChanges && recentChanges.length > 0 && (() => {
        const lastEntry = recentChanges[recentChanges.length - 1];
        const significantChanges = lastEntry.changes.filter(c => c.before !== c.after);
        if (significantChanges.length === 0) return null;
        return (
          <div style={{
            marginTop: '8px', padding: '6px 8px', borderRadius: '6px',
            background: 'var(--bg-tertiary)', fontSize: 'var(--font-size-xs)',
          }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: '3px' }}>最近变化</div>
            {significantChanges.map((c, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                color: c.after < c.before ? '#ef4444' : '#22c55e',
              }}>
                <span>{c.symbol}</span>
                <span>{c.resourceName}</span>
                <span style={{ fontWeight: 600 }}>{c.before}→{c.after}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: '2px' }}>{c.reason}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── 详情入口 ── */}
      {onOpenOverlay && (
        <div
          onClick={onOpenOverlay}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
            marginTop: '8px', padding: '6px 12px',
            background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)',
          }}
        >
          查看详情
          <ChevronRight size={12} />
        </div>
      )}
    </Collapsible>
  );
});
