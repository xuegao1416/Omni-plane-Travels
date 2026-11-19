import { useCallback,useEffect,useRef,useState } from 'react';
import { UISettingsProvider } from '../context/UISettingsContext';
import CombatWireframe from '../components/game/CombatWireframe';
import { createDefaultGameState,type GameState } from '../schema/variables';
import type { AbilityDefinition,CombatCommandInputV2,CombatEncounterProposal,CombatSessionV2 } from '../gameplay/protocols';
import {
  balanceCombatItemProposal,
  buildValidatedCombatRoster,
  chooseAutomaticCommand,
  createPreparingCombatSession,
  resolveCombatCommandV2,
  selectCombatants,
  startPreparedCombat,
  type CombatAutoStrategy,
} from '../gameplay/combatV2';

/**
 * Localhost-only combat harness (`?plshot=combat`). Runs the real local combat
 * core in memory: formation → turns (enemy turns auto-play) → result.
 * QA switches (all optional, combine freely):
 *   stage=active|terminal     jump to a phase
 *   result=victory|defeat|escaped|draw   force the terminal outcome (implies stage=terminal)
 *   narration=pending|succeeded|failed   settlement narration state on the result screen
 *   enemies=赤眼狼,荒庙怨灵,…  enemy names (1–4, one wave); names pick the figure (see ENEMY_RULES)
 *   allies=0..2               how many companions join the player
 *   hurt=1                    start with everyone at ~30% health (low-health styling)
 *   portrait=<url>            give the player an uploaded portrait
 *   auto=aggressive|balanced|defensive|support   start with auto-battle on
 *   world=&tags=&desc=        world hint for scene + costume selection
 */
const npc = (name: string, kind: string, hp: number, attr: number, gender = '') => ({
  姓名: name, 种族: '人类', 性别: gender, 年龄: 24,
  生存状态: { 血量: hp, 体力值: 60, dim1: attr, dim2: attr, dim3: attr },
  社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: kind === '敌对' ? -30 : 40, 关系类型: kind },
  个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' },
  重要NPC: true, _关注: true, $time: 1, 人物分类: '在场' as const,
});

const skill = (id: string, name: string, extra: Partial<NonNullable<AbilityDefinition['mechanics']>['combatAction']>, cost = 0): AbilityDefinition => ({
  schemaVersion: 2, id, name, description: '', category: 'profession', abilityType: 'active', rarity: '精良', maxRank: 1, pointCost: 0, prerequisites: [], tags: [],
  mechanics: { ...(cost ? { costs: [{ path: 'resource', amount: cost, label: '内力' }] } : {}), combatAction: { id, name, target: 'enemy', actionCost: 1, accuracy: 14, ...extra } },
});

const Q = new URLSearchParams(window.location.search);
const ENEMY_NAMES = (Q.get('enemies') ?? '黑风寨刀客,赤眼狼,荒庙怨灵').split(',').map(n => n.trim()).filter(Boolean).slice(0, 4);
const ALLY_COUNT = Math.max(0, Math.min(2, Number(Q.get('allies') ?? 2)));
const HURT = Q.get('hurt') === '1';

function makeState(): GameState {
  const state = createDefaultGameState();
  state.玩家.性别 = '女';
  state.玩家.生存状态 = { 血量: 100, 体力值: 100, dim1: 14, dim2: 12, dim3: 12, dim4: 10, dim5: 10, dim6: 10 };
  state.人物档案 = {
    lin: npc('林青砚', '友方', 80, 12, '男'),
    su: npc('苏挽', '友方', 60, 11, '女'),
    ...Object.fromEntries(ENEMY_NAMES.map((name, i) => [`e${i}`, npc(name, '敌对', 60 + (i % 3) * 15, 11 + (i % 3))])),
  };
  if (HURT) {
    // Current health below the configured cap; without 血量上限 the engine treats current health as the cap.
    const wound = (stats: Record<string, unknown>) => { stats.血量上限 = stats.血量; stats.血量 = Math.round(Number(stats.血量) * .25); };
    wound(state.玩家.生存状态 as Record<string, unknown>);
    for (const p of Object.values(state.人物档案)) wound(p.生存状态 as Record<string, unknown>);
  }
  const defs = [
    skill('cleave', '断水刀', { damage: 14, cooldownRounds: 2 }, 8),
    skill('sweep', '回风扫叶', { target: 'area', damage: 7, cooldownRounds: 3 }, 12),
    skill('mend', '清心诀', { target: 'ally', damage: undefined, healing: 18, cooldownRounds: 2 }, 10),
  ];
  state.v3 = {
    schemaVersion: 3,
    featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' },
    abilityDefinitions: Object.fromEntries(defs.map(def => [def.id, def])),
    abilityInstances: Object.fromEntries(defs.map(def => [def.id, { definitionId: def.id, source: 'profession' as const, acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } }])),
  };
  return state;
}

const proposal: CombatEncounterProposal = {
  schemaVersion: 2, id: 'preview-encounter', context: '荒庙夜袭 · 黑风寨截道', threatBand: 'dangerous',
  allies: [{ id: 'lin', identity: '林青砚', temporary: false }, { id: 'su', identity: '苏挽', temporary: false }].slice(0, ALLY_COUNT),
  enemies: ENEMY_NAMES.map((name, i) => ({ id: `e${i}`, identity: name, temporary: false })),
  neutrals: [],
};

function initialSession(): CombatSessionV2 {
  const state = makeState();
  const roster = buildValidatedCombatRoster(state, proposal);
  const potion = balanceCombatItemProposal({ schemaVersion: 2, id: 'potion', name: '金创药', description: '敷于伤处，止血回元', category: 'combat_item', rarity: '普通', target: 'self', tags: [], itemPurpose: 'heal' });
  return createPreparingCombatSession(state, roster.plan!, { seed: 9, now: 1, statLabels: { health: '气血', resource: '内力' }, itemDefinitions: { potion }, itemQuantities: { player: { potion: 2 } } });
}

function withResult(session: CombatSessionV2): CombatSessionV2 {
  let next = session;
  for (let guard = 0; guard < 200 && next.lifecycle === 'active'; guard++) {
    const actor = next.participants.find(unit => unit.id === next.activeUnitId);
    if (!actor) break;
    next = resolveCombatCommandV2(next, chooseAutomaticCommand(next, actor.id, 'aggressive')).session;
  }
  return next;
}

export default function CombatPreview() {
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('result') as 'victory' | 'defeat' | 'escaped' | 'draw' | null;
  const stage = forced ? 'terminal' : params.get('stage');
  const narration = (params.get('narration') ?? 'pending') as 'pending' | 'succeeded' | 'failed';
  const portrait = params.get('portrait');
  const autoParam = params.get('auto') as CombatAutoStrategy | null;
  // With only `tags`, leave the name empty so the default world name does not outvote the requested tags.
  const world = { name: params.get('world') ?? (params.get('tags') ? '' : '武侠世界'), tags: (params.get('tags') ?? '武侠,江湖').split(','), description: params.get('desc') ?? '' };
  const [session, setSession] = useState<CombatSessionV2>(() => {
    const base = initialSession();
    if (stage === 'active' || stage === 'terminal') {
      const started = startPreparedCombat(selectCombatants(base, ['player', 'lin', 'su'].slice(0, 1 + ALLY_COUNT)).session!);
      if (stage === 'terminal') {
        const done = withResult(started);
        if (!done.result) return done;
        const status = forced ?? done.result.status;
        return { ...done, result: { ...done.result, status, narration: { ...done.result.narration, status: narration, ...(narration === 'failed' ? { error: '叙事生成失败（预览模拟）' } : {}) } } };
      }
      return started;
    }
    return base;
  });
  const [auto, setAuto] = useState<CombatAutoStrategy | null>(autoParam);
  const timer = useRef<number | null>(null);

  const apply = useCallback((input: CombatCommandInputV2) => setSession(current => resolveCombatCommandV2(current, input).session), []);

  useEffect(() => {
    if (session.lifecycle !== 'active') return;
    const actor = session.participants.find(unit => unit.id === session.activeUnitId);
    if (!actor) return;
    const strategy = actor.side === 'enemy' ? 'balanced' : auto;
    if (!strategy) return;
    timer.current = window.setTimeout(() => apply(chooseAutomaticCommand(session, actor.id, strategy)), actor.side === 'enemy' ? 1100 : 900);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [session, auto, apply]);

  return (
    <UISettingsProvider>
      <CombatWireframe
        session={session}
        statLabels={{ health: '气血', resource: '内力' }}
        world={world}
        portraits={{ player: { gender: '女', ...(portrait ? { src: portrait } : {}) }, lin: { gender: '男' }, su: { gender: '女' } }}
        autoStrategy={auto}
        onCommand={apply}
        onStart={ids => { const selected = selectCombatants(session, ids); if (selected.session) setSession(startPreparedCombat(selected.session)); }}
        onSetAutoStrategy={setAuto}
        onRetry={() => { setAuto(null); setSession(initialSession()); }}
        onContinueNarration={() => setSession(current => current.result ? { ...current, result: { ...current.result, narration: { ...current.result.narration, status: 'pending' } } } : current)}
        onLeave={() => { setAuto(null); setSession(initialSession()); }}
      />
    </UISettingsProvider>
  );
}
