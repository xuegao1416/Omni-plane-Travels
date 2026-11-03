import { v4 as uuid } from 'uuid';
import type { GameSave, PlayerProfile } from '../storage/db';
import type { WorldDef } from '../data/worldLoader';
import type { DirectorDefinition } from '../director/definitionTypes';
import type { ProfessionModuleSchema } from '../modules/schema';
import type { VariableManager } from '../engine/variableManager';
import { createNewSessionManager, setPlayerProfile, setInitialNPCs, applyModuleInitData } from '../engine/sessionInitialization';
import { DirectorRuntime } from '../simulation/engine';
import { bindDirectorDefinition } from '../director/sourceAdapter';
import { ensureDirectorState } from '../director/runtime';
import { resolveDirectorInitialIdentity, enforcePlayerIdentity } from '../director/initialIdentity';
import { initializeProfessionSelection, validateProfessionSelection } from '../gameplay/profession';
import { isProfessionModuleEnabled } from '../gameplay/profession/featureGate';
import { computeCreationSpending, isDivineTalent, resolveWorldPointScale } from '../gameplay/creation/creationPoints';
import { normalizeGameStateV3 } from '../gameplay/protocols';

export interface JourneyCreationInput { worldId: string; world?: WorldDef; profile: PlayerProfile; characterHistory: string; memoryConfig: unknown; variableConfig?: GameSave['variableConfig']; }
export interface JourneyCreationPorts {
  chooseName(defaultName: string): Promise<string | null>;
  getDefinition(id: string, version: string): Promise<DirectorDefinition | undefined>;
  resolveProfession(config: unknown): ProfessionModuleSchema | undefined;
  runModules(manager: VariableManager, worldId: string, signal?: AbortSignal): Promise<{ warnings: string[] }>;
  persist(save: GameSave): Promise<void>;
  activate(save: GameSave): void;
}
const EMPTY_PROFESSIONS: ProfessionModuleSchema = { professions: [], innateTalents: [], creationTalentBudget: 0, allowNoProfession: true };
export type CreationResult = { status: 'busy' | 'cancelled' } | { status: 'created'; save: GameSave; activated: boolean; warnings: string[] };

/** Preparation owns only detached objects; durable creation precedes replacing the active journey. */
export class CreateJourney {
  private pending = false;
  private prepared: { key: string; save: GameSave; warnings: string[] } | null = null;
  constructor(private readonly ports: JourneyCreationPorts) {}
  async start(input: JourneyCreationInput, signal?: AbortSignal): Promise<CreationResult> {
    if (this.pending) return { status: 'busy' };
    this.pending = true;
    try {
      const draft = structuredClone(input);
      const pi = draft.profile, world = draft.world;
      if (!pi.name.trim() || !pi.gender.trim() || !pi.age.trim()) throw Error('请填写姓名、性别和年龄后启程。');
      if (world ? world.id !== draft.worldId : draft.worldId !== 'default') throw Error('所选世界已变化，请重新选择世界。');
      const professionModule = isProfessionModuleEnabled(world) ? world?.modules?.find(module => module.moduleId === 'profession' && module.enabled) : undefined;
      const resolved = professionModule ? this.ports.resolveProfession(professionModule.moduleConfig) : undefined;
      const professions = resolved?.professions.length ? structuredClone(resolved) : undefined;
      const key = JSON.stringify({ draft, professions });
      if (professions && !validateProfessionSelection(professions, pi.professionId ?? null, pi.innateTalentIds ?? [], Number.MAX_SAFE_INTEGER).ok) throw Error('职业或天赋选择无效，请返回检查。');
      if (professions || world?.modules?.some(module => module.moduleId === 'stat' && module.enabled)) {
        const spending = computeCreationSpending(professions ?? EMPTY_PROFESSIONS, {
          riskMode: pi.combatRiskMode ?? 'normal', pointScale: resolveWorldPointScale(world), talentIds: pi.innateTalentIds ?? [],
          drawnTalentIds: pi.creationDrawnTalentIds ?? [], drawCount: pi.creationDrawCount ?? 0, allocations: pi.creationPointAllocations ?? {},
        });
        if (!spending.ok) throw Error(spending.reason);
      }
      signal?.throwIfAborted();
      const defaultName = `${pi.name} - ${world?.name ?? '自由世界'}`;
      const name = await this.ports.chooseName(defaultName);
      signal?.throwIfAborted();
      if (name === null) return { status: 'cancelled' };
      if (this.prepared?.key !== key) {
        this.prepared = null;
        let definition: DirectorDefinition | undefined;
        if (world?.directorSource) {
          const storedDefinition = await this.ports.getDefinition(world.directorSource.definitionId, world.directorSource.version);
          signal?.throwIfAborted();
          definition = storedDefinition ? structuredClone(storedDefinition) : undefined;
          if (!definition) throw Error('主线剧情版本缺失，请先导入对应剧情资料');
          if (!definition.stages.some(stage => stage.id === world.directorSource!.startStageId)) throw Error('所选主线开局阶段不存在，请重新选择');
          const identity = resolveDirectorInitialIdentity(definition, pi.directorRole, Object.fromEntries(pi.customNpcs.map(npc => [npc.id, { 姓名: npc.name }])));
          if (identity.playerName && pi.name !== identity.playerName) throw Error(`当前扮演原角色「${identity.playerName}」，请保持原角色姓名或切回自创角色`);
          pi.customNpcs = pi.customNpcs.filter(npc => !identity.excludedNpcIds.includes(npc.id));
        }
        const id = `save_${Date.now()}_${uuid().replaceAll('-', '')}`;
        const manager = createNewSessionManager(world);
        setPlayerProfile(manager, professions ? { ...pi, initialSkills: {} } : pi);
        if (professions) {
          const chosen = new Set(pi.innateTalentIds ?? []);
          const budget = professions.innateTalents.reduce((sum, talent) => sum + (chosen.has(talent.id) && !isDivineTalent(talent) ? Math.max(0, Math.trunc(talent.cost)) : 0), 0);
          manager.setState(initializeProfessionSelection(manager.getState(), professions, pi.professionId ?? null, pi.innateTalentIds ?? [], { talentBudgetOverride: budget }));
        }
        if (pi.moduleInitData) applyModuleInitData(manager, pi.moduleInitData);
        const state = normalizeGameStateV3(manager.getState());
        state.v3!.featureFlags = { ...state.v3!.featureFlags, professionsEnabled: Boolean(professions), combatEnabled: Boolean(world?.modules?.some(module => module.moduleId === 'combat' && module.enabled)), combatRiskMode: pi.combatRiskMode ?? 'normal' };
        manager.setState(state); setInitialNPCs(manager, pi.customNpcs, world);
        const director = new DirectorRuntime();
        if (definition) {
          const state = manager.getState(), selection = pi.directorRole;
          const identity = resolveDirectorInitialIdentity(definition, selection, state.人物档案);
          if (selection?.mode === 'original') {
            const actor = definition.characters.find(character => character.id === selection.actorId)!;
            state.playerIdentity = { actorId: actor.id, name: actor.name, aliases: [...actor.aliases] };
            enforcePlayerIdentity(state); manager.setState(state);
          }
          bindDirectorDefinition(ensureDirectorState(director.state), definition, { startStageId: selection?.startStageId ?? world?.directorSource?.startStageId, roleBinding: identity.roleBinding });
        }
        const result = await this.ports.runModules(manager, draft.worldId, signal);
        signal?.throwIfAborted();
        const snapshot = manager.createSnapshot();
        const directorSnapshot = director.createSnapshot(0, manager.getState().世界.时间系统.当前时间, true, '开局', [], { persist: false });
        const now = Date.now();
        const messages: GameSave['messages'] = draft.characterHistory.trim() ? [{ id: uuid(), role: 'assistant', rawText: draft.characterHistory, round: 0, seq: 0, timestamp: now,
          snapshot, snapshotTime: now, simulationSnapshotId: directorSnapshot.id }] : [];
        const bundle = manager.createModulePersistenceBundle(id);
        this.prepared = { key, warnings: [...result.warnings], save: {
          id, name: name.trim() || defaultName, timestamp: now, worldId: draft.worldId, personalInfo: pi, characterHistory: draft.characterHistory,
          messages, gameState: bundle.coreState, moduleStates: bundle.current, moduleCheckpoints: bundle.checkpoints,
          memoryRuntime: null, memoryConfig: draft.memoryConfig, vectorMemory: [],
          variableConfig: draft.variableConfig,
          customWorld: world ? structuredClone(world) as unknown as Record<string, unknown> : undefined,
          simulationState: structuredClone(director.state), lifecycle: 'active',
        } };
      }
      const prepared = this.prepared;
      const save = structuredClone({ ...prepared.save, name: name.trim() || defaultName });
      signal?.throwIfAborted();
      await this.ports.persist(save);
      this.prepared = null;
      const activated = !signal?.aborted;
      if (activated) {
        try { this.ports.activate(save); }
        catch (error) { throw Error(`旅程已完整保存，但进入游戏失败：${error instanceof Error ? error.message : String(error)}。请从存档列表读取该旅程。`); }
      }
      return { status: 'created', save, activated, warnings: prepared.warnings };
    } finally { this.pending = false; }
  }
}
