import type { CombatUnitCardModel } from '../../../gameplay/combatViewModel';
import { unitArtFor } from './combatArt';
import type { BattleSceneId } from './battleScene';

export default function CombatFormation({
  units, selectedRoster, hasNoEnemies, readOnly, saving, onToggleRoster, onStart, scene,
}: {
  units: CombatUnitCardModel[];
  scene?: BattleSceneId;
  selectedRoster: string[];
  hasNoEnemies: boolean;
  readOnly: boolean;
  saving: boolean;
  onToggleRoster: (id: string) => void;
  onStart: (selectedIds: string[]) => void;
}) {
  const full = selectedRoster.length >= 4;
  return (
    <footer className="cb-formation">
      <div className="cb-formation__copy">
        <small>布阵</small>
        <strong>选择出战阵容</strong>
        <p>你固定出战，可再带至多三名同伴、宠物或召唤物。</p>
        <span className="cb-formation__pips" aria-label={`已选择 ${selectedRoster.length}/4`}>
          {[0, 1, 2, 3].map(index => <i key={index} className={index < selectedRoster.length ? 'is-on' : ''} />)}
          <b>{selectedRoster.length}/4</b>
        </span>
      </div>
      <div className="cb-formation__roster" aria-label="可选出战成员">
        {units.map(unit => {
          const art = unitArtFor(unit, scene);
          const selected = selectedRoster.includes(unit.id);
          const locked = unit.id === 'player';
          return (
            <button key={unit.id} type="button" className={`cb-formation__member${selected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`} onClick={() => onToggleRoster(unit.id)} disabled={readOnly || locked || (!selected && full)} aria-pressed={selected}>
              <span className="cb-formation__art"><img src={art.src} alt="" draggable={false} /></span>
              <span className="cb-formation__name"><strong>{unit.name}</strong><small>{locked ? '固定出战' : selected ? '已入阵' : full ? '阵容已满' : '点击入阵'}</small></span>
            </button>
          );
        })}
      </div>
      <button type="button" className="pk-btn pk-btn--primary cb-cta" onClick={() => onStart(selectedRoster)} disabled={readOnly || saving || selectedRoster.length === 0 || hasNoEnemies}>
        <span>开战</span>
      </button>
    </footer>
  );
}
