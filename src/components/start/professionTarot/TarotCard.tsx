import type { CSSProperties } from 'react';
import { Compass, Sparkles } from 'lucide-react';
import type { ProfessionDef } from '../../../modules/schema';
import { professionEmblemSrc, resolveProfessionVisual } from '../../../data/professions/professionVisuals';

interface TarotCardProps {
  profession: ProfessionDef | null;
  index: number;
  total: number;
  flipped: boolean;
  selected: boolean;
  onFlip: (id: string | null) => void;
}

type TarotCardStyle = CSSProperties & {
  '--tarot-angle': string;
  '--tarot-lift': string;
  '--tarot-index': number;
};

export default function TarotCard({
  profession,
  index,
  total,
  flipped,
  selected,
  onFlip,
}: TarotCardProps) {
  const safeTotal = Math.max(1, total);
  const mid = (safeTotal - 1) / 2;
  const angle = (index - mid) * Math.min(7, 66 / safeTotal);
  // A quadratic drop keeps the center cards at the apex while both edges
  // descend progressively, producing a real downward-facing fan.
  const normalizedDistance = safeTotal > 1 ? Math.abs(index - mid) / mid : 0;
  const lift = Math.round(normalizedDistance ** 2 * 54);
  const name = profession?.name ?? '无职者';
  const visual = profession ? resolveProfessionVisual(profession) : null;
  const maxTier = profession
    ? Math.max(1, ...profession.abilities.map(ability => ability.tier ?? 1))
    : 0;
  const style: TarotCardStyle = {
    '--tarot-angle': `${angle}deg`,
    '--tarot-lift': `${lift}px`,
    '--tarot-index': index,
  };

  return (
    <button
      type="button"
      className={`tarot-card${flipped ? ' is-flipped' : ''}${selected ? ' is-selected' : ''}`}
      data-accent={visual?.accentKey ?? 'silver'}
      style={style}
      aria-label={flipped ? `查看${name}` : `翻开${name}`}
      aria-pressed={flipped}
      onClick={() => onFlip(profession?.id ?? null)}
    >
      <span className="tarot-card__flipper" aria-hidden="true">
        <span className="tarot-card__back">
          <img src="/art/theme/ui-kit/dawn-v4/ritual/talent-astrolabe-v1.png" alt="" draggable={false} />
          <span className="tarot-card__seal"><Sparkles size={18} strokeWidth={1.5} /></span>
          <small>命运未揭</small>
        </span>
        <span className="tarot-card__face">
          <span className="tarot-card__emblem">
            {visual ? (
              <img
                src={professionEmblemSrc(visual.emblemKey)}
                alt=""
                draggable={false}
                onError={event => { event.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <Compass size={34} strokeWidth={1.35} />
            )}
          </span>
          <strong>{name}</strong>
          <small>{profession?.archetype ?? '不受固定道路约束'}</small>
          <p>{profession?.description ?? '以自由技能与先天禀赋书写旅程。'}</p>
          {profession && (
            <span className="tarot-card__tiers" aria-label={`${maxTier} 阶成长`}>
              {[1, 2, 3, 4].map(tier => (
                <i key={tier} className={tier <= maxTier ? 'is-filled' : ''}>{tier}</i>
              ))}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
