import {
  TrendingUp, TrendingDown, DollarSign,
  Users, AlertTriangle, ChevronRight, ArrowUpRight, Package,
} from 'lucide-react';
import { useState } from 'react';
import type { BusinessAsset } from '../../../../modules/schema';
import { STATUS_COLORS, RISK_COLORS } from './constants';

/** 计算资产净收益 */
export function assetNetIncome(asset: BusinessAsset): number {
  const levelBonus = (asset.income?.perLevel ?? 0) * Math.max(0, (asset.level ?? 1) - 1);
  return (asset.income?.base ?? 0) + levelBonus - (asset.maintenance ?? 0);
}

/** 可展开的资产卡片（纯展示） */
export function AssetCardExpandable({ asset, expanded, onToggle, onUpgrade, onAssignStaff }: {
  asset: BusinessAsset; expanded: boolean; onToggle: () => void;
  onUpgrade?: (assetId: string) => void;
  onAssignStaff?: (assetId: string, count: number, efficiency?: number) => void;
}) {
  const [showUpgrade, setShowUpgrade] = useState(false);
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <Users size={13} />
              <span>员工</span>
              <input aria-label={`${asset.name}员工人数`} type="number" min={0} max={staff.max} defaultValue={staff.current} onBlur={event => onAssignStaff?.(asset.id, Math.max(0, Math.min(staff.max, Number(event.currentTarget.value) || 0)), staff.efficiency)} disabled={!onAssignStaff} style={{ width: 54 }} />
              <span>/{staff.max}</span>
              <span>·</span>
              <span>效率</span>
              <input aria-label={`${asset.name}员工效率`} type="number" min={0} max={2} step={0.1} defaultValue={staff.efficiency} onBlur={event => onAssignStaff?.(asset.id, staff.current, Math.max(0, Math.min(2, Number(event.currentTarget.value) || 0)))} disabled={!onAssignStaff} style={{ width: 58 }} />
            </div>
          )}
          {asset.income?.resource && (
            <div style={{ color: 'var(--text-muted)' }}>
              <Package size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              产出资源：{asset.income.resource}
            </div>
          )}
          {(asset.upgradeCost !== undefined || asset.upgradeMaterials) && asset.level < asset.maxLevel && (
            <>
              <button
                type="button"
                onClick={() => setShowUpgrade(value => !value)}
                style={{
                  alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4,
                  border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px',
                  background: 'var(--bg-secondary)', color: 'var(--text-secondary)', cursor: 'pointer',
                  fontSize: 'var(--font-size-xs)',
                }}
              >
                <ArrowUpRight size={13} /> {showUpgrade ? '收起升级预览' : '预览升级'}
              </button>
              {showUpgrade && <UpgradePreview asset={asset} onUpgrade={onUpgrade} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UpgradePreview({ asset, onUpgrade }: { asset: BusinessAsset; onUpgrade?: (assetId: string) => void }) {
  const level = Number(asset.level) || 1;
  const nextLevel = Math.min(Number(asset.maxLevel) || level, level + 1);
  const currentGross = (asset.income?.base ?? 0) + (asset.income?.perLevel ?? 0) * Math.max(0, level - 1);
  const nextGross = (asset.income?.base ?? 0) + (asset.income?.perLevel ?? 0) * Math.max(0, nextLevel - 1);
  const delta = nextGross - currentGross;
  const materials = Object.entries(asset.upgradeMaterials ?? {});
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 10px',
      borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border)',
      fontSize: 'var(--font-size-xs)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
        <span>升级 Lv.{level} → Lv.{nextLevel}</span>
        <span style={{ color: 'var(--success)', fontWeight: 600 }}>周期净收益 +{delta}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
        <span>资金投入</span><strong>{asset.upgradeCost ?? 0}</strong>
      </div>
      {materials.length > 0 && (
        <div style={{ color: 'var(--text-muted)' }}>
          材料投入：{materials.map(([name, amount]) => `${name} ×${amount}`).join('、')}
        </div>
      )}
      <div style={{ color: 'var(--text-muted)' }}>升级后预计产出：{nextGross}/{asset.income?.cycle || '周期'}</div>
      <button type="button" className="btn-primary btn-xs" onClick={() => onUpgrade?.(asset.id)} disabled={!onUpgrade}><ArrowUpRight size={12} />确认升级</button>
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
