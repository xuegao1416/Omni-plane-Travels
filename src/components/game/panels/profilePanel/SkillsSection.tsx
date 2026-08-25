import { useState } from 'react';
import { Swords } from 'lucide-react';
import { Collapsible } from '../../../shared/Collapsible';
import { getQualityColor } from '../../../shared/qualityUtils';
import { DetailModal, DetailRow } from './shared';
import type { SkillData, SkillSelection } from './types';

interface Props {
  skills: Record<string, SkillData>;
}

export function SkillsSection({ skills }: Props) {
  const [selectedSkill, setSelectedSkill] = useState<SkillSelection | null>(null);

  if (Object.keys(skills).length === 0) return null;

  return (
    <>
      <Collapsible icon={<Swords size={15} />} title="自由技能" defaultOpen={false}>
        <p style={{ margin: '0 0 6px', color: 'var(--text-muted)', fontSize: '10px' }}>剧情中学习的生活技艺与通用技能；它们独立于职业树，不会重复占用职业能力点。</p>
        {Object.entries(skills).filter(([_, s]) => s != null).map(([name, skill]) => {
          const qColor = getQualityColor(skill?.品质 ?? '普通');
          return (
            <div
              key={name}
              onClick={() => setSelectedSkill({ name, data: skill })}
              style={{
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <span style={{ color: qColor, fontSize: '11px' }}>●</span>
              <span style={{ fontWeight: '600', fontSize: 'var(--font-size-sm)', flex: 1 }}>{name}</span>
              <span style={{
                fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                background: qColor + '18', color: qColor,
              }}>{skill?.品质 ?? '普通'}</span>
              {skill?.描述 && (
                <span style={{
                  fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
                  maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{skill.描述}</span>
              )}
            </div>
          );
        })}
      </Collapsible>

      {/* 技能详情弹窗 */}
      {selectedSkill && (
        <DetailModal title={selectedSkill.name} quality={selectedSkill.data?.品质 ?? '普通'} onClose={() => setSelectedSkill(null)}>
          {selectedSkill.data?.类型 && <DetailRow label="类型" value={selectedSkill.data.类型} />}
          {selectedSkill.data?.描述 && <DetailRow label="描述" value={selectedSkill.data.描述} />}
        </DetailModal>
      )}
    </>
  );
}
