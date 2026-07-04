// 经营管理覆盖层 — 纯展示（无操作按钮）
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, X, DollarSign, Building2, BarChart3, ScrollText } from 'lucide-react';
import type { BusinessOverlayProps } from './businessOverlay/types';
import { AssetCardExpandable, assetNetIncome } from './businessOverlay/AssetCard';
import { MarketSection } from './businessOverlay/MarketSection';
import { TransactionLog } from './businessOverlay/TransactionLog';

export default function BusinessOverlay({
  open, data, title, onClose,
}: BusinessOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
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
  const totalIncome = data.assets?.filter(a => a.status === 'active').reduce((s, a) => s + assetNetIncome(a), 0) ?? 0;

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
        ref={panelRef}
        className="business-drawer"
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
                  color: totalIncome >= 0 ? '#22c55e' : '#ef4444',
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
          </div>

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
                  />
                ))}
              </div>
            )}
          </div>

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
