import type { VariableManager } from './variableManager';
import type { WorldBookManager } from '../worldbook/index';
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { ParsedResponse } from './responseExtractor';
import type { ApiConfig } from '../api/types';
import { callAuxiliaryApi, extractVariableRules } from '../api/auxiliaryApi';
import { eventBus, EVENTS } from './eventBus';
import { buildVariableExtractionPrompt } from '../utils/prompts';
import { findWorldDef } from '../data/worldLoader';
import { loadPresets } from '../components/settings/apiPresetUtils';
import { STORAGE_KEYS } from '../config/storageKeys';
import { buildModuleContextProjection, projectProfessionModuleConfig } from '../gameplay/moduleRuntime/contextRouter';
import { normalizeAbilityProposal, normalizeCombatEncounterRequest, type AbilityProposal, type CombatEncounterRequest } from '../gameplay/protocols';
import { stageAbilityProposalOnGameState } from '../gameplay/abilitySystem';
import { detectCombatOnset } from '../gameplay/combatNarrativeBoundary';
import { isCombatAllyNpc } from '../gameplay/combatV2';
import type { StatModuleSchema } from '../modules/schema';
import { ensureNpcModuleDefaults } from '../utils/npcStats';
import { getNpcCategoryValue } from '../utils/npcHelpers';

const COMBAT_ENCOUNTER_CONTRACT_PROMPT = `

【可选 CombatEncounterRequest 契约（仅 v3 战斗模块开启时可用）】
当正文已经把跨敌对阵营的实际攻击、伏击、围攻推进到“正在发生但尚未结算”，或玩家此刻仍在被追杀/追捕时，应在 GameplayTransaction 同层输出 combatEncounterRequest 元字段。正在持续的追杀本身就是敌对行为，不必等到第一次伤害出现；已经写明胜负、死亡、失去战斗能力、成功脱离的冲突必须省略，不能在正文杀死敌人后再触发第二场战斗。已知人物必须使用变量快照中的真实 ID；身份不明的袭击者使用 temporary=true 的本次遭遇单位：
{
  "combatEncounterRequest": {
    "type": "variable.hostile-action",
    "proposal": {
      "schemaVersion": 2, "id": "稳定遭遇ID", "context": "已发生的敌对语境",
      "threatBand": "weak|matched|dangerous|boss|overwhelming",
      "allies": [{"id":"...","identity":"...","temporary":false}],
      "enemies": [{"id":"...","identity":"...","temporary":false}],
      "neutrals": []
    },
    "hostileAction": {"occurred": true, "subjectId": "...", "targetId": "..."}
  }
}
combatEncounterRequest 只是触发元字段，不是 GameState 更新路径；不要把伤害、生命、护甲、奖励或其他机械数字写入其中。普通的“战斗/攻击”字样、计划、传闻、训练、盟友互殴、中立行为和未实际发生的动作都不得输出。若无法证明冲突此刻正在发生，完全省略该字段。
新物品如确有战斗用途，只可在物品数据内写入语义字段 {"战斗用途":{"类型":"heal|resource|damage|cleanse|buff","目标":"self|ally|enemy"}}；绝不写伤害、治疗量、倍率或冷却，本地配平器会生成机械数字。`;

const ABILITY_PROPOSAL_CONTRACT_PROMPT = `

【可选 AbilityProposal 契约（仅职业/能力模块开启时可用）】
只有正文已经明确完成学习、训练、觉醒、获得宠物或完成召唤时，才可在 GameplayTransaction 同层输出 abilityProposals 数组。提案只描述语义，不能直接写入已掌握技能：
{"abilityProposals":[{"schemaVersion":2,"id":"稳定英文ID","name":"能力名","description":"叙事用途与限制","category":"free_skill|dynamic|pet|summon","rarity":"普通|精良|稀有|史诗|传说","target":"self|ally|enemy|area|none","tags":["语义标签"]}]}
禁止输出伤害、治疗、消耗、冷却、倍率、状态回合或任何机械数字。玩家确认后，本地配平器才会生成能力定义；若正文只是提议、计划或尚未学会，完全省略该字段。每轮最多提出 3 项。`;

function hasEnabledCombatModule(worldDef: WorldDef | undefined, state: GameState): boolean {
  return state.v3?.featureFlags?.combatEnabled === true
    && worldDef?.modules?.some(module => typeof module === 'string'
      ? module === 'combat'
      : module.moduleId === 'combat' && module.enabled) === true;
}

function hasEnabledAbilityModule(state: GameState): boolean {
  return state.v3?.featureFlags?.professionsEnabled === true;
}

function stripCombatEncounterMetadata(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  const sanitized = { ...raw };
  delete sanitized.combatEncounterRequest;
  delete sanitized.abilityProposal;
  delete sanitized.abilityProposals;
  const combat = sanitized.combat;
  if (combat && typeof combat === 'object' && !Array.isArray(combat)) {
    const sanitizedCombat = { ...(combat as Record<string, unknown>) };
    delete sanitizedCombat.encounterRequest;
    if (Object.keys(sanitizedCombat).length > 0) sanitized.combat = sanitizedCombat;
    else delete sanitized.combat;
  }
  return sanitized;
}

/** A finished narrative outcome is authoritative and must not open a second mechanical fight. */
export function hasResolvedCombatOutcome(aiText: string): boolean {
  const narrative = aiText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!narrative) return false;
  return /(战斗|交锋|冲突|危机).{0,10}(?:结束|告终|解除|落幕|胜负已定)|(?:敌人|对手|袭击者|追杀者|守卫|士兵|怪物|他|她|其).{0,20}(?:被(?:你|玩家)?.{0,8})?(?:杀死|击杀|击毙|斩杀|处决|毙命|身亡|死亡|断气|咽气|倒地不起|失去战斗能力)|(?:你|玩家).{0,16}(?:杀死|击杀|击毙|斩杀|处决).{0,16}(?:敌人|对手|袭击者|追杀者|守卫|士兵|怪物|他|她|其)|(?:已经|成功|终于).{0,10}(?:甩脱|摆脱|逃脱|脱离)|追兵.{0,10}(?:退去|离开)|敌方.{0,10}(?:投降|溃败|撤退)/.test(narrative);
}
function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 精简 GameState 用于变量提取 API 调用
 * 移除非必要字段（memoryRuntime、portraitUrl 等），减少序列化体积
 */
export function createVariableExtractionSnapshot(state: GameState, narrativeText = ''): GameState {
  const snapshot = { ...state };

  // 移除记忆系统运行态和配置（体积大，变量提取不需要）
  delete (snapshot as any).memoryRuntime;
  delete (snapshot as any).memoryConfig;

  // 精简 NPC 数据
  if (snapshot.人物档案) {
    const cleanedNpcs: Record<string, unknown> = {};
    for (const [id, npc] of Object.entries(snapshot.人物档案)) {
      const name = String(npc.姓名 ?? '').trim();
      const mentioned = narrativeText.includes(id) || (name.length > 0 && narrativeText.includes(name));
      if (getNpcCategoryValue(npc) === '离场' && !mentioned) continue;
      const personal = npc.个人信息 ?? {} as GameState['人物档案'][string]['个人信息'];
      const cleaned = Object.fromEntries(Object.entries({
        姓名: npc.姓名,
        种族: npc.种族,
        性别: npc.性别,
        年龄: npc.年龄,
        人物分类: npc.人物分类,
        生存状态: npc.生存状态,
        战斗状态: npc.战斗状态,
        社会身份: npc.社会身份,
        关系数据: npc.关系数据,
        个人信息: Object.fromEntries(Object.entries({
          外貌: personal.外貌,
          表性格: personal.表性格,
          里性格: personal.里性格,
          当前想法: personal.当前想法,
          当前穿着: personal.当前穿着,
          当前位置: personal.当前位置,
          当前状态: personal.当前状态,
        }).filter(([, value]) => value !== undefined)),
        重要NPC: npc.重要NPC,
        当前行动: npc.当前行动,
        短期目标: npc.短期目标,
        长期目标: npc.长期目标,
        人物事迹: Array.isArray(npc.人物事迹) ? npc.人物事迹.slice(-5) : [],
        成长状态: npc.成长状态,
      }).filter(([, value]) => value !== undefined));
      cleanedNpcs[id] = cleaned;
    }
    snapshot.人物档案 = cleanedNpcs as any;
  }

  return snapshot;
}

async function callAuxiliaryApiForEngine(
  config: ApiConfig,
  worldBook: WorldBookManager | null,
  gameState: GameState,
  userMessage: string,
  aiContentText: string,
  worldId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const worldDef = findWorldDef(worldId);
  const moduleProjection = buildModuleContextProjection({
    state: gameState,
    worldDef,
    userText: userMessage,
    aiText: aiContentText,
    target: 'extraction',
  });
  const variableSnapshot = JSON.stringify(createVariableExtractionSnapshot(
    moduleProjection.state,
    `${userMessage}\n${aiContentText}`,
  ));

  let worldBookRules = '';
  if (worldBook) {
    worldBookRules = extractVariableRules(worldBook.entries);
  }

  const messages: { role: string; content: string }[] = [
    { role: 'user', content: `[当前变量快照]: ${variableSnapshot}` },
  ];
  if (moduleProjection.summary) {
    messages.push({ role: 'user', content: `[模块概览]: ${moduleProjection.summary}` });
  }
  if (moduleProjection.professionDetail) {
    messages.push({ role: 'user', content: `[当前职业上下文]:\n${moduleProjection.professionDetail}` });
  }
  if (worldBookRules) {
    messages.push({ role: 'user', content: worldBookRules });
  }

  if (userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }
  messages.push({ role: 'assistant', content: aiContentText });

  // 获取成长体系配置（从世界定义读取，不存入 GameState）
  const relevant = new Set(moduleProjection.relevantModuleIds);
  const progressionConfig = relevant.has('progression')
    ? worldDef?.modules?.find(m => m.moduleId === 'progression' && m.enabled)?.moduleConfig
    : undefined;

  // 从世界定义的模块 moduleConfig 构建世界系统数据（用于生成模块更新规则）
  const worldSystemFromDef: Record<string, unknown> = {};
  if (worldDef?.modules) {
    const keyMap: Record<string, [string, string]> = {
      stat: ['数值属性', 'stat'],
      survival: ['生存资源', 'survival'],
      business: ['经营资产', 'business'],
      dice: ['骰子检定', 'dice'],
      talent: ['天赋体系', 'profession'],
      profession: ['职业体系', 'profession'],
    };
    for (const mod of worldDef.modules) {
      const mapped = keyMap[mod.moduleId];
      if (mod.enabled && mapped && (mod.moduleId === 'stat' || relevant.has(mapped[1] as any)) && (mod.moduleConfig || mod.data)) {
        worldSystemFromDef[mapped[0]] = mod.moduleId === 'profession'
          ? projectProfessionModuleConfig(gameState, worldDef, `${userMessage}\n${aiContentText}`)
          : (mod.moduleConfig || mod.data);
      }
    }
  }

  const variableUpdatePrompt = `${buildVariableExtractionPrompt(worldSystemFromDef, progressionConfig as Record<string, unknown>)}${
    hasEnabledCombatModule(worldDef, gameState) ? COMBAT_ENCOUNTER_CONTRACT_PROMPT : ''
  }${hasEnabledAbilityModule(gameState) ? ABILITY_PROPOSAL_CONTRACT_PROMPT : ''}`;

  return callAuxiliaryApi(config, messages, variableUpdatePrompt, signal);
}

export async function runVariableExtraction(params: {
  varMgr: VariableManager;
  parsed: ParsedResponse;
  round: number;
  userText: string;
  mainApiConfig: ApiConfig;
  worldBook: WorldBookManager | null;
  worldId: string;
  delayMs: number;
  maxRetries: number;
  signal?: AbortSignal;
}): Promise<void> {
  const { varMgr, parsed, round, userText, mainApiConfig, worldBook, worldId, delayMs, maxRetries, signal } = params;

  if (!parsed.content.trim()) {
    const error = new Error('正文内容为空，无法执行变量提取');
    eventBus.emit(EVENTS.VARIABLE_EXTRACTION_FAILED, error.message);
    throw error;
  }

  // 选择 API 配置：优先变量提取专用预设 > 主API
  let effectiveConfig: ApiConfig = mainApiConfig;
  try {
    const varPresetId = localStorage.getItem(STORAGE_KEYS.VARIABLE_API_PRESET);
    if (varPresetId) {
      const presets = loadPresets();
      const preset = presets.find(p => p.id === varPresetId);
      if (preset) {
        effectiveConfig = { ...preset.config };
      }
    }
  } catch { /* localStorage 不可用时 fallback */ }

  // 等待可配置的延迟（管线执行器已保证记忆任务先于此阶段完成）
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (signal?.aborted) {
        throw new DOMException('变量提取已中止', 'AbortError');
      }

      // 始终通过独立 API 调用提取变量（正文和变量完全分离）
      const updateText = await callAuxiliaryApiForEngine(
        effectiveConfig,
        worldBook,
        varMgr.createSafeSnapshotForPrompt(),
        userText,
        parsed.content,
        worldId,
        signal,
      );

      // AI 返回 null/空字符串/仅空白：视为无需更新，不是错误
      if (!updateText || !updateText.trim()) {
        console.log('[变量提取] AI 未返回有效更新内容，跳过变量更新');
        eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
        return;
      }

      if (updateText) {
        // callAuxiliaryApi 已负责从 <UpdateVariable> 标签或裸 JSON 中提取内容
        // 这里做一层兜底：如果返回的还带标签，再剥一次
        let jsonContent = updateText;
        const tagMatch = updateText.match(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/i);
        if (tagMatch) {
          jsonContent = tagMatch[1].trim();
        }

        const parsedUpdate = (() => { try { return JSON.parse(jsonContent) as unknown; } catch { return undefined; } })();
        const narrativeResolved = hasResolvedCombatOutcome(parsed.content);
        const structuredEncounter = narrativeResolved ? undefined : extractStructuredCombatEncounterRequest(parsedUpdate);
        const localEncounter = structuredEncounter ? undefined : (
          hasEnabledCombatModule(findWorldDef(worldId), varMgr.getState())
            ? inferImmediateCombatEncounterRequest(userText, parsed.content, varMgr.getState(), round)
            : undefined
        );
        const encounter = structuredEncounter ?? localEncounter;
        const abilityProposals = extractStructuredAbilityProposals(parsedUpdate);
        const gameplayUpdate = stripCombatEncounterMetadata(parsedUpdate);
        const gameplayJson = gameplayUpdate === undefined ? jsonContent : JSON.stringify(gameplayUpdate);
        const applied = varMgr.applyAiUpdateVariable(gameplayJson);
        if (applied) {
          const activeWorld = findWorldDef(worldId);
          const statModule = activeWorld?.modules?.find(module => module.moduleId === 'stat' && module.enabled);
          const progressionModule = activeWorld?.modules?.find(module => module.moduleId === 'progression' && module.enabled);
          const statConfig = (statModule?.moduleConfig ?? statModule?.data) as StatModuleSchema | undefined;
          const progressionConfig = (progressionModule?.moduleConfig ?? progressionModule?.data) as Record<string, unknown> | undefined;
          if (statConfig || progressionModule) {
            const stateWithDefaults = structuredClone(varMgr.getState());
            const tierFallback = progressionModule
              ? Number(progressionConfig?.currentTierIndex ?? 0)
              : undefined;
            if (ensureNpcModuleDefaults(stateWithDefaults, statConfig, tierFallback)) {
              varMgr.setState(stateWithDefaults);
            }
          }
        }
        if (!applied && !encounter && abilityProposals.length === 0) {
          throw new Error(`变量更新内容无法应用：${jsonContent.slice(0, 120)}`);
        }
        if (abilityProposals.length > 0) {
          let proposalState = varMgr.getState();
          for (const proposal of abilityProposals) proposalState = stageAbilityProposalOnGameState(proposalState, proposal).state;
          varMgr.setState(proposalState);
        }
        if (encounter) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, encounter);
      }

      eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
      return;
    } catch (err: unknown) {
      lastError = err;
      console.warn(`[变量提取] 第 ${attempt + 1}/${maxRetries + 1} 次失败:`, (err as Error).message || err);
      if (attempt < maxRetries) {
        // 指数退避，避免瞬时网络抖动时连续重试都打在同一次故障上
        const waitMs = delayMs > 0 ? delayMs * Math.pow(2, attempt) : 0;
        await sleep(waitMs);
      }
    }
  }

  const finalError = lastError instanceof Error
    ? lastError
    : new Error('变量提取全部重试失败');
  // 战斗触发不应被变量 API 的空回或格式错误一起吞掉。这里仍只采用
  // 保守的本地即时冲突判定，变量阶段本身继续如实报告失败。
  if (hasEnabledCombatModule(findWorldDef(worldId), varMgr.getState())) {
    const fallbackEncounter = inferImmediateCombatEncounterRequest(userText, parsed.content, varMgr.getState(), round);
    if (fallbackEncounter) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, fallbackEncounter);
  }
  console.warn('[变量提取] 全部重试失败:', finalError.message);
  eventBus.emit(EVENTS.VARIABLE_EXTRACTION_FAILED, finalError.message);
  throw finalError;
}

/** Validate the model-provided hostile-action contract before it can enter v3 combat. */
export function extractStructuredCombatEncounterRequest(input: unknown): CombatEncounterRequest | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const candidate = raw.combatEncounterRequest ?? (
    raw.combat && typeof raw.combat === 'object' && !Array.isArray(raw.combat)
      ? (raw.combat as Record<string, unknown>).encounterRequest
      : undefined
  ) ?? (raw.type === 'variable.hostile-action' ? raw : undefined);
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const normalizedCandidate = { ...(candidate as Record<string, unknown>) };
  if (normalizedCandidate.source === 'variable-hostile-action' && !normalizedCandidate.type) normalizedCandidate.type = 'variable.hostile-action';
  const request = normalizeCombatEncounterRequest(normalizedCandidate);
  if (request?.source !== 'variable-hostile-action' || request.hostileAction?.occurred !== true) return undefined;
  const actors = new Map<string, 'ally' | 'enemy' | 'neutral'>([['player', 'ally']]);
  for (const actor of request.proposal.allies) actors.set(actor.id, 'ally');
  for (const actor of request.proposal.enemies) actors.set(actor.id, 'enemy');
  for (const actor of request.proposal.neutrals) actors.set(actor.id, 'neutral');
  const subjectSide = actors.get(request.hostileAction.subjectId);
  const targetSide = actors.get(request.hostileAction.targetId);
  const crossesOpposition = subjectSide && targetSide
    && subjectSide !== 'neutral'
    && targetSide !== 'neutral'
    && subjectSide !== targetSide;
  const lockedEnemyTarget = targetSide === 'enemy' && subjectSide !== 'enemy';
  if (!crossesOpposition && !lockedEnemyTarget) return undefined;
  return request;
}

/**
 * Conservative local safety net for low-cost auxiliary models. It recognizes
 * only an immediate physical conflict or an active pursuit and never turns a
 * plan, rumour, training scene, or already resolved escape into combat.
 */
export function inferImmediateCombatEncounterRequest(
  userText: string,
  aiText: string,
  state: GameState,
  round: number,
  options: { allowResolved?: boolean } = {},
): CombatEncounterRequest | undefined {
  const user = userText.replace(/<[^>]+>/g, ' ').trim();
  const narrative = aiText.replace(/<[^>]+>/g, ' ').trim();
  const combined = `${user}\n${narrative}`;
  if (!combined.trim()) return undefined;

  const speculativeOnly = /(听说|传闻|据说|可能|也许|计划|打算|准备在|明天|改日|将会|若是|如果|如何应对|练习|训练|演练|模拟)/.test(combined);
  const resolved = hasResolvedCombatOutcome(narrative) || /并未发生|没有发生/.test(combined);
  const { activePursuit, activeAssault, playerAssault, resolvedExchange } = detectCombatOnset(user, narrative);
  const hasImmediateConflict = activePursuit || activeAssault || playerAssault || (options.allowResolved === true && resolvedExchange);
  if ((!options.allowResolved && resolved) || !hasImmediateConflict || (speculativeOnly && !activePursuit && !playerAssault && !resolvedExchange)) return undefined;

  const knownEnemy = Object.entries(state.人物档案 ?? {}).find(([, npc]) => {
    const name = String(npc.姓名 || '').trim();
    if (!name || !combined.includes(name)) return false;
    const relation = String(npc.关系数据?.关系类型 || '');
    const favorability = Number(npc.关系数据?.好感度 ?? 0);
    return /敌|仇|对立|宿敌/.test(relation) || favorability < 0;
  });
  const identity = knownEnemy?.[1].姓名 || (/袭击者|埋伏者/.test(combined) ? '袭击者' : activePursuit ? '追杀者' : activeAssault ? '袭击者' : '敌对者');
  const enemyId = knownEnemy?.[0] || `temporary-hostile-${Math.max(0, Math.trunc(round))}`;
  const context = (narrative || user).replace(/\s+/g, ' ').slice(0, 180) || '敌对行动正在发生';
  const enemy = {
    id: enemyId,
    identity,
    temporary: !knownEnemy,
    source: knownEnemy ? 'npc' as const : 'temporary' as const,
  };
  const allies = Object.entries(state.人物档案 ?? {})
    .filter(([id, npc]) => id !== knownEnemy?.[0]
      && Boolean(String(npc.姓名 || '').trim())
      && combined.includes(String(npc.姓名).trim())
      && isCombatAllyNpc(npc)
      && Number(npc.生存状态?.血量 ?? 0) > 0)
    .slice(0, 3)
    .map(([id, npc]) => ({
      id,
      identity: npc.姓名 || id,
      temporary: false,
      source: 'npc' as const,
    }));
  return {
    schemaVersion: 2,
    source: 'variable-hostile-action',
    proposal: {
      schemaVersion: 2,
      id: `narrative-hostile-${Math.max(0, Math.trunc(round))}-${enemyId}`,
      context,
      threatBand: 'matched',
      allies,
      enemies: [enemy],
      neutrals: [],
    },
    hostileAction: {
      occurred: true,
      subjectId: playerAssault ? 'player' : enemyId,
      targetId: playerAssault ? enemyId : 'player',
    },
  };
}

/** Extract semantic-only abilities; any model-provided mechanical fields are discarded by normalization. */
export function extractStructuredAbilityProposals(input: unknown): AbilityProposal[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const raw = input as Record<string, unknown>;
  const candidates = Array.isArray(raw.abilityProposals)
    ? raw.abilityProposals
    : raw.abilityProposal
      ? [raw.abilityProposal]
      : [];
  const unique = new Map<string, AbilityProposal>();
  for (const candidate of candidates.slice(0, 3)) {
    const proposal = normalizeAbilityProposal(candidate);
    if (!proposal || proposal.category === 'combat_item' || proposal.category === 'innate_talent' || proposal.category === 'profession') continue;
    unique.set(proposal.id, proposal);
  }
  return [...unique.values()];
}
