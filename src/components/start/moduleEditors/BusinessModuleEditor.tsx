import type { BusinessModuleSchema } from '../../../modules/schema';

/** 经营资产编辑器 — 显示 AI 生成的经营概览 */
export function BusinessModuleEditor({ data, onChange }: { data: BusinessModuleSchema; onChange: (d: Record<string, unknown>) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--font-size-xs)' }}>
      <div style={{ color: 'var(--text-muted)' }}>
        经营系统已由 AI 生成，可在游戏内通过经营管理面板查看详情。
      </div>
      {data.description && (
        <div style={{ padding: '6px 10px', background: 'var(--bg-tertiary)', borderRadius: '6px', color: 'var(--text-secondary)' }}>
          {data.description}
        </div>
      )}
      <div style={{ display: 'flex', gap: '12px', color: 'var(--text-muted)' }}>
        <span>初始资金: <strong style={{ color: 'var(--text-primary)' }}>{data.funds ?? 0}</strong></span>
        <span>资产数: <strong style={{ color: 'var(--text-primary)' }}>{data.assets?.length ?? 0}</strong></span>
        <span>结算周期: <strong style={{ color: 'var(--text-primary)' }}>每{data.cycleName || '天'}</strong></span>
      </div>
      {data.assets && data.assets.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {data.assets.map(a => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '4px 8px', background: 'var(--bg-tertiary)', borderRadius: '6px',
            }}>
              <span style={{ fontWeight: 600 }}>{a.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>Lv.{a.level}/{a.maxLevel}</span>
              <span style={{ color: 'var(--text-muted)' }}>{a.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
