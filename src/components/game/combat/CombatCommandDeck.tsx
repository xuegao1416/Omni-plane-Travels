import { useState,type ReactNode } from 'react';
import { ScrollText } from 'lucide-react';
import type { CombatActionKind,CombatSessionV2 } from '../../../gameplay/protocols';
import type { CombatAutoStrategy } from '../../../gameplay/combatV2';
import type { CombatUnitCardModel } from '../../../gameplay/combatViewModel';
import PlanarFrame from '../../../ui/planar/PlanarFrame';
import { GlyphAttack,GlyphDefend,GlyphFlee,GlyphItem,GlyphSkill,unitArtFor } from './combatArt';
import type { BattleSceneId } from './battleScene';

const strategyLabels: Record<CombatAutoStrategy, string> = { aggressive: '进攻', balanced: '均衡', defensive: '防守', support: '支援' };
export const controlLabels: Record<CombatActionKind, string> = { attack: '攻击', skill: '技能', item: '道具', defend: '防御', flee: '脱离' };
const glyphs: Record<CombatActionKind, () => ReactNode> = { attack: GlyphAttack, skill: GlyphSkill, item: GlyphItem, defend: GlyphDefend, flee: GlyphFlee };
const hotkeys: Record<CombatActionKind, string> = { attack: '1', skill: '2', item: '3', defend: '4', flee: '5' };

export function CommandGlyph({ kind }: { kind: CombatActionKind }) {
  const Glyph = glyphs[kind];
  return <Glyph />;
}

export default function CombatCommandDeck({
  session, actor, actionMode, actionDescription, autoStrategy, readOnly, manual, statLabels, actionOptions, recentActions, onSetAutoStrategy, onSetActionMode, scene,
}: {
  session: CombatSessionV2;
  scene?: BattleSceneId;
  actor?: CombatUnitCardModel;
  actionMode: CombatActionKind;
  actionDescription: string;
  autoStrategy: CombatAutoStrategy | null;
  readOnly: boolean;
  manual: boolean;
  statLabels: { health: string; resource: string };
  actionOptions: ReactNode;
  recentActions: CombatSessionV2['actionSequence'];
  onSetAutoStrategy: (strategy: CombatAutoStrategy | null) => void;
  onSetActionMode: (kind: CombatActionKind) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const enemyTurn = actor?.side === 'enemy';
  const art = actor ? unitArtFor(actor, scene) : null;
  const nameOf = (id: string) => session.participants.find(unit => unit.id === id)?.identity ?? id;
  return (
    <footer className={`cb-deck${enemyTurn ? ' is-enemy-turn' : ''}${autoStrategy ? ' is-auto' : ''}`}>
      <PlanarFrame as="section" variant="plate" material="cloth" gem={enemyTurn ? 'garnet' : 'amber'} className="cb-deck__actor"><div className="cb-deck__actor-body" aria-live="polite">
        {actor && art && <span className={`cb-deck__actor-art is-${actor.side}`}><img src={art.src} alt="" draggable={false} /></span>}
        <div className="cb-deck__actor-copy">
          <small>{enemyTurn ? '敌方回合' : autoStrategy ? `自动 · ${strategyLabels[autoStrategy]}` : '你的回合'}</small>
          <strong>{actor?.name ?? '等待行动单位'}</strong>
          {actor && <span className="cb-deck__actor-bars">
            <i className="is-hp" style={{ '--v': `${actor.hpPercent}%` } as React.CSSProperties}><b /></i>
            <i className="is-res" style={{ '--v': `${actor.resourcePercent}%` } as React.CSSProperties}><b /></i>
          </span>}
          {actor && <span className="cb-deck__actor-nums">{statLabels.health} {actor.hp}/{actor.maxHp} · {statLabels.resource} {actor.resource}/{actor.maxResource}</span>}
        </div>
      </div></PlanarFrame>

      <section className="cb-deck__options" aria-label="招式">
        <div className="cb-deck__options-head">
          <strong>{enemyTurn ? '敌方正在出手' : controlLabels[actionMode]}</strong>
          <span>{enemyTurn ? '观察对手的动作，下一轮再作应对。' : autoStrategy ? '自动策略正在下令，切回手动即可接管。' : actionDescription}</span>
          <button type="button" className={`pk-btn pk-btn--secondary pk-btn--sm cb-deck__log-toggle${logOpen ? ' is-open' : ''}`} onClick={() => setLogOpen(open => !open)} aria-expanded={logOpen}><ScrollText size={14} aria-hidden="true" />战报</button>
        </div>
        {logOpen
          ? <ol className="cb-deck__log">{recentActions.length === 0 ? <li className="is-empty">尚无行动记录。</li> : recentActions.map(action => <li key={action.id}><b>R{action.round}</b><span>{nameOf(action.unitId)}</span><em>{controlLabels[action.kind]}</em>{action.targetIds.length > 0 && action.kind !== 'defend' && action.kind !== 'flee' && <span>→ {action.targetIds.map(nameOf).join('、')}</span>}{action.hit === false ? <i className="is-miss">未命中</i> : action.damage ? <i className={action.critical ? 'is-crit' : 'is-dmg'}>{action.damage}{action.critical ? ' 暴击' : ''}</i> : action.healing ? <i className="is-heal">+{action.healing}</i> : null}</li>)}</ol>
          : <div className={`cb-deck__option-list${manual ? '' : ' is-locked'}`}>{actionOptions}</div>}
      </section>

      <aside className="cb-deck__controls">
        <nav className="cb-dial" aria-label="战斗指令">
          {(['attack', 'skill', 'item', 'defend', 'flee'] as CombatActionKind[]).map(kind => (
            <button key={kind} type="button" className={`cb-dial__key is-${kind}${actionMode === kind ? ' is-selected' : ''}`} onClick={() => onSetActionMode(kind)} aria-pressed={actionMode === kind} aria-keyshortcuts={hotkeys[kind]}>
              <CommandGlyph kind={kind} />
              <span>{controlLabels[kind]}</span>
              <kbd aria-hidden="true">{hotkeys[kind]}</kbd>
            </button>
          ))}
        </nav>
        <div className="cb-auto" aria-label="操作方式">
          <button type="button" className={`cb-auto__switch${autoStrategy ? ' is-on' : ''}`} role="switch" aria-checked={Boolean(autoStrategy)} onClick={() => onSetAutoStrategy(autoStrategy ? null : 'balanced')} disabled={readOnly}>
            <span className="cb-auto__track"><span className="cb-auto__knob" /></span>
            <span>自动战斗</span>
          </button>
          {autoStrategy && <div className="cb-auto__strategies">{(Object.keys(strategyLabels) as CombatAutoStrategy[]).map(strategy => <button key={strategy} type="button" className={autoStrategy === strategy ? 'is-selected' : ''} onClick={() => onSetAutoStrategy(strategy)} disabled={readOnly}>{strategyLabels[strategy]}</button>)}</div>}
        </div>
      </aside>
    </footer>
  );
}
