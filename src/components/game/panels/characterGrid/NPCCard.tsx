import { Star } from 'lucide-react';
import Avatar from '../../../shared/Avatar';
import type { NPCData } from '../../../../schema/variables';
import { favorClass, categoryStyle } from './types';

export function GaugeBar({ value, color }: { value: number; color: string }) {
  const pct = (value + 100) / 200 * 100;
  return (
    <div style={{ height: '7px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.3s' }} />
    </div>
  );
}

export function NPCCard({ id, npc, onClick, portraitSrc }: {
  id: string; npc: NPCData; onClick: () => void; portraitSrc?: string | null;
}) {
  const rd = npc.关系数据 ?? { 好感度: 0, 关系类型: '未知' };
  const sj = npc.社会身份 ?? { 职业: '', 社会地位: '' };
  const fav = favorClass(rd.好感度);
  const cat = categoryStyle(npc.人物分类);

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', cursor: 'pointer', transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 2px 8px var(--accent-glow)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <Avatar name={npc.姓名 || id} size="md" imageSrc={portraitSrc || null} />
        <div style={{ flex: '1', minWidth: 0 }}>
          <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            {npc.重要NPC && <Star size={13} fill="var(--warning)" color="var(--warning)" />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{npc.姓名 || id}</span>
            <span style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px', borderRadius: '8px', background: cat.bg, color: cat.color, fontWeight: '500', flexShrink: 0 }}>{cat.label}</span>
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{sj.职业}</div>
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', marginBottom: '2px' }}>
          <span style={{ color: 'var(--text-muted)' }}>好感度</span>
          <span style={{ color: fav.color, fontWeight: '500' }}>{rd.好感度}</span>
        </div>
        <GaugeBar value={rd.好感度} color={fav.color} />
      </div>
    </div>
  );
}
