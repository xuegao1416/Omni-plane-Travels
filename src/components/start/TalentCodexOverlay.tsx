import { useState } from 'react';
import { BookOpen, Check, LockKeyhole, Sparkles, X } from 'lucide-react';
import type { InnateTalentDef, ProfessionModuleSchema } from '../../modules/schema';
import { describeProfessionMechanics } from '../../gameplay/profession';
import { isDivineTalent } from '../../gameplay/creation/creationPoints';
import { professionEmblemSrc, resolveAbilityIconKey } from '../../data/professions/professionVisuals';
import OverlayPortal from '../shared/OverlayPortal';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';

interface TalentCodexOverlayProps {
  config: ProfessionModuleSchema;
  talentIds: readonly string[];
  drawnTalentIds?: readonly string[];
  remaining: number;
  directCost: (talent: InnateTalentDef) => number;
  onSelect: (id: string) => void;
  onClose: () => void;
}

interface TalentSelectionStateInput {
  config: ProfessionModuleSchema;
  talent: InnateTalentDef;
  talentIds: readonly string[];
  remaining: number;
  directCost: (talent: InnateTalentDef) => number;
}

interface TalentSelectionState {
  selected: boolean;
  disabled: boolean;
  divine: boolean;
  cost: number;
  reason?: string;
}

const RARITY_ORDER = ['普通', '精良', '稀有', '史诗', '传说'] as const;

export function getTalentSelectionState({
  config,
  talent,
  talentIds,
  remaining,
  directCost,
}: TalentSelectionStateInput): TalentSelectionState {
  const selected = talentIds.includes(talent.id);
  const divine = isDivineTalent(talent);
  const cost = directCost(talent);
  if (selected) return { selected, disabled: false, divine, cost };
  if (divine || !Number.isFinite(cost)) {
    return { selected, disabled: true, divine: true, cost, reason: '命运眷顾：神技仅可抽取' };
  }

  const owned = new Set(talentIds);
  const missing = talent.prerequisites?.filter(id => !owned.has(id)) ?? [];
  if (missing.length > 0) {
    const names = missing.map(id => config.innateTalents.find(item => item.id === id)?.name ?? id);
    return { selected, disabled: true, divine, cost, reason: `需要前置：${names.join(' / ')}` };
  }

  if (talent.exclusiveGroup) {
    const conflicting = config.innateTalents.find(item => (
      item.id !== talent.id
      && item.exclusiveGroup === talent.exclusiveGroup
      && owned.has(item.id)
    ));
    if (conflicting) {
      return { selected, disabled: true, divine, cost, reason: `与「${conflicting.name}」互斥` };
    }
  }

  if (remaining < cost) {
    return { selected, disabled: true, divine, cost, reason: `需要 ${cost} 点，当前仅剩 ${remaining} 点` };
  }
  return { selected, disabled: false, divine, cost };
}

export function TalentGlyph({
  talent,
  contextId,
  className = '',
}: {
  talent: Pick<InnateTalentDef, 'id' | 'iconKey'>;
  contextId: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!failed) {
    return (
      <img
        className={className}
        src={professionEmblemSrc(resolveAbilityIconKey(talent, contextId))}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
      />
    );
  }
  return <Sparkles className={`${className}${className ? ' ' : ''}is-fallback`} size={18} aria-hidden="true" />;
}

export default function TalentCodexOverlay({
  config,
  talentIds,
  drawnTalentIds = [],
  remaining,
  directCost,
  onSelect,
  onClose,
}: TalentCodexOverlayProps) {
  const drawn = new Set(drawnTalentIds);

  return (
    <OverlayPortal
      className="talent-codex-overlay"
      ariaLabel="先天天赋全典"
      onClose={onClose}
      closeOnBackdrop={false}
    >
      <DawnFrameV4 mode="panel" withFill className="talent-codex-overlay__frame" ariaLabel="天赋全典卷轴">
        <div className="talent-codex-overlay__panel">
          <header className="talent-codex-overlay__header">
            <div>
              <span><BookOpen size={16} aria-hidden="true" />先天天赋全典</span>
              <h2>命格诸卷</h2>
              <small>可用降临点数 <strong>{remaining}</strong></small>
            </div>
            <button type="button" onClick={onClose} aria-label="关闭天赋全典" title="关闭"><X size={19} /></button>
          </header>

          <div className="talent-codex-groups">
            {RARITY_ORDER.map(rarity => {
              const talents = config.innateTalents.filter(talent => (talent.rarity ?? '普通') === rarity);
              if (talents.length === 0) return null;
              return (
                <section className="talent-codex-group" key={rarity} aria-labelledby={`talent-rarity-${rarity}`}>
                  <header>
                    <strong id={`talent-rarity-${rarity}`}>{rarity}</strong>
                    <span>{talents.length}</span>
                  </header>
                  <div className="talent-codex-grid">
                    {talents.map(talent => {
                      const state = getTalentSelectionState({ config, talent, talentIds, remaining, directCost });
                      const wasDrawn = state.selected && drawn.has(talent.id);
                      const mechanics = describeProfessionMechanics(talent.mechanics);
                      return (
                        <article
                          className={`talent-codex-item is-${rarity}${state.selected ? ' is-selected' : ''}${state.divine ? ' is-divine' : ''}`}
                          key={talent.id}
                        >
                          <TalentGlyph talent={talent} contextId={talent.id} className="talent-codex-item__icon" />
                          <div className="talent-codex-item__copy">
                            <header><strong>{talent.name}</strong><span>{rarity}</span></header>
                            <p>{talent.description}</p>
                            {mechanics && <small>{mechanics}</small>}
                            {state.reason && <em><LockKeyhole size={12} />{state.reason}</em>}
                          </div>
                          <div className="talent-codex-item__action">
                            <span className="talent-codex-item__cost">
                              {wasDrawn ? '命运' : state.divine ? '仅可抽取' : `${state.cost} 点`}
                            </span>
                            <button
                              type="button"
                              disabled={state.disabled}
                              onClick={() => onSelect(talent.id)}
                              title={state.reason ?? (state.selected ? `移除${talent.name}` : `选择${talent.name}`)}
                            >
                              {state.selected ? <X size={14} /> : <Check size={14} />}
                              <span>{state.selected ? '移除' : '选择'}</span>
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </DawnFrameV4>
    </OverlayPortal>
  );
}
