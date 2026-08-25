import { Play } from 'lucide-react';
import type { CombatUnitCardModel } from '../../../gameplay/combatViewModel';
import { thumbnailPortraitFor } from './CombatBattlefield';

export default function CombatFormation({
  units, selectedRoster, hasNoEnemies, readOnly, saving, onToggleRoster, onStart,
}: {
  units: CombatUnitCardModel[];
  selectedRoster: string[];
  hasNoEnemies: boolean;
  readOnly: boolean;
  saving: boolean;
  onToggleRoster: (id: string) => void;
  onStart: (selectedIds: string[]) => void;
}) {
  return <footer className="combat-wireframe__prepare">
    <div className="combat-wireframe__prepare-copy"><strong>选择出战阵容</strong><p>玩家固定出战，再选择至多三名友方、宠物或召唤物。</p><span>已选择 {selectedRoster.length}/4</span></div>
    <div className="combat-wireframe__prepare-roster" aria-label="可选出战成员">{units.map(unit => { const portrait = thumbnailPortraitFor(unit); const selected = selectedRoster.includes(unit.id); return <button key={unit.id} type="button" className={selected ? 'is-selected' : ''} onClick={() => onToggleRoster(unit.id)} disabled={readOnly || unit.id === 'player'} aria-pressed={selected}><img src={portrait.src} alt="" /><span><strong>{unit.name}</strong><small>{unit.id === 'player' ? '玩家 · 固定出战' : selected ? '已加入阵容' : '点击加入阵容'}</small></span><i>{selected ? '已选' : '待选'}</i></button>; })}</div>
    <button type="button" className="combat-wireframe__primary" onClick={() => onStart(selectedRoster)} disabled={readOnly || saving || selectedRoster.length === 0 || hasNoEnemies}><Play size={17} aria-hidden="true" />开始战斗</button>
  </footer>;
}
