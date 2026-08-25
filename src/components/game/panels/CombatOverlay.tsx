import { useMemo, useState } from 'react';
import { Heart, Shield, Square, Swords, Target, Timer, Zap } from 'lucide-react';
import type { GameState } from '../../../schema/variables';
import type { CombatModuleSchema, StatModuleSchema } from '../../../modules/schema';
import DawnFrameV4 from '../../shared/dawn/DawnFrameV4';
import { describeCombatActionFormula } from '../../../gameplay/combat';

export default function CombatOverlay({
  state,
  gameState,
  config,
  onAction,
  onEnd,
  statConfig,
}: {
  state: NonNullable<GameState['combat']>;
  gameState: GameState;
  config: CombatModuleSchema;
  onAction: (actionId: string, targetId: string) => void;
  onEnd: () => void;
  statConfig?: StatModuleSchema;
}) {
  const active = state.active;
  const [selectedTarget, setSelectedTarget] = useState('');
  const enemies = active?.participants.filter(item => item.side === 'enemy') ?? [];
  const firstLiving = useMemo(() => enemies.find(item => item.hp > 0)?.id ?? '', [enemies]);
  if (!active) return null;
  const targetId = selectedTarget && enemies.some(item => item.id === selectedTarget && item.hp > 0) ? selectedTarget : firstLiving;
  const player = active.participants.find(item => item.id === 'player');
  const actions = config.playerActions ?? [];
  return (
    <div className="combat-encounter-overlay" role="dialog" aria-modal="true" aria-label="战斗遭遇">
      <DawnFrameV4 mode="panel" withFill className="combat-encounter-overlay__frame" ariaLabel="战斗遭遇">
        <div className="combat-encounter-overlay__content">
          <header>
            <div><span>第 {active.round} 回合 · 行动点 {active.actionPoints}/{active.actionPointsPerTurn}</span><h2>{active.encounterName}</h2></div>
            <button className="btn-ghost" onClick={onEnd}><Square size={14} />退出战斗</button>
          </header>
          <section className="combat-encounter-overlay__field">
            <article className="combatant-card is-player">
              <strong>玩家</strong><span><Heart size={13} />{Math.max(0, player?.hp ?? 0)}/{player?.maxHp ?? 0}</span>
              <i style={{ width: `${Math.max(0, Math.min(100, ((player?.hp ?? 0) / Math.max(1, player?.maxHp ?? 1)) * 100))}%` }} />
            </article>
            <div className="combat-encounter-overlay__versus"><Swords size={24} /><span>对阵</span></div>
            <div className="combat-encounter-overlay__enemies">
              {enemies.map(enemy => <button key={enemy.id} className={`combatant-card${targetId === enemy.id ? ' is-selected' : ''}`} disabled={enemy.hp <= 0} onClick={() => setSelectedTarget(enemy.id)}>
                <strong><Target size={13} />{enemy.name}</strong><span><Heart size={13} />{Math.max(0, enemy.hp)}/{enemy.maxHp}<Shield size={12} />{enemy.armor}</span>
                <i style={{ width: `${Math.max(0, Math.min(100, enemy.hp / Math.max(1, enemy.maxHp) * 100))}%` }} />
              </button>)}
            </div>
          </section>
          <section className="combat-encounter-overlay__actions" aria-label="可用行动">
            {actions.map(action => {
              const target = action.target === 'self' || action.target === 'ally' ? 'player' : targetId;
              const cooldown = player?.cooldowns?.[action.id] ?? 0;
              return <button key={action.id} className="btn-primary" disabled={!target || active.activeActorId !== 'player' || active.actionPoints < Math.max(1, action.actionCost ?? 1) || cooldown > 0} onClick={() => onAction(action.id, target)} title={`${action.description ?? ''}${action.description ? '\n' : ''}${describeCombatActionFormula(action, statConfig, gameState)}`}>
                <Swords size={14} /><span>{action.name}</span><small>{cooldown ? <><Timer size={11} />{cooldown}</> : <><Zap size={11} />{Math.max(1, action.actionCost ?? 1)}</>}</small>
              </button>;
            })}
          </section>
          <details><summary>战斗记录</summary><div className="combat-encounter-overlay__log">{active.log.slice(-10).map((entry, index) => <p key={`${entry.round}-${index}`}>{entry.text}</p>)}</div></details>
        </div>
      </DawnFrameV4>
    </div>
  );
}
