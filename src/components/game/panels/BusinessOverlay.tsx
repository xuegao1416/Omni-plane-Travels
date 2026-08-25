// 经营管理覆盖层 — 纯展示（无操作按钮）
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, X, DollarSign, Building2, BarChart3, ScrollText, ArrowRight, Users, Package, Coins, ChevronDown, ShoppingCart } from 'lucide-react';
import type { BusinessOverlayProps } from './businessOverlay/types';
import { AssetCardExpandable } from './businessOverlay/AssetCard';
import { MarketSection } from './businessOverlay/MarketSection';
import { TransactionLog } from './businessOverlay/TransactionLog';
import { previewBusinessModule } from '../../../gameplay/modules/business';

export default function BusinessOverlay({
  open, data, config, title, onPurchase, onUpgrade, onAssignStaff, onClose,
}: BusinessOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const [showSettlement, setShowSettlement] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => setAnimating(true));
    } else {
      setAnimating(false);
      const timer = setTimeout(() => { setVisible(false); setExpandedAsset(null); }, 250);
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

  const activeAssets = data.assets?.filter(a => a.status !== 'destroyed') ?? [];
  const ownedIds = new Set(activeAssets.map(asset => asset.id));
  const availableAssets = (config?.assets ?? []).filter(asset => asset.initiallyOwned === false && !ownedIds.has(asset.id));
  const settlementPreview = previewBusinessModule(data);
  const totalIncome = settlementPreview.net;

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
        ref={panelRef}
        className="business-drawer game-journey__nested-panel game-journey__nested-panel--side"
        style={{
          zIndex: 100,
          transform: animating ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
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
            {title || '经营资产'}
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

          {/* ── 资金概览 ── */}
          <div className="surface-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <DollarSign size={20} color="var(--accent)" />
              <div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, color: 'var(--accent)' }}>
                  {data.funds ?? 0}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>总资金</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{
                  fontSize: 'var(--font-size-lg)', fontWeight: 600,
                  color: totalIncome >= 0 ? 'var(--success)' : 'var(--danger)',
                }}>
                  {totalIncome >= 0 ? '+' : ''}{totalIncome}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                  净收入/{data.cycleName || '天'}
                </div>
              </div>
            </div>
            {data.description && (
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
                {data.description}
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowSettlement(value => !value)}
              style={{
                marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px',
                background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <span>查看本期结算拆解</span><ChevronDown size={14} style={{ transform: showSettlement ? 'rotate(180deg)' : undefined }} />
            </button>
            {showSettlement && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8, fontSize: 'var(--font-size-xs)' }}>
                {settlementPreview.assets.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>暂无营业中的资产</span> : settlementPreview.assets.map(item => (
                  <div key={item.assetId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 8, alignItems: 'center', color: 'var(--text-muted)' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    <span style={{ color: 'var(--success)' }}>+{item.gross}</span>
                    <span style={{ color: item.net >= 0 ? 'var(--text-secondary)' : 'var(--danger)' }}>净 {item.net >= 0 ? '+' : ''}{item.net}</span>
                  </div>
                ))}
                <span style={{ color: 'var(--text-muted)' }}>员工效率与市场倍率已计入预计收入；资金不足时将按规则自动暂停资产。</span>
              </div>
            )}
          </div>

          {/* ── 生产链路 ── */}
          {activeAssets.length > 0 && (
            <div className="surface-card" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 9 }}>
                <Package size={14} /> 生产链路
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {activeAssets.map(asset => (
                  <div key={`flow-${asset.id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 1fr) auto minmax(90px, 1.25fr)', gap: 7, alignItems: 'center', fontSize: 'var(--font-size-xs)' }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>{asset.name}</span>
                    <ArrowRight size={13} color="var(--text-muted)" />
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', color: 'var(--text-muted)' }}>
                      <span><Coins size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />维护 {asset.maintenance ?? 0}</span>
                      {asset.staff && <span><Users size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />员工 ×{asset.staff.efficiency}</span>}
                      <span style={{ color: 'var(--success)' }}>产出 +{(asset.income?.base ?? 0) + (asset.income?.perLevel ?? 0) * Math.max(0, (asset.level ?? 1) - 1)}{asset.income?.resource ? ` ${asset.income.resource}` : ''}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.economy?.production && data.economy.production.length > 0 && (
            <div className="surface-card" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 9 }}>
                <Package size={14} /> 生产配方
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.economy.production.map(production => {
                  const formatItems = (items: Record<string, number>) => Object.entries(items).map(([id, amount]) => `${id} ×${amount}`).join('、') || '无';
                  return (
                    <div key={production.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(80px, .7fr) minmax(0, 1.3fr)', gap: 8, fontSize: 'var(--font-size-xs)' }}>
                      <strong style={{ color: 'var(--text-secondary)' }}>{production.name}</strong>
                      <div style={{ color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>投入：{formatItems(production.inputs)} → 产出：{formatItems(production.outputs)}</span>
                        <span>每期 {production.cycles ?? 1} 个周期{production.unlockConditions?.length ? ` · 需满足 ${production.unlockConditions.length} 项条件` : ''}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 资产列表 ── */}
          <div>
            <div style={{
              fontSize: 'var(--font-size-sm)', fontWeight: 600,
              color: 'var(--text-muted)', marginBottom: '8px',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              资产列表 ({activeAssets.length})
            </div>
            {activeAssets.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '32px 16px',
                color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)',
              }}>
                <Building2 size={32} strokeWidth={1} style={{ opacity: 0.3, marginBottom: '8px' }} />
                <div>暂无经营资产</div>
                <div style={{ fontSize: 'var(--font-size-xs)', marginTop: '4px' }}>
                  通过角色行动在叙事中获取资产
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {activeAssets.map(asset => (
                  <AssetCardExpandable
                    key={asset.id}
                    asset={asset}
                    expanded={expandedAsset === asset.id}
                    onToggle={() => setExpandedAsset(expandedAsset === asset.id ? null : asset.id)}
                    onUpgrade={onUpgrade}
                    onAssignStaff={onAssignStaff}
                  />
                ))}
              </div>
            )}
          </div>

          {availableAssets.length > 0 && (
            <div className="surface-card" style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}><ShoppingCart size={14} />可购置资产</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{availableAssets.map(asset => <div key={asset.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'center', padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}><div style={{ minWidth: 0 }}><strong>{asset.name}</strong><div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', overflowWrap: 'anywhere' }}>{asset.description || asset.type} · 资金 {asset.purchaseCost ?? 0}{Object.keys(asset.purchaseMaterials ?? {}).length ? ` · ${Object.entries(asset.purchaseMaterials ?? {}).map(([name, amount]) => `${name}×${amount}`).join('、')}` : ''}</div></div><button type="button" className="btn-primary btn-xs" onClick={() => onPurchase?.(asset.id)} disabled={!onPurchase}><ShoppingCart size={12} />购置</button></div>)}</div>
            </div>
          )}

          {/* ── 市场行情 ── */}
          {data.market?.items && data.market.items.length > 0 && (
            <div className="surface-card" style={{ padding: '12px 16px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: 'var(--font-size-sm)', fontWeight: 600,
                color: 'var(--text-muted)', marginBottom: '8px',
              }}>
                <BarChart3 size={14} />
                市场行情
              </div>
              <MarketSection items={data.market.items} />
            </div>
          )}

          {/* ── 经营日志 ── */}
          {data.transactionLog && data.transactionLog.length > 0 && (
            <div className="surface-card" style={{ padding: '12px 16px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: 'var(--font-size-sm)', fontWeight: 600,
                color: 'var(--text-muted)', marginBottom: '8px',
              }}>
                <ScrollText size={14} />
                经营日志
              </div>
              <TransactionLog entries={data.transactionLog} cycleName={data.cycleName || '天'} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
