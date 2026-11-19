import { ArrowLeft } from 'lucide-react';
import type { CombatSessionV2 } from '../../../gameplay/protocols';
import type { CombatUnitCardModel } from '../../../gameplay/combatViewModel';
import { unitArtFor } from './combatArt';
import type { BattleSceneId } from './battleScene';

const riskLabels: Record<CombatSessionV2['riskMode'], string> = { easy: '简单', normal: '普通', hard: '困难', inferno: '炼狱' };
const threatLabels: Record<CombatSessionV2['encounter']['threatBand'], string> = { weak: '弱小', matched: '匹敌', dangerous: '危险', boss: '首领', overwhelming: '压倒性' };

export default function CombatHeader({
  session, saving, error, readOnly, units, onLeave, scene,
}: {
  session: CombatSessionV2;
  scene?: BattleSceneId;
  saving: boolean;
  error?: string | null;
  readOnly: boolean;
  units: CombatUnitCardModel[];
  onLeave: () => void;
}) {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const queue = session.lifecycle === 'active'
    ? session.initiativeOrder.map(id => byId.get(id)).filter((unit): unit is CombatUnitCardModel => Boolean(unit))
    : [];
  return (
    <header className="cb-header">
      <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm cb-header__leave" onClick={onLeave} disabled={saving} aria-label="保存并返回旅庭">
        <ArrowLeft size={17} aria-hidden="true" />
        <span>返回旅庭</span>
      </button>
      <div className="cb-header__title">
        <span className="cb-header__eyebrow">{threatLabels[session.encounter.threatBand]}遭遇 · {riskLabels[session.riskMode]}风险</span>
        <h1>{session.encounter.context}</h1>
      </div>
      <span className={`cb-header__save${error ? ' is-error' : saving ? ' is-saving' : ''}`} aria-live="polite">
        <i aria-hidden="true" />{saving ? '正在保存' : error ? error : readOnly ? '封存 · 只读' : '已保存'}
      </span>
      {queue.length > 0 && (
        <ol className="cb-queue" aria-label={`行动顺序：${queue.map(unit => unit.name).join('、')}`}>
          {queue.map(unit => {
            const art = unitArtFor(unit, scene);
            const state = unit.hp <= 0 ? ' is-out' : unit.isActive ? ' is-now' : unit.actedThisRound ? ' is-done' : '';
            return (
              <li key={unit.id} className={`cb-queue__chip is-${unit.side}${state}`} title={unit.name}>
                <img src={art.src} alt="" draggable={false} />
                <span>{unit.name}</span>
              </li>
            );
          })}
        </ol>
      )}
    </header>
  );
}
