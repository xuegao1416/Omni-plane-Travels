import { useCallback, useMemo, useState } from 'react';
import { LockKeyhole, Play, Sparkles, Star } from 'lucide-react';
import type { ProfessionAbilityDef, ProfessionModuleSchema, StatModuleSchema } from '../../../modules/schema';
import type { GameState } from '../../../schema/variables';
import { canUnlockProfessionAbility, describeProfessionAbilityMechanics } from '../../../gameplay/profession';
import { professionEmblemSrc, resolveProfessionVisual } from '../../../data/professions/professionVisuals';
import '../../../styles/profession-library.css';
import ProfessionBook from '../../profession/ProfessionBook';

const TYPE_LABEL: Record<ProfessionAbilityDef['type'], string> = {
  active: '主动能力', passive: '被动能力', specialization: '职业专精', ultimate: '终极能力',
};

export default function ProfessionTreePanel({
  config,
  gameState,
  currentTick,
  statConfig,
  onUnlock,
  onUse,
}: {
  config?: ProfessionModuleSchema;
  gameState: GameState;
  currentTick: number;
  statConfig?: StatModuleSchema;
  onUnlock: (abilityId: string) => void;
  onUse: (abilityId: string) => void;
}) {
  const runtime = gameState.玩家.能力系统?.职业状态;
  const profession = config?.professions.find(item => item.id === runtime?.职业ID);
  const [selectedId, setSelectedId] = useState('');
  const selected = useMemo(() => profession?.abilities.find(item => item.id === selectedId) ?? profession?.abilities[0], [profession, selectedId]);
  const stateFor = useCallback((ability: ProfessionAbilityDef) => {
    if (runtime?.已解锁能力?.[ability.id]) return 'owned' as const;
    return config && canUnlockProfessionAbility(gameState, config, ability.id).ok ? 'available' as const : 'locked' as const;
  }, [runtime, config, gameState]);
  const check = selected && config ? canUnlockProfessionAbility(gameState, config, selected.id) : { ok: false, reason: '没有可用职业' };
  const owned = selected ? runtime?.已解锁能力?.[selected.id] : undefined;
  const cooldown = Math.max(0, (owned?.冷却至轮次 ?? 0) - currentTick);
  const canUse = Boolean(owned && selected && (selected.type === 'active' || selected.type === 'ultimate') && selected.activation && (selected.activation.effects?.length || selected.activation.rewards?.length));
  const mechanics = selected ? describeProfessionAbilityMechanics(selected, statConfig, gameState) : '';

  if (!config?.professions.length) return <div className="profession-tree-canvas__empty">当前世界没有挂载可用职业包。</div>;
  if (!profession) {
    return <div className="profession-game-panel">
      <div className="profession-tree-canvas__empty">当前角色选择了无职业。先天天赋与自由技能仍然保留，但没有职业树可展开。</div>
      {!!Object.keys(gameState.玩家.能力系统?.先天天赋 ?? {}).length && <div className="profession-game-panel__details"><h3><Star size={14} /> 先天天赋</h3><p>{Object.values(gameState.玩家.能力系统?.先天天赋 ?? {}).map(item => item.名称).join('、')}</p></div>}
    </div>;
  }

  const visual = resolveProfessionVisual(profession);

  return (
    <div className="profession-game-panel profession-dossier">
      <header className="profession-dossier__identity">
        <div className="profession-dossier__emblem"><img src={professionEmblemSrc(visual.emblemKey)} alt="" aria-hidden="true" onError={event => { event.currentTarget.style.display = 'none'; }} /></div>
        <div className="profession-dossier__name"><span>职业卷宗 · {profession.archetype ?? '职业道路'}</span><h2>{profession.name}</h2><p>{profession.description}</p></div>
        <div className="profession-dossier__stats"><strong>Lv.{runtime?.职业等级 ?? 1}</strong><span>能力点 {runtime?.能力点 ?? 0}</span></div>
      </header>
      <p className="profession-game-panel__hint">按四阶道路展开；选择节点查看具体前置关系，节点颜色表示锁定、可解锁与已掌握状态。</p>
      <ProfessionBook profession={profession} selectedAbilityId={selected?.id} onSelectAbility={setSelectedId} stateFor={stateFor} />
      {selected && <div className="profession-dossier__details">
        <h3>{selected.name} · {TYPE_LABEL[selected.type]} · 第 {selected.tier ?? 1} 阶</h3>
        <p>{selected.description}</p>
        {mechanics && <p className="profession-game-panel__formula">{mechanics}</p>}
        {selected.prerequisites?.length ? <p>前置：{selected.prerequisites.map(id => profession.abilities.find(item => item.id === id)?.name ?? id).join('、')}</p> : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {!owned ? <button className="btn-primary btn-sm" disabled={!check.ok} title={check.reason} onClick={() => onUnlock(selected.id)}><LockKeyhole size={13} />解锁 · {selected.pointCost ?? 1} 点</button> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)', fontSize: 12 }}><Sparkles size={13} />已掌握</span>}
          {canUse && <button className="btn-primary btn-sm" disabled={cooldown > 0} onClick={() => onUse(selected.id)}><Play size={13} />{cooldown ? `冷却 ${cooldown}` : '使用能力'}</button>}
          {owned && selected.activation?.combatAction && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>进入战斗后自动加入行动栏</span>}
        </div>
      </div>}
    </div>
  );
}
