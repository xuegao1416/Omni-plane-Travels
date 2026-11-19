/**
 * 用 v2.8.4 的旧逻辑把 6 个交接初始档推进 8 回合，生成「线上玩家中期档」夹具。
 *
 * 只在重构开始前运行一次（基线 10b4eec）；输出冻结在 src/__tests__/fixtures/saves/midgame/，
 * 之后的重构必须能读出这些存档并得到 expectations.json 里记录的玩家可见数值。
 * 运行：node_modules/.bin/bun run scripts/fixtures/generateMidgameSaves.ts
 */
import '../test-localStorage-shim';
import 'fake-indexeddb/auto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeSaveFile, encodeSaveFile } from '../../src/storage/saveFileCodec';
import { importSaveFromFile, loadGame, deleteSave } from '../../src/storage/db';
import { restoreGameplayManager } from '../../src/engine/sessionRestore';
import { settleAcceptedTurn } from '../../src/engine/turnSettlement';
import type { PipelineResult } from '../../src/engine/pipelineExecutor';
import type { VariableManager } from '../../src/engine/variableManager';
import type { WorldDef } from '../../src/data/worlds-schema';
import type { GameState } from '../../src/schema/variables';
import type { DiceModuleSchema, StatModuleSchema, SurvivalModuleSchema } from '../../src/modules/schema';
import { gatherSurvivalResource } from '../../src/gameplay/modules/survival';
import { addStatModifier } from '../../src/gameplay/modules/stat';
import { createDiceRoll, recordDiceRoll } from '../../src/gameplay/modules/dice';
import { prepareWorldMechanics, commitWorldMechanics } from '../../src/gameplay/worldMechanics';
import { getSimulationEngine, resetSimulationEngine } from '../../src/simulation/SimulationApi';
import { summarizeCompatState } from '../../src/__tests__/helpers/compatSummary';

const FIXTURE_ROOT = join(import.meta.dir, '../../src/__tests__/fixtures/saves');
const HANDOFF = join(FIXTURE_ROOT, 'handoff');
const MIDGAME = join(FIXTURE_ROOT, 'midgame');

type Tx = Record<string, unknown>;
interface ScriptedTurn {
  user: string;
  narrative: string;
  minutes: number;
  ai?: Tx[];
  mechanics?: (state: GameState, world: WorldDef, round: number) => GameState;
}

function moduleConfig<T>(world: WorldDef, id: string): T | undefined {
  return world.modules?.find(module => module.moduleId === id && module.enabled)?.moduleConfig as T | undefined;
}

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6D2B79F5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function npc(name: string, job: string, affinity: number): Record<string, unknown> {
  return {
    姓名: name, 种族: '人类', 性别: '女', 年龄: 24,
    生存状态: { 血量: 100, 体力值: 100 },
    社会身份: { 职业: job, 社会地位: '普通' },
    关系数据: { 好感度: affinity, 关系类型: '熟人' },
    个人信息: { 外貌: '利落短发', 表性格: '爽快', 里性格: '谨慎', 当前想法: '观察对方', 当前穿着: '便装', 当前位置: '附近', 当前状态: '正常', 备注: '' },
    重要NPC: true, _关注: false, $time: 1,
  };
}

function commonTurns(world: WorldDef): ScriptedTurn[] {
  const companion = world.id === 'wuxia_world' ? '柳青禾' : world.id === 'border_trade' ? '娜塔莎' : '林晚';
  return [
    {
      user: '我先在附近走走，熟悉环境，打听消息。', narrative: '你沿着街巷走了一圈，记下了几处值得留意的地方。', minutes: 180,
      ai: [{ effects: [
        { set: { path: '世界.空间定位.当前位置', value: '镇口茶棚' } },
        { set: { path: '玩家.当前目标', value: '摸清当地的门路' } },
        { set: { path: `人物档案.${companion}`, value: npc(companion, '向导', 20) } },
      ] }],
    },
    {
      user: '我向她请教当地的规矩，顺便买点随身的东西。', narrative: '她爽快地讲了些规矩，你也在摊上挑了件趁手的物件。', minutes: 120,
      ai: [{ effects: [
        { set: { path: '玩家.物品栏.旧地图', value: { 数量: 1, 类型: '杂物', 品质: '普通', 备注: '标着几处补给点' } } },
        { add: { path: '玩家.货币资源.主货币.数量', delta: -40 } },
        { set: { path: '玩家.任务系统.活跃任务.寻找落脚处', value: {
          任务名: '寻找落脚处', 任务类型: '主线', 描述: '找一个能长期落脚的地方', 状态: '进行中', 优先级: '高', 目标: '找到住处', 进度: 0, $time: 2,
          奖励: { 经验值: 30 },
        } } },
      ] }],
    },
    {
      user: '我请她喝杯茶，聊聊她自己的事。', narrative: '几句闲谈之后，她对你放下了些戒心。', minutes: 90,
      ai: [{ effects: [
        { add: { path: `人物档案.${companion}.关系数据.好感度`, delta: 12 } },
        { set: { path: '玩家.纪事系统.纪事.茶棚闲谈', value: { 标题: '茶棚闲谈', 类型: '关系', 描述: `${companion} 提到附近有一处空置的屋子`, 状态: '活跃', $time: 3 } } },
      ] }],
    },
    {
      user: '我去她说的那处空屋看看，进行训练，活动一下筋骨。', narrative: '屋子虽旧，打扫一番也能住。你在院里练了一阵，出了一身汗。', minutes: 240,
      ai: [{ effects: [
        { set: { path: '世界.空间定位.当前位置', value: '城西旧屋' } },
        { add: { path: '玩家.任务系统.活跃任务.寻找落脚处.进度', delta: 60 } },
      ] }],
    },
    {
      user: '天黑了，我在屋里歇下，整理今天的收获。', narrative: '夜里很安静，你把今天的见闻一一记下。', minutes: 480,
      ai: [{ effects: [
        { set: { path: '玩家.纪事系统.纪事.夜里的脚步声', value: { 标题: '夜里的脚步声', 类型: '风险', 描述: '半夜屋外有人走动', 状态: '活跃', $time: 5 } } },
      ] }],
    },
    {
      user: '一早我把屋子收拾妥当，算是安顿下来了。', narrative: '收拾停当，这里总算有了点家的样子。', minutes: 150,
      ai: [{ effects: [
        { remove: { path: '玩家.任务系统.活跃任务.寻找落脚处' } },
        { set: { path: '玩家.任务系统.已完成任务.寻找落脚处', value: {
          任务名: '寻找落脚处', 任务类型: '主线', 描述: '找一个能长期落脚的地方', 状态: '已完成', 优先级: '高', 目标: '找到住处', 进度: 100, $time: 6,
        } } },
        { set: { path: '玩家.当前目标', value: '站稳脚跟' } },
      ] }],
    },
    {
      user: '我去集市转转，进行一次战斗训练，顺便看看行情。', narrative: '集市上人声鼎沸，你和几个练家子过了几招，又看了看各处的价钱。', minutes: 200,
      ai: [{ effects: [
        { set: { path: '世界.空间定位.当前位置', value: '东市' } },
        { add: { path: '玩家.货币资源.主货币.数量', delta: 25 } },
      ] }],
    },
    {
      user: '回去的路上我去看看她，带了点心。', narrative: '她接过点心，笑着说下次换她请。', minutes: 300,
      ai: [{ effects: [
        { add: { path: `人物档案.${companion}.关系数据.好感度`, delta: 8 } },
        { set: { path: '玩家.物品栏.桂花糕', value: { 数量: 2, 类型: '食物', 品质: '普通', 备注: '还剩两块' } } },
      ] }],
    },
  ];
}

function worldTurns(world: WorldDef): ScriptedTurn[] {
  const turns = commonTurns(world);
  const survival = moduleConfig<SurvivalModuleSchema>(world, 'survival');
  if (survival) {
    turns[0].mechanics = (state, w, round) => apply(gatherSurvivalResource(state, survival, survival.resources[0].id, { tick: round, enabledModules: ['survival'] }));
    turns[2].mechanics = (state, w, round) => apply(gatherSurvivalResource(state, survival, 'wood', { tick: round, enabledModules: ['survival'] }));
    turns[4].ai!.push({ effects: [{ add: { path: '玩家.生存资源.stone.数量', delta: 3 } }] });
    turns[6].mechanics = (state, w, round) => apply(gatherSurvivalResource(state, survival, 'food', { tick: round, enabledModules: ['survival'] }));
  }
  if (moduleConfig(world, 'business')) {
    turns[1].ai!.push({ effects: [
      { add: { path: '玩家.经营资产.资金', delta: 300 } },
      { append: { path: '玩家.经营资产.资产列表', create: true, value: {
        id: 'stall', 名称: '口岸摊位', 类型: '零售', 等级: 1, 最高等级: 3, 描述: '口岸边上的小摊', 状态: 'active',
        基础收益: 60, 每级收益: 30, 维护费: 15, 员工人数: 1, 员工效率: 1,
      } } },
    ] });
    turns[3].ai!.push({ effects: [{ append: { path: '玩家.经营资产.交易日志', create: true, value: { 类型: 'sale', 描述: '卖出一批方便面', 金额: 120 } } }] });
    turns[5].ai!.push({ effects: [{ add: { path: '玩家.经营资产.资金', delta: -80 } }] });
  }
  const stat = moduleConfig<StatModuleSchema>(world, 'stat');
  if (stat) {
    turns[3].ai!.push({ effects: [{ add: { path: '玩家.生存状态.体力值', delta: -15, min: 0 } }] });
    turns[4].ai!.push({ effects: [{ add: { path: '玩家.生存状态.血量', delta: -12, min: 0 } }] });
    const statId = stat.dim1 ? 'dim1' : 'attrA';
    turns[5].mechanics = (state, w, round) => apply(addStatModifier(state, stat, { id: 'fixture:rested', statId, delta: 2, source: '安顿下来', durationTicks: 10 }, { tick: round, enabledModules: ['stat'] }));
  }
  const diceEnabled = world.modules?.some(module => module.moduleId === 'dice' && module.enabled) === true;
  const dice = diceEnabled ? (moduleConfig<DiceModuleSchema>(world, 'dice') ?? ({} as DiceModuleSchema)) : undefined;
  if (dice) {
    turns[2].mechanics = (state, w, round) => {
      const roll = createDiceRoll(dice, { attributeName: '感知', attributeValue: 12, dc: 12 }, seeded(round));
      return apply(recordDiceRoll(state, { ...roll, timestamp: 1_800_000_000_000 + round }, dice, { tick: round, enabledModules: ['dice'] }));
    };
  }
  return turns;
}

function apply(result: { status: string; state: GameState; reason?: string }): GameState {
  if (result.status !== 'applied') throw new Error(`fixture mechanic was not applied: ${result.reason ?? result.status}`);
  return result.state;
}

function pipelineResult(round: number, narrative: string, minutes: number): PipelineResult {
  const evidence = narrative.slice(0, 18).replaceAll('"', '');
  const text = `<contenttext>${narrative}</contenttext>\n<TimeAdvance>{"minutes":${minutes},"reason":"本轮行动","evidence":"${evidence}"}</TimeAdvance>`;
  const stage = { status: 'success' as const };
  const stages = Object.fromEntries(['main', 'memory_write', 'memory_summary', 'memory_vector', 'memory_query_rewrite', 'memory_retrieve_plan',
    'memory_multi_round', 'memory_rerank', 'memory_retrieve_finalize', 'memory_compile', 'variable', 'settlement']
    .map(id => [id, { ...stage }])) as PipelineResult['status']['stages'];
  return { mainResult: { text, parsed: { content: narrative, thinking: '' } }, status: { round, stages, startTime: 0 } };
}

async function evolve(file: string): Promise<{ name: string; zip: Blob }> {
  const exported = await decodeSaveFile(new Blob([readFileSync(join(HANDOFF, file))])) as { type: string; version: string; save: Record<string, any> };
  const save = structuredClone(exported.save);
  const world = save.customWorld as WorldDef;
  resetSimulationEngine();
  const simEngine = getSimulationEngine();
  if (save.simulationState) simEngine.state = structuredClone(save.simulationState);
  const manager: VariableManager = restoreGameplayManager(save as any, world);
  const messages: Array<Record<string, unknown>> = [];
  let seq = 0;
  const turns = worldTurns(world);
  for (const [index, turn] of turns.entries()) {
    const round = index + 1;
    const aiMsgId = `fixture-${world.id}-turn-${round}`;
    const gs = structuredClone(manager.getState());
    const mechanics = await prepareWorldMechanics(simEngine, { gameState: gs, world, round, turnId: aiMsgId });
    if (mechanics.settled) {
      manager.setState(mechanics.gameState);
      if (mechanics.mechanicalEffects && Object.keys(mechanics.mechanicalEffects).length > 0) {
        manager.applyModuleEffects(mechanics.mechanicalEffects, 'periodic', (world.modules ?? []).filter(m => m.enabled).map(m => m.moduleId));
      }
      await commitWorldMechanics(simEngine, mechanics, () => true);
    }
    if (turn.mechanics) manager.setState(turn.mechanics(manager.getState(), world, round));
    for (const tx of turn.ai ?? []) {
      if (!manager.applyUpdateVariable(JSON.stringify({ id: `${aiMsgId}:ai`, source: 'ai', ...tx }))) {
        throw new Error(`${world.id} turn ${round} AI update rejected: ${manager.getLastAiUpdateRejection()}`);
      }
    }
    const settled = settleAcceptedTurn(manager.getState(), {
      world, progressionBaseline: { tierIndex: manager.getState().玩家.当前段位索引 ?? 0, currentXP: manager.getState().玩家.当前经验值 ?? 0 },
      narrativeDecisionRequest: { saveId: save.id, decisionIds: [] }, internalContinuation: false, done: false,
    }, pipelineResult(round, turn.narrative, turn.minutes), aiMsgId, round, turn.user);
    manager.setState(settled.state);
    const timestamp = 1_800_000_000_000 + round * 60_000;
    messages.push({ id: `${aiMsgId}-user`, role: 'user', rawText: turn.user, round, timestamp, seq: ++seq });
    messages.push({ id: aiMsgId, role: 'assistant', rawText: `<contenttext>${turn.narrative}</contenttext>`, round, timestamp: timestamp + 1, seq: ++seq,
      snapshot: manager.createSnapshot() });
  }
  const bundle = manager.createModulePersistenceBundle(save.id);
  const evolved = {
    ...save,
    gameState: bundle.coreState,
    moduleStates: bundle.current,
    moduleCheckpoints: bundle.checkpoints,
    messages,
    round: turns.length,
    messageCount: messages.length,
    lastMessageSeq: seq,
    timestamp: 1_800_000_000_000 + turns.length * 60_000 + 10,
    simulationState: structuredClone(simEngine.state),
  };
  const json = JSON.stringify({ type: exported.type, version: exported.version, exportedAt: 1_800_000_000_000, save: evolved });
  return { name: file.replace('.save.zip', '.midgame.save.zip'), zip: await encodeSaveFile(new Blob([json])) };
}

async function expectationsFor(dir: string, file: string): Promise<Record<string, unknown>> {
  const meta = await importSaveFromFile(new File([readFileSync(join(dir, file))], file));
  try {
    const loaded = (await loadGame(meta.id))!;
    const world = loaded.customWorld as WorldDef | undefined;
    const manager = restoreGameplayManager(loaded, world);
    const result: Record<string, unknown> = { loaded: summarizeCompatState(manager.getState(), world) };
    const assistants = loaded.messages.filter(message => message.role === 'assistant' && message.snapshot);
    for (const index of [1, 4]) {
      const message = assistants[index];
      if (!message) continue;
      const rollback = restoreGameplayManager(loaded, world);
      rollback.restoreSnapshot(structuredClone(message.snapshot) as GameState);
      result[`rollback:${message.id}`] = summarizeCompatState(rollback.getState(), world);
    }
    return result;
  } finally {
    await deleteSave(meta.id);
  }
}

mkdirSync(MIDGAME, { recursive: true });
const expectations: Record<string, unknown> = {};
for (const file of readdirSync(HANDOFF).filter(name => name.endsWith('.save.zip')).sort()) {
  const { name, zip } = await evolve(file);
  writeFileSync(join(MIDGAME, name), new Uint8Array(await zip.arrayBuffer()));
  expectations[`handoff/${file}`] = await expectationsFor(HANDOFF, file);
  expectations[`midgame/${name}`] = await expectationsFor(MIDGAME, name);
  console.log('generated', name);
}
writeFileSync(join(FIXTURE_ROOT, 'expectations.json'), `${JSON.stringify(expectations, null, 2)}\n`);
console.log('expectations written');
