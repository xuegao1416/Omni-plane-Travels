/**
 * prompt.ts — 一个回合发给正文模型的请求怎么拼：系统提示词（前置区块 + 预设主体）、
 * 聊天历史与深度注入、预填充、工具通道、预设级模型参数。
 *
 * 只做纯拼装：所有输入由调用方（useGameEngine）读好传进来，这里不读 store、不发请求，
 * 因此可以脱离 React 单独测试，并与旧版逐段比对。
 */
import type { Message, RequestOptions } from '../../api/types';
import { buildSyntheticToolName, substituteToolName } from '../../api/syntheticTool';
import { PROMPT_INLINE_IMAGE, type PresetPack } from '../../data/builtinPresets';
import { DRC_FORMAT_REPAIR_PROMPT_ID } from '../../data/presetDrcV12';
import type { WorldDef } from '../../data/worlds-schema';
import type { GameState } from '../../schema/variables';
import type { PlayerProfile } from '../../storage/db';
import { ROLE_COGNITION_FIREWALL_CONTENT, ROLE_COGNITION_FIREWALL_TITLE } from '../../utils/roleCognitionFirewall';
import { GameplayHost } from '../../core/host';
import { createGameplayHost } from '../../core/registry';
import { MacroEngine } from '../macroEngine';
import type { FactMacroAccess } from '../../core/macroFacts';
import { assembleSystemPrompt, injectAtDepthEntries, type AssembleResult } from '../promptAssembler';

export interface WorldBookInjection {
  beforeChar?: string;
  afterChar?: string;
  atDepthEntries: Array<{ depth: number; content: string }>;
}

export interface MainPromptInput {
  preset: PresetPack;
  imageConfig: { inlineImageEnabled?: boolean; inlineImagePromptTemplate?: string };
  graphicalCombatEnabled: boolean;
  /** 战斗结束后的内部续写回合：不生成时间回执、不启用格式补尾。 */
  internalContinuation: boolean;
  userText: string;
  round: number;
  varSnapshot: string;
  worldBook?: WorldBookInjection;
  playerProfile?: PlayerProfile | null;
  characterHistory?: string;
  compiledMemoryContext: string;
  /** 剧情导演的未来意图（可能为空，导演失败也不影响下面的已结算事实）。 */
  directorBrief: string;
  /** 玩法宿主已经结算的结果与状态（formatSettledFacts）。 */
  settledFacts: string;
  playerDecisionContext: string;
  /** 本轮起始时间的文字（用于时间回执要求）；内部续写回合不需要。 */
  turnStartTimeText?: string;
  /** 已净化的聊天历史（不含本轮用户输入）。 */
  chatHistory: Message[];
  /** 预设宏可读的游戏变量（只读）。 */
  macroFacts?: FactMacroAccess;
}

export interface MainPromptResult {
  preset: PresetPack;
  systemPrompt: string;
  apiMessages: Message[];
  requestOptions: RequestOptions;
  useFormatRepairGuard: boolean;
  assembleResult: AssembleResult;
}

const PERSPECTIVE_INSTRUCTIONS: Record<string, string> = {
  '第一人称': '请用第二人称"你"来称呼玩家，描写玩家的内心感受和第一视角体验。',
  '第二人称': '请用第二人称"你"来称呼玩家。',
  '第三人称': '请用第三人称称呼玩家角色。',
};

export const GRAPHICAL_COMBAT_BOUNDARY = '\n\n【图形化战斗最高优先级边界】本世界已启用本地战斗模块。正文只允许写到敌人现身、伏击发生、攻击即将开始或双方进入对峙；到此必须立刻停止。严禁描写任何一次命中、闪避、格挡、反击、伤势、死亡、投降、胜负、奖励或成功逃脱，也不得用摘要跳过战斗。玩家随后会在独立战场完成机械结算，只有宿主再次提供 CombatResult 时，你才能依据该 JSON 一次性叙述完整战斗经过与结果。此规则高于预设中的篇幅、戏剧性和情节推进要求。';

export function timeAdvanceInstruction(turnStartTimeText: string): string {
  return `\n\n【权威时间裁决】本轮起始时间是“${turnStartTimeText}”。完成正文与行动选项后，必须在整条回复最后单独追加 <TimeAdvance>{"minutes":本轮从起始到正文末尾实际经过的非负整数分钟,"reason":"简短原因","evidence":"正文中的时间依据"}</TimeAdvance>。请自然判断已完成的用餐、睡眠、旅行、工作和天色变化：整段正文只给出从起始到末尾的唯一总推进；多个线索只是同一终点的相互佐证，不能重复累计。targetPhase/dayOffset 只能描述同一个最终时间终点，不得与 minutes 叠加；没有可靠证据时写 0。计划、对白、回忆中的未来或过去时间不推进；跨两天以上必须有明确天数、绝对日期或连续场景证据。不得省略回执；TimeAdvance 内不得增加绝对日期字段；不得把标签放进正文。`;
}

/** 玩家角色设定区块；没有姓名时返回空串。 */
export function buildPlayerProfileBlock(profile: PlayerProfile | null | undefined, characterHistory = ''): string {
  if (!profile?.name) return '';
  const perspectiveInstruction = PERSPECTIVE_INSTRUCTIONS[profile.perspective || '第三人称'] || PERSPECTIVE_INSTRUCTIONS['第三人称'];

  let customNpcsBlock = '';
  if (profile.customNpcs && profile.customNpcs.length > 0) {
    const npcLines = profile.customNpcs.map(npc => {
      const parts = [npc.name];
      if (npc.gender) parts.push(`${npc.gender}`);
      if (npc.age) parts.push(`${npc.age}岁`);
      if (npc.race) parts.push(npc.race);
      if (npc.relationshipType) parts.push(`关系：${npc.relationshipType}`);
      if (npc.personality) parts.push(`性格：${npc.personality}`);
      if (npc.appearance) parts.push(`外貌：${npc.appearance}`);
      if (npc.background) parts.push(`背景：${npc.background}`);
      return `- ${parts.join('，')}`;
    }).join('\n');
    customNpcsBlock = `
自建NPC（玩家的初始关联角色，必须在游戏中以该身份登场）：
${npcLines}
人物档案中已预置这些NPC的完整数据，请直接使用。`;
  }

  return `
<PlayerProfile>
玩家角色设定（最高优先级，必须严格遵守）：
- 姓名：${profile.name}
- 性别：${profile.gender || '未设定'}
- 年龄：${profile.age || '未设定'}
- 性格：${profile.personality || '未设定'}
- 外貌：${profile.appearance || '未设定'}
- 背景描述：${profile.background || '无'}
- 职业：${profile.career || '未设定'}
- 叙事视角：${profile.perspective || '第三人称'}
${characterHistory ? `- 角色经历：\n${characterHistory}` : ''}
${customNpcsBlock}
在故事开始时，玩家应以此身份登场。NPC 应以该角色的姓名和身份进行称呼和互动。
使用技能时，必须严格遵循技能描述中的效果，不要自行编造技能功能。
${perspectiveInstruction}
</PlayerProfile>
`;
}

/** 开启正文生图时补上生图指令条目（预设里已经有就不重复）。 */
export function withInlineImageEntry(preset: PresetPack, imageConfig: MainPromptInput['imageConfig']): PresetPack {
  if (!imageConfig.inlineImageEnabled) return preset;
  if (preset.prompts.some(prompt => prompt.identifier === 'inline_image_gen')) return preset;
  return {
    ...preset,
    prompts: [...preset.prompts, {
      identifier: 'inline_image_gen',
      name: '正文生图标签',
      role: 'system' as const,
      content: imageConfig.inlineImagePromptTemplate?.trim() || PROMPT_INLINE_IMAGE,
      enabled: true,
      order: 1250,
    }],
  };
}

/**
 * 玩法宿主给正文的上下文：已结算的结果（必须承认）、可带出的线索、各模块当前状态。
 * 与剧情导演无关：导演关闭或失败时照样注入。没有内容时返回空串，提示词里不会多出空块。
 */
export function formatSettledFacts(state: GameState, world: WorldDef | undefined): string {
  const blocks: string[] = [];
  const notes = GameplayHost.peekNotes(state);
  const facts = notes.filter(note => note.tone === 'fact').map(note => `- ${note.text}`);
  const hints = notes.filter(note => note.tone === 'hint').map(note => `- ${note.text}`);
  if (facts.length) blocks.push(['【玩法结算 — 已经发生的结果，正文必须承认，不要改动数值】', ...facts].join('\n'));
  if (hints.length) blocks.push(['【玩法线索 — 可以自然带出，不必逐条交代】', ...hints].join('\n'));
  try {
    const summaries = createGameplayHost(world, state).summarize(state, 'main');
    // 模块摘要有的自带“物资：”这类前缀，去掉重复的标签。
    const line = (item: { label: string; text: string }) => `- ${item.label}：${item.text.startsWith(`${item.label}：`) ? item.text.slice(item.label.length + 1) : item.text}`;
    if (summaries.length) blocks.push(['【玩法状态】', ...summaries.map(line)].join('\n'));
  } catch (error) {
    console.warn('[玩法] 模块摘要生成失败（已跳过）', error);
  }
  return blocks.join('\n\n');
}

/** 拼出本回合发给正文模型的完整请求。 */
export function composeMainPrompt(input: MainPromptInput): MainPromptResult {
  const preset = withInlineImageEntry(input.preset, input.imageConfig);
  const useFormatRepairGuard = !input.internalContinuation && (preset.id === 'deepseek'
    || (preset.id === 'drc_v12' && preset.prompts.some(prompt => prompt.identifier === DRC_FORMAT_REPAIR_PROMPT_ID && prompt.enabled)));

  let wbInjection = '';
  if (input.worldBook?.beforeChar) wbInjection += input.worldBook.beforeChar + '\n\n';
  if (input.worldBook?.afterChar) wbInjection += input.worldBook.afterChar + '\n\n';

  const macroEngine = new MacroEngine({ facts: input.macroFacts });
  const assembleResult = assembleSystemPrompt(preset, {
    varSnapshot: input.varSnapshot,
    wbInjection,
    playerProfileBlock: buildPlayerProfileBlock(input.playerProfile, input.characterHistory),
    firewallTitle: ROLE_COGNITION_FIREWALL_TITLE,
    firewallContent: ROLE_COGNITION_FIREWALL_CONTENT,
    userText: input.userText,
    round: input.round,
    macroEngine,
    compiledMemoryContext: input.compiledMemoryContext,
    directorBrief: input.directorBrief,
    settledFacts: input.settledFacts,
    playerDecisionContext: input.playerDecisionContext,
    userPersonaName: input.playerProfile?.name || '',
  });
  let systemPrompt = assembleResult.systemPrompt;

  // 正文生图：在系统提示末尾追加格式提醒（提高 Gemini 等模型的遵循率）
  if (input.imageConfig.inlineImageEnabled) {
    systemPrompt += '\n\n【提醒】在 <contenttext> 正文中插入 image###英文提示词### 生图标签（1-2个）。';
  }
  if (input.graphicalCombatEnabled) systemPrompt += GRAPHICAL_COMBAT_BOUNDARY;
  if (!input.internalContinuation && input.turnStartTimeText !== undefined) systemPrompt += timeAdvanceInstruction(input.turnStartTimeText);

  // 世界书 atDepth 条目走宏引擎（{{user}} 等已在组装时绑定），再与预设自带的深度条目合并。
  // depth 相对于本回合完整对话（含当前用户输入）：depth=0 就是生成前最后一条用户上下文。
  const resolvedWorldBookDepth = (input.worldBook?.atDepthEntries ?? []).map(entry => ({ depth: entry.depth, content: macroEngine.resolve(entry.content) }));
  const chatHistoryWithDepth = injectAtDepthEntries([
    ...input.chatHistory,
    { role: 'user' as const, content: input.userText },
  ], [...resolvedWorldBookDepth, ...(assembleResult.depthEntries || [])]);
  let apiMessages: Message[] = [{ role: 'system', content: systemPrompt }, ...chatHistoryWithDepth];
  // 尾部 assistant 预填充（SillyTavern 兼容：只有第三方预设带这种条目）
  if (assembleResult.assistantPrefill) apiMessages.push({ role: 'assistant', content: assembleResult.assistantPrefill });

  const requestOptions: RequestOptions = {};
  if (assembleResult.toolChannel) {
    const channel = assembleResult.toolChannel;
    const toolName = buildSyntheticToolName([], channel.toolNamePrefix);
    apiMessages = apiMessages.map(message => ({ ...message, content: substituteToolName(message.content, toolName) }));
    requestOptions.syntheticTool = {
      name: toolName,
      paramName: channel.paramName,
      description: substituteToolName(channel.description, toolName),
      fieldDescription: substituteToolName(channel.fieldDescription, toolName),
      controlPrompt: channel.controlPrompt,
      relocateContext: channel.relocateContext,
      pipelineMessages: channel.pipelineMessages.map(message => ({ ...message, content: substituteToolName(message.content, toolName) })),
    };
  }
  // 预设级模型参数覆盖全局 ApiConfig（temperature/top_p/max_tokens）
  if (preset.temperature != null) requestOptions.temperature = preset.temperature;
  if (preset.top_p != null) requestOptions.topP = preset.top_p;
  if (preset.max_tokens != null) requestOptions.maxTokens = preset.max_tokens;

  return { preset, systemPrompt, apiMessages, requestOptions, useFormatRepairGuard, assembleResult };
}
