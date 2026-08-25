import { Footprints, Package, Pause, Play, Shield, Sparkles, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CombatActionKind, CombatSessionV2 } from '../../../gameplay/protocols';
import type { CombatAutoStrategy } from '../../../gameplay/combatV2';

const strategyLabels: Record<CombatAutoStrategy, string> = { aggressive: '进攻', balanced: '均衡', defensive: '防守', support: '支援' };
const controlLabels: Record<CombatActionKind, string> = { attack: '攻击', skill: '技能', item: '道具', defend: '防御', flee: '脱离' };

export default function CombatCommandDeck({
  session, actorIdentity, actorSide, actionMode, actionDescription, autoStrategy, readOnly, actionOptions, recentActions, onSetAutoStrategy, onSetActionMode,
}: {
  session: CombatSessionV2;
  actorIdentity?: string;
  actorSide?: string;
  actionMode: CombatActionKind;
  actionDescription: string;
  autoStrategy: CombatAutoStrategy | null;
  readOnly: boolean;
  actionOptions: ReactNode;
  recentActions: CombatSessionV2['actionSequence'];
  onSetAutoStrategy: (strategy: CombatAutoStrategy | null) => void;
  onSetActionMode: (kind: CombatActionKind) => void;
}) {
  return <footer className="combat-wireframe__command-deck">
    <section className="combat-wireframe__action-panel" aria-label="战斗招式">
      <div className="combat-wireframe__turn-summary" aria-live="polite"><div><strong>{actorIdentity ? `${actorIdentity}正在行动` : '等待行动单位'}</strong><span>{actorSide === 'enemy' ? '敌方正在思考本轮行动…' : autoStrategy ? `${strategyLabels[autoStrategy]}自动策略已启用` : `${controlLabels[actionMode]} · ${actionDescription}`}</span></div></div>
      <div className="combat-wireframe__action-list">{actionOptions}</div>
      <details className="combat-wireframe__log"><summary>查看机械战报</summary>{recentActions.length === 0 ? <p>尚无行动记录。</p> : recentActions.map(action => <p key={action.id}>{action.round} 回合 · {session.participants.find(unit => unit.id === action.unitId)?.identity ?? action.unitId} · {controlLabels[action.kind]}{action.damage ? ` · ${action.damage} 伤害` : ''}{action.healing ? ` · ${action.healing} 治疗` : ''}{action.hit === false ? ' · 未命中' : ''}</p>)}</details>
    </section>
    <aside className="combat-wireframe__command-panel">
      <div className="combat-wireframe__automation" aria-label="操作方式"><div className="combat-wireframe__automation-heading"><strong>操作方式</strong><span>{autoStrategy ? `${strategyLabels[autoStrategy]}策略` : '逐次手动下令'}</span></div><div className="combat-wireframe__mode-switch"><button type="button" className={!autoStrategy ? 'is-selected' : ''} onClick={() => onSetAutoStrategy(null)} disabled={readOnly}><Pause size={13} />手动</button><button type="button" className={autoStrategy ? 'is-selected' : ''} onClick={() => onSetAutoStrategy(autoStrategy ?? 'balanced')} disabled={readOnly}><Play size={13} />自动</button></div>{autoStrategy && <div className="combat-wireframe__strategy-switch" aria-label="自动策略">{(Object.keys(strategyLabels) as CombatAutoStrategy[]).map(strategy => <button key={strategy} type="button" className={autoStrategy === strategy ? 'is-selected' : ''} onClick={() => onSetAutoStrategy(strategy)} disabled={readOnly}>{strategyLabels[strategy]}</button>)}</div>}</div>
      <nav className="combat-wireframe__command-pad" aria-label="战斗指令"><img src="/art/theme/ui-kit/dawn-v4/combat/battle-command-bezel-v2.png" alt="" aria-hidden="true" />{session.lifecycle === 'active' && (['attack', 'skill', 'item', 'defend', 'flee'] as CombatActionKind[]).map(kind => { const Icon = kind === 'attack' ? Target : kind === 'skill' ? Sparkles : kind === 'item' ? Package : kind === 'defend' ? Shield : Footprints; return <button key={kind} type="button" className={`is-${kind}${actionMode === kind ? ' is-selected' : ''}`} onClick={() => onSetActionMode(kind)} aria-pressed={actionMode === kind}><Icon size={18} aria-hidden="true" /><span>{controlLabels[kind]}</span></button>; })}</nav>
    </aside>
  </footer>;
}
