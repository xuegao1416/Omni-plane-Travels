import { VariableManager } from '../engine/variableManager';
import type { PlayerProfile, CustomNpc } from '../storage/db';
import type { WorldDef } from '../data/worlds-schema';
import { admitAuthoredNPCs } from '../engine/playerKnowledge';
import { applyStatModuleInitData } from '../gameplay/characterInitialization';
import type { StatModuleSchema } from '../modules/schema';
import { createDefaultSimulationRuntimeState } from '../modules/schema';
import { materializeNpcSurvivalStats, materializeNpcTierIndex } from '../utils/npcStats';
import { getTimeSystemFromWorld, ensureWorldClockOnGameState } from '../time/worldClock';
import { prepareGameplayState } from '../gameplay/statePreparation';
import { normalizeGameStateV3 } from '../gameplay/protocols';


export function createNewSessionManager(world: WorldDef | undefined): VariableManager {
  const manager = new VariableManager(undefined, undefined, getTimeSystemFromWorld(world));
  manager.initializeWorldAndNotebook();
  const state = manager.getState();
  ensureWorldClockOnGameState(state, world);
  const prepared = normalizeGameStateV3(prepareGameplayState(state, world?.modules, { mode: 'new' }).state);
  prepared.simulationRuntime = createDefaultSimulationRuntimeState();
  ensureWorldClockOnGameState(prepared, world);
  manager.setState(prepared);
  return manager;
}

export const setPlayerProfile = (variableManager: VariableManager, profile: PlayerProfile) => {
    const state = variableManager.getState();
    // 基础信息
    state.玩家.姓名 = profile.name;
    state.玩家.性别 = profile.gender;
    state.玩家.年龄 = profile.age;
    state.玩家.身份信息.背景信息 = profile.background;
    state.玩家.性格 = profile.personality || '';
    state.玩家.外貌 = profile.appearance || '';
    // 身份信息
    state.玩家.身份信息.职业 = profile.career || '';
    // 初始技能
    if (profile.initialSkills && Object.keys(profile.initialSkills).length > 0) {
      state.玩家.技能系统 = { ...state.玩家.技能系统, ...profile.initialSkills };
      if (state.玩家.能力系统) {
        for (const skillName of Object.keys(profile.initialSkills)) {
          state.玩家.能力系统.已掌握技能[skillName] ??= { 等级: 1, 使用次数: 0 };
        }
      }
    }
    // 初始物品（补全 InventoryItem 缺失字段）
    if (profile.initialItems && Object.keys(profile.initialItems).length > 0) {
      const filled: typeof state.玩家.物品栏 = {};
      for (const [k, v] of Object.entries(profile.initialItems)) {
        filled[k] = { ...v };
      }
      state.玩家.物品栏 = { ...state.玩家.物品栏, ...filled };
    }
    variableManager.setState(state);
    variableManager.initializeWorldAndNotebook();
};

export const applyModuleInitData = (variableManager: VariableManager, moduleInitData: Record<string, unknown>) => {
    if (!moduleInitData || Object.keys(moduleInitData).length === 0) return;

    const state = variableManager.getState();

    // 数值属性
    applyStatModuleInitData(state, moduleInitData['数值属性']);

    const progressionData = moduleInitData['成长体系'] as Record<string, unknown> | undefined;
    if (progressionData) {
      const tierIndex = Number(progressionData.currentTierIndex);
      const currentXP = Number(progressionData.currentXP);
      if (Number.isInteger(tierIndex) && tierIndex >= 0) state.玩家.当前段位索引 = tierIndex;
      if (Number.isFinite(currentXP) && currentXP >= 0) state.玩家.当前经验值 = currentXP;
    }

    variableManager.setState(state);
};

export const setInitialNPCs = (variableManager: VariableManager, npcs: CustomNpc[], world: WorldDef | undefined) => {
    const state = variableManager.getState();
    const worldDef = world;
    const statModule = worldDef?.modules?.find(module => module.moduleId === 'stat' && module.enabled);
    const statConfig = (statModule?.moduleConfig) as StatModuleSchema | undefined;
    const progressionModule = worldDef?.modules?.find(module => module.moduleId === 'progression' && module.enabled);
    const progressionConfig = (progressionModule?.moduleConfig) as Record<string, unknown> | undefined;
    const authoredIds: string[] = [];
    for (const npc of npcs) {
      const npcId = `NPC_${npc.name}`;
      authoredIds.push(npcId);
      const npcTierIndex = progressionModule
        ? materializeNpcTierIndex(npc.tierIndex, progressionConfig?.currentTierIndex as number | undefined)
        : undefined;
      state.人物档案[npcId] = {
        姓名: npc.name,
        种族: npc.race || '人类',
        性别: npc.gender || '',
        年龄: npc.age || '',
        背景: npc.background || '',
        生存状态: materializeNpcSurvivalStats(npc.survivalStats, statConfig),
        社会身份: {
          职业: npc.occupation || '',
          社会地位: npc.socialStatus || '',
        },
        关系数据: {
          好感度: 0,
          关系类型: npc.relationshipType || '同伴',
        },
        个人信息: {
          外貌: npc.appearance || '',
          表性格: npc.personality || '',
          里性格: npc.hiddenPersonality || '',
          当前想法: npc.currentThought || '',
          当前穿着: npc.currentOutfit || '',
          当前位置: npc.currentLocation || '',
          当前状态: npc.currentState || '',
          备注: '',
        },
        重要NPC: true,
        _关注: true,
        $time: Date.now(),
        人物分类: '在场',
        当前行动: npc.currentAction || '',
        短期目标: npc.shortTermGoal || '',
        长期目标: npc.longTermGoal || '',
        人物事迹: npc.chronicles || [],
        技能列表: npc.skillsList || {},
        物品列表: npc.itemsList || {},
        ...(npcTierIndex !== undefined ? { 成长状态: { 当前段位索引: npcTierIndex, 当前经验值: 0 } } : {}),
      };
    }
    // 开局自建角色由玩家自己填写，直接登记为玩家已知，否则人物/任务面板看不到他们。
    // admitAuthoredNPCs 返回新的 state（playerKnowledge 是新建对象），必须用返回值回写。
    const admittedState = admitAuthoredNPCs(state, authoredIds, {
      turnId: 'character-creation',
      eventId: 'character-creation',
      quote: '玩家在开局创建的角色',
    });
    variableManager.setState(admittedState);
    // 更新全局初始快照（此时包含玩家数据和NPC，NPC事迹为空）

};
