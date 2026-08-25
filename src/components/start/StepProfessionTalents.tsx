import { useState } from 'react';
import { BookOpen, Check, Shield, Sparkles } from 'lucide-react';
import type { ProfessionModuleSchema } from '../../modules/schema';
import type { PlayerProfile } from '../../storage/db';
import { describeProfessionMechanics, validateProfessionSelection } from '../../gameplay/profession';
import { professionEmblemSrc, resolveAbilityIconKey, resolveProfessionVisual } from '../../data/professions/professionVisuals';

function TalentIcon({ id, iconKey, professionId }: { id: string; iconKey?: string; professionId: string }) {
  const [failed, setFailed] = useState(false);
  if (!failed) return <img className="innate-talent-choice__icon" src={professionEmblemSrc(resolveAbilityIconKey({ id, iconKey }, professionId))} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
  return <Sparkles className="innate-talent-choice__icon is-fallback" size={15} aria-hidden="true" />;
}

export default function StepProfessionTalents({
  config,
  personalInfo,
  setPersonalInfo,
}: {
  config: ProfessionModuleSchema;
  personalInfo: PlayerProfile;
  setPersonalInfo: (profile: PlayerProfile) => void;
}) {
  const professionId = personalInfo.professionId ?? null;
  const talentIds = personalInfo.innateTalentIds ?? [];
  const validation = validateProfessionSelection(config, professionId, talentIds);
  const selectedProfession = config.professions.find(item => item.id === professionId);

  const chooseProfession = (id: string | null) => {
    const profession = config.professions.find(item => item.id === id);
    setPersonalInfo({ ...personalInfo, professionId: id, career: profession?.name ?? '' });
  };

  const toggleTalent = (id: string) => {
    const nextIds = talentIds.includes(id)
      ? talentIds.filter(item => item !== id)
      : [...talentIds, id];
    const next = validateProfessionSelection(config, professionId, nextIds);
    if (!next.ok && !talentIds.includes(id)) return;
    setPersonalInfo({ ...personalInfo, innateTalentIds: nextIds });
  };

  return (
    <div className="profession-creation-step">
      <header className="profession-creation-step__header">
        <span>第二步 · 选择道路与天生禀赋</span>
        <h2>职业与天赋</h2>
        <p>职业决定以后可投入点数成长的能力树；先天天赋只在此处选择，进入游戏后不会变成可购买节点。</p>
      </header>

      <section className="profession-creation-step__section" aria-label="选择职业">
        <div className="profession-creation-step__heading"><Shield size={16} /><strong>职业道路</strong></div>
        <div className="profession-choice-grid">
          {config.allowNoProfession !== false && (
            <button type="button" className={`profession-choice${professionId === null ? ' is-selected' : ''}`} onClick={() => chooseProfession(null)}>
              <span>{professionId === null && <Check size={14} />}无职业</span>
              <small>不加入固定职业树，仍可拥有先天天赋和自由技能。</small>
            </button>
          )}
          {config.professions.map(profession => (
            <button type="button" key={profession.id} data-accent={resolveProfessionVisual(profession).accentKey} className={`profession-choice${professionId === profession.id ? ' is-selected' : ''}`} onClick={() => chooseProfession(profession.id)}>
              <img src={professionEmblemSrc(resolveProfessionVisual(profession).emblemKey)} alt="" aria-hidden="true" onError={event => { event.currentTarget.style.display = 'none'; }} />
              <span>{professionId === profession.id && <Check size={14} />}{profession.name}</span>
              <small>{profession.description}</small>
              <em><BookOpen size={11} /> {profession.archetype ? `${profession.archetype} · ` : ''}{Math.max(1, ...profession.abilities.map(item => item.tier ?? 1))} 阶成长 · {profession.abilities.length} 个能力</em>
              <div className="profession-choice__tiers" aria-label="四阶成长预览">{[1, 2, 3, 4].map(tier => <i key={tier} className={profession.abilities.some(item => (item.tier ?? 1) === tier) ? 'is-filled' : ''}>{tier}</i>)}</div>
            </button>
          ))}
        </div>
        {selectedProfession && (
          <div className="profession-choice-preview">
            <strong>{selectedProfession.name}成长路线</strong>
            <p>创建时只确定职业，进入游戏后再用能力点沿职业树逐阶解锁；未解锁能力不会被 AI 当作已掌握。</p>
            <div>
              {[...new Set(selectedProfession.abilities.map(item => item.tier ?? 1))].sort((a, b) => a - b).map(tier => (
                <span key={tier}>第 {tier} 阶 · {selectedProfession.abilities.filter(item => (item.tier ?? 1) === tier).map(item => item.name).join(' / ')}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="profession-creation-step__section" aria-label="选择先天天赋">
        <div className="profession-creation-step__heading">
          <Sparkles size={16} />
          <strong>先天天赋</strong>
          <span>预算 {validation.remaining} / {config.creationTalentBudget}</span>
        </div>
        <div className="innate-talent-grid">
          {config.innateTalents.map(talent => {
            const selected = talentIds.includes(talent.id);
            const candidate = validateProfessionSelection(config, professionId, selected ? talentIds.filter(id => id !== talent.id) : [...talentIds, talent.id]);
            return (
              <button
                type="button"
                key={talent.id}
                className={`innate-talent-choice${selected ? ' is-selected' : ''}`}
                onClick={() => toggleTalent(talent.id)}
                disabled={!selected && !candidate.ok}
                title={!selected && !candidate.ok ? candidate.reason : talent.description}
              >
                <span><TalentIcon id={talent.id} iconKey={talent.iconKey} professionId={professionId ?? selectedProfession?.id ?? talent.id} />{selected && <Check size={13} />}{talent.name}<b>{talent.cost}</b></span>
                <small>{talent.description}</small>
                {describeProfessionMechanics(talent.mechanics) && <em>{describeProfessionMechanics(talent.mechanics)}</em>}
              </button>
            );
          })}
        </div>
        {!validation.ok && <p className="profession-creation-step__error" role="status">{validation.reason}</p>}
      </section>
    </div>
  );
}
