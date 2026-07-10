// 天赋体系卡片 — 天赋大类 + 品质标签
import { memo } from 'react';
import { Star } from 'lucide-react';
import type { TalentModuleSchema } from '../../../../modules/schema';
import { Collapsible } from '../../../shared/Collapsible';
import { getQualityColor } from '../../../shared/qualityUtils';

interface TalentCardProps {
  data: TalentModuleSchema;
  /** 自定义标题（世界创建时设置的模块名称） */
  title?: string;
}

export default memo(function TalentCard({ data, title }: TalentCardProps) {
  if (!data.categories?.length) {
    return (
      <Collapsible icon={<Star size={15} />} title={title || '天赋体系'} defaultOpen={true}>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontStyle: 'italic' }}>暂无天赋</div>
      </Collapsible>
    );
  }

  return (
    <Collapsible icon={<Star size={15} />} title={title || '天赋体系'} defaultOpen={true}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(data.categories ?? []).map(cat => (
          <div key={cat.id}>
            {/* 大类标题 */}
            <div style={{
              fontSize: 'var(--font-size-xs)', fontWeight: 600,
              color: 'var(--accent)', marginBottom: 4, letterSpacing: '0.03em',
            }}>
              {cat.name}
              {cat.description && (
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>{cat.description}</span>
              )}
            </div>
            {/* 天赋列表 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {cat.talents.map(talent => {
                const rColor = getQualityColor(talent.rarity);
                return (
                  <div
                    key={talent.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6,
                      padding: '4px 6px', borderRadius: 6,
                      border: `1px solid ${rColor}30`,
                      background: `${rColor}08`,
                    }}
                  >
                    <span style={{ color: rColor, fontSize: '11px', flexShrink: 0, marginTop: 2 }}>●</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {talent.name}
                        </span>
                        <span style={{
                          fontSize: '10px', padding: '0 5px', borderRadius: 8,
                          background: `${rColor}20`, color: rColor, fontWeight: 600,
                        }}>{talent.rarity}</span>
                      </div>
                      {talent.description && (
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 1 }}>
                          {talent.description}
                        </div>
                      )}
                      {talent.effects && talent.effects.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                          {talent.effects.map((eff, i) => (
                            <span key={i} style={{
                              fontSize: '10px', padding: '1px 6px', borderRadius: 8,
                              background: 'var(--accent)15', color: 'var(--accent)',
                            }}>{eff}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Collapsible>
  );
});
