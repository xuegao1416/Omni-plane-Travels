import { useEffect,useMemo,useRef,useState } from 'react';
import type {
AbilityDefinition,
AbilityProposalTarget,
CombatActionKind,
CombatCommandInputV2,
CombatSessionV2,
} from '../../gameplay/protocols';
import { getCombatAbilityCostsV2,previewCombatAbilityV2,type CombatAutoStrategy } from '../../gameplay/combatV2';
import { buildCombatViewModel,type CombatUnitCardModel } from '../../gameplay/combatViewModel';
import CombatBattlefield from './combat/CombatBattlefield';
import CombatCommandDeck,{ CommandGlyph } from './combat/CombatCommandDeck';
import CombatFormation from './combat/CombatFormation';
import CombatHeader from './combat/CombatHeader';
import CombatResult from './combat/CombatResult';
import { resolveBattleScene,type BattleWorldHint } from './combat/battleScene';
import '../../ui/screens/combat.css';

interface Props {
  session: CombatSessionV2;
  worldSceneUrl?: string;
  /** Name / tags / description of the current world; picks the painted battlefield. */
  world?: BattleWorldHint | null;
  statLabels?: { health: string; resource: string };
  portraits?: Record<string, { src?: string; gender?: string }>;
  saving?: boolean;
  error?: string | null;
  autoStrategy?: CombatAutoStrategy | null;
  readOnly?: boolean;
  onCommand: (input: CombatCommandInputV2) => void;
  onStart: (selectedIds: string[]) => void;
  onSetAutoStrategy: (strategy: CombatAutoStrategy | null) => void;
  onRetry: () => void;
  onContinueNarration: () => void;
  onLeave: () => void;
}

const actionDescriptions: Record<CombatActionKind, string> = {
  attack: '选择目标，发动一次稳定的普通攻击。',
  skill: '从已掌握的主动能力中选择本轮招式。',
  item: '消耗一件具有受控战斗用途的物品。',
  defend: '降低本轮承受的伤害，等待下一次行动。',
  flee: '尝试脱离当前遭遇，结果由本地规则结算。',
};

const itemPurposeLabels: Record<string, string> = {
  heal: '恢复生命', resource: '恢复能量', damage: '伤害', cleanse: '净化', buff: '增益',
};

export default function CombatWireframe({
  session,
  worldSceneUrl,
  world,
  statLabels: statLabelsProp,
  portraits = {},
  saving = false,
  error,
  autoStrategy = null,
  readOnly = false,
  onCommand,
  onStart,
  onSetAutoStrategy,
  onRetry,
  onContinueNarration,
  onLeave,
}: Props) {
  const statLabels = statLabelsProp ?? session.statLabels ?? { health: '生命', resource: '能量' };
  const dialogRef = useRef<HTMLElement>(null);
  const view = buildCombatViewModel(session, portraits);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [actionMode, setActionMode] = useState<CombatActionKind>('attack');
  const [selectedAbility, setSelectedAbility] = useState('');
  const [selectedItem, setSelectedItem] = useState('');
  const [selectedRoster, setSelectedRoster] = useState<string[]>(['player']);
  const [allyFocusId, setAllyFocusId] = useState('player');
  const [enemyFocusId, setEnemyFocusId] = useState('');
  const actor = session.participants.find(unit => unit.id === session.activeUnitId);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, [session.id]);

  useEffect(() => {
    setSelectedRoster(['player']);
    setSelectedTarget('');
    setActionMode('attack');
    setSelectedAbility('');
    setSelectedItem('');
    setAllyFocusId('player');
    setEnemyFocusId('');
  }, [session.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) { onLeave(); return; }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const kinds: CombatActionKind[] = ['attack', 'skill', 'item', 'defend', 'flee'];
      const index = Number(event.key) - 1;
      if (index >= 0 && index < kinds.length && session.lifecycle === 'active') setActionMode(kinds[index]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onLeave, saving, session.lifecycle]);

  const abilities = useMemo(() => Object.values(actor?.abilityDefinitions ?? {}).filter(definition => {
    const instance = actor?.abilityInstances?.[definition.id] ?? session.abilityInstances[definition.id];
    return definition.abilityType !== 'passive'
      && definition.abilityType !== 'specialization'
      && Boolean(definition.mechanics?.combatAction)
      && (instance?.runtime.rank ?? 0) > 0;
  }), [actor, session.abilityInstances]);

  const items = useMemo(() => Object.entries(actor?.itemQuantities ?? {})
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => ({ id, quantity, definition: session.itemDefinitions[id] })), [actor, session.itemDefinitions]);

  useEffect(() => {
    setSelectedAbility(previous => abilities.some(ability => ability.id === previous) ? previous : abilities[0]?.id ?? '');
    setSelectedItem(previous => items.some(item => item.id === previous) ? previous : items[0]?.id ?? '');
  }, [abilities, items, actor?.id]);

  const isFriendlyTurn = Boolean(actor && actor.side !== 'enemy' && actor.hp > 0);
  const isManualTurn = Boolean(isFriendlyTurn && !autoStrategy && !readOnly);
  const preparing = session.lifecycle === 'preparing';

  const abilityState = (ability: AbilityDefinition) => {
    const runtime = actor?.abilityInstances?.[ability.id]?.runtime ?? session.abilityInstances[ability.id]?.runtime;
    const cooldown = actor?.cooldowns[ability.id] ?? runtime?.cooldownRemaining ?? 0;
    const cost = getCombatAbilityCostsV2(actor, ability, statLabels);
    const reason = cooldown > 0
      ? `冷却中（${cooldown}轮）`
      : cost.reason;
    return { cooldown, costs: cost.costs, reason };
  };

  const targetModeFor = (kind: CombatActionKind, optionId?: string): AbilityProposalTarget => {
    if (kind === 'defend' || kind === 'flee') return 'self';
    if (kind === 'skill') return abilities.find(ability => ability.id === optionId)?.mechanics?.combatAction?.target ?? 'enemy';
    if (kind === 'item') return session.itemDefinitions[optionId ?? '']?.target ?? 'none';
    return 'enemy';
  };

  const legalTargetsFor = (kind: CombatActionKind, optionId?: string): string[] => {
    if (!actor) return [];
    const mode = targetModeFor(kind, optionId);
    const allUnits = [...view.enemyUnits, ...view.allyUnits].filter(unit => unit.isTargetable);
    if (mode === 'none') return [];
    if (mode === 'self') return [actor.id];
    if (mode === 'ally') return allUnits.filter(unit => unit.side === 'ally').map(unit => unit.id);
    return allUnits.filter(unit => unit.side === 'enemy').map(unit => unit.id);
  };

  const selectedOptionId = actionMode === 'skill' ? selectedAbility : actionMode === 'item' ? selectedItem : undefined;
  const visibleLegalTargets = legalTargetsFor(actionMode, selectedOptionId);
  const effectiveTarget = visibleLegalTargets.includes(selectedTarget) ? selectedTarget : visibleLegalTargets[0] ?? '';
  const targetIds = new Set(visibleLegalTargets);

  useEffect(() => {
    if (effectiveTarget !== selectedTarget) setSelectedTarget(effectiveTarget);
  }, [effectiveTarget, selectedTarget, session.activeUnitId, session.round]);

  useEffect(() => {
    if (effectiveTarget && view.enemyUnits.some(unit => unit.id === effectiveTarget)) setEnemyFocusId(effectiveTarget);
    if (effectiveTarget && view.allyUnits.some(unit => unit.id === effectiveTarget)) setAllyFocusId(effectiveTarget);
  }, [effectiveTarget, view.enemyUnits, view.allyUnits]);

  const actionDisabledReason = (kind: CombatActionKind, optionId?: string): string => {
    if (readOnly) return '封存存档只可查看';
    if (!isFriendlyTurn) return '当前由敌方行动';
    if (autoStrategy) return '先暂停自动战斗再手动下令';
    if (saving) return '正在保存战斗状态';
    if (kind === 'skill') {
      const ability = abilities.find(item => item.id === optionId);
      if (!ability) return '技能不可用';
      const unavailable = abilityState(ability).reason;
      if (unavailable) return unavailable;
    }
    if (kind === 'item') {
      const item = items.find(entry => entry.id === optionId);
      if (!item?.definition) return '道具不存在';
      if (item.definition.narrativeOnly) return '叙事物品：无战斗用途标记';
    }
    if ((kind === 'attack' || kind === 'skill' || kind === 'item') && targetModeFor(kind, optionId) !== 'none' && legalTargetsFor(kind, optionId).length === 0) return '当前动作没有合法目标';
    return '';
  };

  const send = (kind: CombatActionKind, optionId?: string) => {
    const disabledReason = actionDisabledReason(kind, optionId);
    if (!actor || !isManualTurn || disabledReason) return;
    const targets = legalTargetsFor(kind, optionId);
    const target = targets.includes(selectedTarget) ? selectedTarget : targets[0] ?? '';
    const mode = targetModeFor(kind, optionId);
    const command: CombatCommandInputV2 = {
      commandId: `${session.id}:ui:${session.round}:${actor.id}:${kind}:${optionId ?? ''}:${target || actor.id}`,
      unitId: actor.id,
      kind,
      targetIds: mode === 'none' ? [] : [target || actor.id],
      ...(kind === 'skill' && optionId ? { abilityId: optionId } : {}),
      ...(kind === 'item' && optionId ? { itemId: optionId } : {}),
    };
    onCommand(command);
  };

  const toggleRoster = (id: string) => {
    if (readOnly || id === 'player') return;
    const next = selectedRoster.includes(id)
      ? selectedRoster.filter(item => item !== id)
      : selectedRoster.length < 4 ? [...selectedRoster, id] : selectedRoster;
    setSelectedRoster(next);
  };

  const chooseUnit = (unit: CombatUnitCardModel) => {
    if (unit.side === 'enemy') setEnemyFocusId(unit.id);
    else setAllyFocusId(unit.id);
    if (preparing && unit.side === 'ally') {
      toggleRoster(unit.id);
      return;
    }
    if (session.lifecycle === 'active' && isManualTurn && targetIds.has(unit.id)) setSelectedTarget(unit.id);
  };

  const recentActions = session.actionSequence.filter(action => action.resolved).slice(-8).reverse();

  const optionCard = ({ key, kind, title, meta, chips, selected, reason, onClick }: { key: string; kind: CombatActionKind; title: string; meta: string; chips: { label: string; tone?: string }[]; selected: boolean; reason: string; onClick: () => void }) => (
    <button key={key} type="button" className={`cb-option is-${kind}${selected ? ' is-selected' : ''}${reason ? ' is-disabled' : ''}`} onClick={onClick} disabled={Boolean(reason)} title={reason || undefined}>
      <span className="cb-option__glyph"><CommandGlyph kind={kind} /></span>
      <span className="cb-option__copy"><strong>{title}</strong><small>{reason || meta}</small></span>
      {chips.length > 0 && <span className="cb-option__chips">{chips.map(chip => <em key={chip.label} className={chip.tone ? `is-${chip.tone}` : ''}>{chip.label}</em>)}</span>}
    </button>
  );

  const renderActionOptions = () => {
    if (actionMode === 'skill') {
      if (!abilities.length) return <p className="cb-deck__empty">当前单位没有可用主动技能。</p>;
      return abilities.map(ability => {
        const state = abilityState(ability);
        const reason = actionDisabledReason('skill', ability.id);
        const preview = actor ? previewCombatAbilityV2({ ...session, statLabels }, actor.id, ability.id, effectiveTarget || undefined) : undefined;
        const chips: { label: string; tone?: string }[] = [];
        if (preview?.damage !== undefined) chips.push({ label: `${preview.targetCount > 1 ? '每目标 ' : ''}伤害 ${preview.damage}${preview.criticalDamage === undefined ? '' : `/${preview.criticalDamage}`}`, tone: 'dmg' });
        if (preview?.healing !== undefined) chips.push({ label: `治疗 ${preview.healing}`, tone: 'heal' });
        if (preview?.hitChance !== undefined) chips.push({ label: `命中 ${Math.round(preview.hitChance * 100)}%` });
        for (const cost of state.costs) chips.push({ label: `${cost.label} ${cost.amount}`, tone: 'cost' });
        const cooldownRounds = ability.mechanics?.cooldownRounds ?? ability.mechanics?.combatAction?.cooldownRounds ?? 0;
        if (state.cooldown > 0) chips.push({ label: `冷却 ${state.cooldown}`, tone: 'cd' });
        else if (cooldownRounds) chips.push({ label: `CD ${cooldownRounds}` });
        return optionCard({ key: ability.id, kind: 'skill', title: ability.name, meta: ability.description || '主动能力', chips, selected: selectedAbility === ability.id, reason, onClick: () => { setSelectedAbility(ability.id); send('skill', ability.id); } });
      });
    }
    if (actionMode === 'item') {
      if (!items.length) return <p className="cb-deck__empty">当前单位没有可用于战斗的道具。</p>;
      return items.map(item => {
        const reason = actionDisabledReason('item', item.id);
        const purpose = item.definition?.narrativeOnly ? '叙事物品' : itemPurposeLabels[item.definition?.purpose ?? ''] ?? '叙事物品';
        return optionCard({ key: item.id, kind: 'item', title: item.definition?.name ?? item.id, meta: item.definition?.description ?? '未识别的战斗道具', chips: [{ label: purpose, tone: item.definition?.purpose === 'heal' ? 'heal' : item.definition?.purpose === 'damage' ? 'dmg' : undefined }, { label: `×${item.quantity}` }], selected: selectedItem === item.id, reason, onClick: () => { setSelectedItem(item.id); send('item', item.id); } });
      });
    }
    const title = actionMode === 'attack' ? '普通攻击' : actionMode === 'defend' ? '架势防御' : '尝试脱离';
    const target = actionMode === 'attack' ? session.participants.find(unit => unit.id === effectiveTarget)?.identity : undefined;
    return optionCard({ key: actionMode, kind: actionMode, title, meta: actionDescriptions[actionMode], chips: target ? [{ label: `目标 · ${target}` }] : [], selected: true, reason: actionDisabledReason(actionMode), onClick: () => send(actionMode) });
  };

  const turnBanner = session.lifecycle === 'active' && actor
    ? { key: `${session.round}:${actor.id}`, label: actor.side === 'enemy' ? `${actor.identity} 的回合` : actor.id === 'player' ? '你的回合' : `${actor.identity} 的回合`, side: actor.side === 'enemy' ? 'enemy' as const : 'ally' as const }
    : null;
  const allUnits = [...view.allyUnits, ...view.enemyUnits];
  const actorCard = allUnits.find(unit => unit.id === session.activeUnitId);

  const scene = useMemo(() => resolveBattleScene(world), [world]);

  return (
    <section
      ref={dialogRef}
      tabIndex={-1}
      className={`cb-root is-${session.lifecycle} is-scene-${scene}`}
      data-world-scene={worldSceneUrl ? 'artwork' : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="图形化战斗场"
    >
      <CombatHeader session={session} saving={saving} error={error} readOnly={readOnly} units={allUnits} scene={scene} onLeave={onLeave} />
      {view.emptyState && <div className="cb-root__empty" role="status">{view.emptyState}。请检查编队后再继续。</div>}
      <CombatBattlefield session={session} scene={scene} allyUnits={view.allyUnits} enemyUnits={view.enemyUnits} effectiveTarget={effectiveTarget} targetIds={targetIds} selectedRoster={selectedRoster} preparing={preparing} statLabels={statLabels} turnBanner={turnBanner} onChoose={chooseUnit} />
      {session.lifecycle === 'preparing' && <CombatFormation scene={scene} units={view.allyUnits} selectedRoster={selectedRoster} hasNoEnemies={view.hasNoEnemies} readOnly={readOnly} saving={saving} onToggleRoster={toggleRoster} onStart={onStart} />}
      {session.lifecycle === 'active' && <CombatCommandDeck scene={scene} session={session} actor={actorCard} actionMode={actionMode} actionDescription={actionDescriptions[actionMode]} autoStrategy={autoStrategy} readOnly={readOnly} manual={isManualTurn} statLabels={statLabels} actionOptions={renderActionOptions()} recentActions={recentActions} onSetAutoStrategy={onSetAutoStrategy} onSetActionMode={setActionMode} />}
      {session.lifecycle === 'terminal' && <CombatResult session={session} saving={saving} readOnly={readOnly} onContinueNarration={onContinueNarration} onRetry={onRetry} />}
    </section>
  );
}
