import { Heart, Swords, Zap } from 'lucide-react';
import type { CombatUnitCardModel } from '../../../gameplay/combatViewModel';

const battleFallbackPortraits: Record<CombatUnitCardModel['portrait']['kind'], string> = {
  male: '/art/theme/ui-kit/dawn-v4/combat/battle-silhouette-male-v2.png',
  female: '/art/theme/ui-kit/dawn-v4/combat/battle-silhouette-female-v2.png',
  neutral: '/art/theme/ui-kit/dawn-v4/combat/battle-silhouette-neutral-v2.png',
};
const thumbnailFallbackPortraits: Record<CombatUnitCardModel['portrait']['kind'], string> = {
  male: '/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-male-v1.png',
  female: '/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-female-v1.png',
  neutral: '/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-neutral-v1.png',
};

export function battlePortraitFor(unit: CombatUnitCardModel): { src: string; fallback: boolean } {
  return unit.portrait.src ? { src: unit.portrait.src, fallback: false } : { src: battleFallbackPortraits[unit.portrait.kind], fallback: true };
}

export function thumbnailPortraitFor(unit: CombatUnitCardModel): { src: string; fallback: boolean } {
  return unit.portrait.src ? { src: unit.portrait.src, fallback: false } : { src: thumbnailFallbackPortraits[unit.portrait.kind], fallback: true };
}

function UnitPortraitCard({
  unit,
  statLabels,
  selected,
  selectable,
  rosterSelected,
  preparing,
  onSelect,
}: {
  unit?: CombatUnitCardModel;
  statLabels: { health: string; resource: string };
  selected: boolean;
  selectable: boolean;
  rosterSelected?: boolean;
  preparing?: boolean;
  onSelect: () => void;
}) {
  if (!unit) return <div className="combat-wireframe__portrait-card is-empty">暂无单位</div>;
  const portrait = battlePortraitFor(unit);
  const feedbackKind = unit.feedback === 'hit' && unit.feedbackText?.includes('暴击') ? 'critical' : unit.feedback;
  return (
    <button
      type="button"
      className={`combat-wireframe__portrait-card is-${unit.side}${selectable ? ' is-selectable' : ''}${selected ? ' is-selected' : ''}${unit.isActive ? ' is-active' : ''}${unit.hp <= 0 ? ' is-defeated' : ''}${unit.feedback ? ` is-${unit.feedback}` : ''}`}
      onClick={onSelect}
      aria-pressed={selectable ? selected : undefined}
      aria-label={`${unit.name}，${statLabels.health} ${unit.hp}/${unit.maxHp}${selectable ? '，点击选择' : ''}`}
    >
      <span className="combat-wireframe__portrait-glow" aria-hidden="true" />
      <img className={`combat-wireframe__portrait-art${portrait.fallback ? ` is-fallback is-${unit.portrait.kind}` : ' is-custom'}`} src={portrait.src} alt="" draggable={false} />
      <img className="combat-wireframe__portrait-frame" src="/art/theme/ui-kit/dawn-v4/combat/battle-portrait-frame-v1.png" alt="" draggable={false} />
      <span className="combat-wireframe__side-mark">{unit.side === 'ally' ? '我方' : '敌方'}</span>
      {preparing && <span className={`combat-wireframe__roster-mark${rosterSelected ? ' is-selected' : ''}`}>{rosterSelected ? '已出战' : '未出战'}</span>}
      <span className="combat-wireframe__portrait-info">
        <span className="combat-wireframe__identity-line"><strong>{unit.name}</strong><small>{unit.isActive ? '当前行动' : unit.actedThisRound ? '本轮已行动' : unit.hp <= 0 ? '已退场' : `顺序 ${unit.initiativeIndex >= 0 ? unit.initiativeIndex + 1 : '—'}`}</small></span>
        <span className="combat-wireframe__meter-row"><Heart size={13} aria-hidden="true" /><span>{statLabels.health} {unit.hp}/{unit.maxHp}</span><i className="combat-wireframe__meter"><b style={{ width: `${unit.hpPercent}%` }} /></i></span>
        <span className="combat-wireframe__meter-row"><Zap size={13} aria-hidden="true" /><span>{statLabels.resource} {unit.resource}/{unit.maxResource}</span><i className="combat-wireframe__meter is-resource"><b style={{ width: `${unit.resourcePercent}%` }} /></i></span>
        <span className="combat-wireframe__tags">{unit.statuses.length ? unit.statuses.map(status => <em key={status}>{status}</em>) : <em>状态正常</em>}</span>
      </span>
      {unit.feedbackText && unit.feedback !== 'acted' && <span key={unit.feedbackEventId} className="combat-wireframe__feedback" role="status">{unit.feedbackText}</span>}
      {(feedbackKind === 'hit' || feedbackKind === 'critical') && <svg key={unit.feedbackEventId} className={`combat-wireframe__feedback-flash is-${feedbackKind} is-${unit.side}`} viewBox="0 0 40 40" aria-hidden="true"><path d={unit.side === 'enemy' ? 'M7 32 28 9M12 35 33 12M6 20l7 3M22 7l4 7' : 'M33 32 12 9M28 35 7 12M34 20l-7 3M18 7l-4 7'} /></svg>}
    </button>
  );
}

function RosterRail({
  units, focusId, selectedRoster, preparing, onChoose,
}: {
  units: CombatUnitCardModel[];
  focusId?: string;
  selectedRoster: string[];
  preparing: boolean;
  onChoose: (unit: CombatUnitCardModel) => void;
}) {
  return (
    <div className="combat-wireframe__roster-rail" aria-label="队伍成员">
      {units.map(unit => {
        const portrait = thumbnailPortraitFor(unit);
        const rosterSelected = selectedRoster.includes(unit.id);
        return <button key={unit.id} type="button" className={`${focusId === unit.id ? 'is-focused' : ''}${unit.isActive ? ' is-active' : ''}${unit.hp <= 0 ? ' is-defeated' : ''}${preparing && rosterSelected ? ' is-rostered' : ''}`} onClick={() => onChoose(unit)} aria-label={`${unit.name}${preparing ? rosterSelected ? '，已出战' : '，未出战' : ''}`}><img src={portrait.src} alt="" className={portrait.fallback ? 'is-fallback' : ''} /><span>{unit.name}</span><i><b style={{ width: `${unit.hpPercent}%` }} /></i></button>;
      })}
    </div>
  );
}

export default function CombatBattlefield({
  allyUnits, enemyUnits, allyFocus, enemyFocus, effectiveTarget, targetIds, selectedRoster, preparing, statLabels, onChoose,
}: {
  allyUnits: CombatUnitCardModel[];
  enemyUnits: CombatUnitCardModel[];
  allyFocus?: CombatUnitCardModel;
  enemyFocus?: CombatUnitCardModel;
  effectiveTarget: string;
  targetIds: Set<string>;
  selectedRoster: string[];
  preparing: boolean;
  statLabels: { health: string; resource: string };
  onChoose: (unit: CombatUnitCardModel) => void;
}) {
  return (
    <main className="combat-wireframe__stage">
      <section className="combat-wireframe__side is-ally" aria-labelledby="combat-allies-heading"><div className="combat-wireframe__side-heading"><span id="combat-allies-heading">我方阵线</span><small>{allyUnits.filter(unit => unit.hp > 0).length}/{allyUnits.length}</small></div><div className="combat-wireframe__formation"><RosterRail units={allyUnits} focusId={allyFocus?.id} selectedRoster={selectedRoster} preparing={preparing} onChoose={onChoose} /><UnitPortraitCard unit={allyFocus} statLabels={statLabels} selected={effectiveTarget === allyFocus?.id} selectable={Boolean(allyFocus && (preparing || targetIds.has(allyFocus.id)))} rosterSelected={Boolean(allyFocus && selectedRoster.includes(allyFocus.id))} preparing={preparing} onSelect={() => allyFocus && onChoose(allyFocus)} /></div></section>
      <div className="combat-wireframe__clash" aria-hidden="true"><span /><Swords size={26} /><span /></div>
      <section className="combat-wireframe__side is-enemy" aria-labelledby="combat-enemies-heading"><div className="combat-wireframe__side-heading"><span id="combat-enemies-heading">敌方阵线</span><small>{enemyUnits.filter(unit => unit.hp > 0).length}/{enemyUnits.length}</small></div><div className="combat-wireframe__formation"><UnitPortraitCard unit={enemyFocus} statLabels={statLabels} selected={effectiveTarget === enemyFocus?.id} selectable={Boolean(enemyFocus && targetIds.has(enemyFocus.id))} onSelect={() => enemyFocus && onChoose(enemyFocus)} /><RosterRail units={enemyUnits} focusId={enemyFocus?.id} selectedRoster={selectedRoster} preparing={false} onChoose={onChoose} /></div></section>
    </main>
  );
}
