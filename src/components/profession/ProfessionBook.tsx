import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Crown, LockKeyhole, Sparkles, WandSparkles } from 'lucide-react';
import type { ProfessionAbilityDef, ProfessionDef } from '../../modules/schema';
import { professionEmblemSrc, resolveAbilityIconKey, resolveProfessionVisual } from '../../data/professions/professionVisuals';
import '../../styles/profession-book.css';

type AbilityState = 'locked' | 'available' | 'owned';

const TYPE_LABEL: Record<ProfessionAbilityDef['type'], string> = {
  active: '主动', passive: '被动', specialization: '专精', ultimate: '终极',
};

function NodeIcon({ ability, professionId }: { ability: ProfessionAbilityDef; professionId: string }) {
  const [failed, setFailed] = useState(false);
  const iconKey = resolveAbilityIconKey(ability, professionId);
  if (!failed) return <img src={professionEmblemSrc(iconKey)} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
  if (ability.type === 'ultimate') return <Crown size={16} aria-hidden="true" />;
  if (ability.type === 'specialization') return <WandSparkles size={16} aria-hidden="true" />;
  if (ability.type === 'active') return <Sparkles size={16} aria-hidden="true" />;
  return <Check size={16} aria-hidden="true" />;
}

export default function ProfessionBook({
  profession,
  selectedAbilityId,
  onSelectAbility,
  stateFor,
}: {
  profession: ProfessionDef;
  selectedAbilityId?: string;
  onSelectAbility?: (abilityId: string) => void;
  stateFor: (ability: ProfessionAbilityDef) => AbilityState;
}) {
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const previousOwned = useRef<Set<string>>(new Set());
  const previousProfessionId = useRef(profession.id);
  const visual = resolveProfessionVisual(profession);
  const tiers = useMemo(() => [1, 2, 3, 4].map(tier => ({
    tier,
    abilities: profession.abilities.filter(ability => Math.min(4, Math.max(1, ability.tier ?? ability.requiredProfessionLevel ?? 1)) === tier),
  })), [profession]);
  useEffect(() => {
    const owned = new Set(profession.abilities.filter(ability => stateFor(ability) === 'owned').map(ability => ability.id));
    if (previousProfessionId.current !== profession.id) {
      previousProfessionId.current = profession.id;
      previousOwned.current = owned;
      setFlashIds([]);
      return;
    }
    const newlyOwned = [...owned].filter(id => !previousOwned.current.has(id));
    if (previousOwned.current.size === 0 && newlyOwned.length === owned.size) {
      previousOwned.current = owned;
      return;
    }
    previousOwned.current = owned;
    if (!newlyOwned.length) return;
    setFlashIds(newlyOwned);
    const timer = window.setTimeout(() => setFlashIds([]), 520);
    return () => window.clearTimeout(timer);
  }, [profession, stateFor]);

  return (
    <section className="profession-book" aria-label={`${profession.name}职业书`} data-accent={visual.accentKey}>
      <div className="profession-book__road" aria-label="四阶成长路线">
        {tiers.map(({ tier, abilities }, tierIndex) => (
          <div className="profession-book__tier" key={tier}>
            <div className="profession-book__tier-heading"><span>第 {tier} 阶</span><small>{tier === 1 ? '根基' : tier === 4 ? '终局' : tier === 2 ? '分流' : '深化'}</small></div>
            <div className="profession-book__nodes">
              {abilities.length === 0 ? <span className="profession-book__empty">尚未配置</span> : abilities.map(ability => {
                const state = stateFor(ability);
                const selected = selectedAbilityId === ability.id;
                return (
                  <button
                    type="button"
                    key={ability.id}
                    className={`profession-book__node is-${state} is-${ability.type}${selected ? ' is-selected' : ''}${flashIds.includes(ability.id) ? ' is-flash' : ''}`}
                    onClick={() => onSelectAbility?.(ability.id)}
                    aria-pressed={selected}
                    aria-label={`${ability.name}，${TYPE_LABEL[ability.type]}，${state === 'owned' ? '已掌握' : state === 'available' ? '可解锁' : '锁定'}`}
                  >
                    <span className="profession-book__node-icon"><NodeIcon ability={ability} professionId={profession.id} /></span>
                    <span className="profession-book__node-copy"><strong>{ability.name}</strong><small>{TYPE_LABEL[ability.type]} · {state === 'owned' ? '已掌握' : state === 'available' ? `解锁 ${ability.pointCost ?? 1} 点` : `需 Lv.${ability.requiredProfessionLevel ?? ability.tier ?? 1}`}</small></span>
                    {state === 'locked' && <LockKeyhole size={13} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {tierIndex < tiers.length - 1 && <span className="profession-book__tier-arrow" aria-hidden="true">↓</span>}
          </div>
        ))}
      </div>
      <div className="profession-book__legend" aria-label="职业节点状态">
        <span><i className="is-owned" />已掌握</span><span><i className="is-available" />可解锁</span><span><i className="is-locked" />锁定</span><span><i className="is-specialization" />专精</span><span><i className="is-ultimate" />终极</span>
      </div>
    </section>
  );
}
