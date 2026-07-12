import {
  TrendingUp, TrendingDown, DollarSign,
  Users, AlertTriangle, ChevronRight,
} from 'lucide-react';
import type { BusinessAsset } from '../../../../modules/schema';
import { STATUS_COLORS, RISK_COLORS } from './constants';

/** 计算资产净收益 */
export function assetNetIncome(asset: BusinessAsset): number {
  const levelBonus = (asset.income?.perLevel ?? 0) * Math.max(0, (asset.level ?? 1) - 1);
  return (asset.income?.base ?? 0) + levelBonus - (asset.maintenance ?? 0);
}

/** 可展开的资产卡片（纯展示） */
export function AssetCardExpandable({ asset, expanded, onToggle }: {
  asset: BusinessAsset; expanded: boolean; onToggle: () => void;
}) {
  const status = STATUS_COLORS[asset.status] || STATUS_COLORS.active;
  const risk = asset.risk ? RISK_COLORS[asset.risk.level] || RISK_COLORS.low : null;
  const net = assetNetIncome(asset);
  const staff = asset.staff;
  const totalIncome = (asset.income?.base ?? 0) + (asset.income?.perLevel ?? 0) * Math.max(0, (asset.level ?? 1) - 1);

  return (
    <div className="surface-card" style={{ padding: '12px 16px', border: '1px solid var(--border)' }}>
      {/* 头部（点击展开） */}
      <div
        onClick={onToggle}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>{asset.name}</span>
            <span style={{
              fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: '8px',
              background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 600,
            }}>
              Lv.{asset.level}/{asset.maxLevel}
            </span>
            <span style={{
              fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
              background: status.bg, color: status.text, fontWeight: 600,
            }}>
              {status.label}
            </span>
            {risk && (
              <span style={{
                fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                background: `${risk.color}15`, color: risk.color,
                display: 'inline-flex', alignItems: 'center', gap: '2px',
              }}>
                <AlertTriangle size={10} />
                风险{risk.label}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: 'var(--font-size-xs)', marginTop: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>{asset.type}</span>
            <span style={{ color: 'var(--success)' }}>+{totalIncome}</span>
            <span style={{ color: 'var(--danger)' }}>-{asset.maintenance ?? 0}</span>
            <span style={{ color: net >= 0 ? 'var(--text-primary)' : 'var(--danger)', fontWeight: 600 }}>
              净{net >= 0 ? '+' : ''}{net}
            </span>
          </div>
        </div>
        <ChevronRight size={14} style={{
          color: 'var(--text-muted)', flexShrink: 0,
          transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
          transition: 'transform 0.2s',
        }} />
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div style={{
          marginTop: '12px', paddingTop: '12px',
          borderTop: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: '8px',
          fontSize: 'var(--font-size-sm)',
        }}>
          {asset.description && (
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
              {asset.description}
            </p>
          )}
          <div className="grid-2" style={{ gap: '6px' }}>
            <DetailItem icon={<TrendingUp size={13} color="var(--success)" />} label="基础收益" value={`${asset.income?.base ?? 0}/${asset.income?.cycle || '天'}`} />
            <DetailItem icon={<TrendingUp size={13} color="var(--success)" />} label="每级加成" value={`+${asset.income?.perLevel ?? 0}`} />
            <DetailItem icon={<TrendingDown size={13} color="var(--danger)" />} label="维护费" value={`${asset.maintenance ?? 0}/${asset.income?.cycle || '天'}`} />
            <DetailItem icon={<DollarSign size={13} color="var(--accent)" />} label="净收益" value={`${net >= 0 ? '+' : ''}${net}`} />
          </div>
          {staff && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
              <Users size={13} />
              <span>员工 {staff.current}/{staff.max}</span>
              <span>·</span>
              <span>效率 {staff.efficiency}</span>
            </div>
          )}
          {asset.income?.resource && (
            <div style={{ color: 'var(--text-muted)' }}>
              产出资源：{asset.income.resource}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 详情项 */
function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      {icon}
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, marginLeft: 'auto' }}>{value}</span>
    </div>
  );
}
