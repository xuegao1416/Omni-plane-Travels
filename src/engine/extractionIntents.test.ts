// 变量提取的意图格式：逐条按变量表与命令白名单校验；不合格的丢弃并说明原因，合格的照常结算；
// 全部不合格时整笔拒绝，提取重试一次并附上逐条原因。旧的 GameplayTransaction 格式照样接受。
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test } from 'bun:test';
import { WORLDS } from '../data/worldLoader';
import { createNewSessionManager } from './sessionInitialization';
import { runTurnVariableExtraction } from './turnVariableExtraction';
import { formatSettledChanges } from './variableExtraction';
import { buildVariableExtractionPrompt } from '../utils/prompts/editor-prompts';
import { createGameplayHost } from '../core/registry';
import { formatAiCommands } from '../core/aiCommands';

const island = WORLDS.find(world => world.id === 'stranded_island')!;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function manager() {
  return createNewSessionManager(island);
}

describe('意图格式', () => {
  test('写原始路径、模块变量与命令，because 写进玩法日志的标题', () => {
    const vm = manager();
    const before = vm.getState();
    const ok = vm.applyUpdateVariable(JSON.stringify({ intents: [
      { set: '玩家.当前目标', value: '找到淡水', because: '口渴难耐' },
      { add: 'player.stats.hp', delta: -5, because: '被礁石划伤' },
      { add: 'player.resources.wood', delta: 2, because: '捡到浮木' },
      { command: 'resources.consume', args: { id: 'water', amount: 1, reason: '喝水' }, because: '喝了一口水' },
    ] }));
    expect(ok).toBe(true);
    const after = vm.getState();
    expect(after.玩家.当前目标).toBe('找到淡水');
    expect(after.玩家.生存状态.血量).toBe(before.玩家.生存状态.血量 - 5);
    expect(after.resources?.stocks.wood).toBe((before.resources?.stocks.wood ?? 0) + 2);
    expect(after.resources?.stocks.water).toBe((before.resources?.stocks.water ?? 0) - 1);
    expect(after.gameplay?.logs.some(log => log.label?.startsWith('变量裁定：口渴难耐；被礁石划伤'))).toBe(true);
    expect(vm.getLastAiUpdateNotes()).toEqual([]);
  });

  test('不合格的意图丢弃并说明原因，其余照常生效', () => {
    const vm = manager();
    const ok = vm.applyUpdateVariable(JSON.stringify({ intents: [
      { set: '玩家.当前目标', value: '搭棚子', because: '要下雨了' },
      { add: 'player.xp', delta: 99, because: '想多拿经验' },
      { command: 'economy.sell', args: { goods: '鱼' } },
      { set: 'gameplay.rng', value: 1 },
      { set: '玩家.外貌', add: '玩家.年龄', value: 1 },
    ] }));
    expect(ok).toBe(true);
    expect(vm.getState().玩家.当前目标).toBe('搭棚子');
    const notes = vm.getLastAiUpdateNotes().join('\n');
    expect(notes).toContain('第 2 条');
    expect(notes).toContain('第 3 条：命令「economy.sell」在本世界不可用');
    expect(notes).toContain('第 4 条：路径「gameplay.rng」不存在或不允许写');
    expect(notes).toContain('第 5 条：需要且只能有一个动词');
  });

  test('全部不合格时整笔拒绝并给出逐条原因；空列表表示没有变化', () => {
    const vm = manager();
    const before = vm.getState();
    expect(vm.applyUpdateVariable(JSON.stringify({ intents: [{ set: 'v3.combatSession', value: 1 }, { remove: '' }] }))).toBe(false);
    expect(vm.getLastAiUpdateRejection()).toContain('意图全部未通过校验：第 1 条');
    expect(vm.getLastAiUpdateRejection()).toContain('第 2 条：缺少变量路径');
    expect(vm.getState()).toEqual(before);
    expect(vm.applyUpdateVariable(JSON.stringify({ intents: [] }))).toBe(true);
    expect(vm.getState()).toEqual(before);
  });

  test('旧的 GameplayTransaction 格式照样接受（模块说明里的变量也可以写）', () => {
    const vm = manager();
    expect(vm.applyUpdateVariable(JSON.stringify({ effects: [{ set: { path: '玩家.当前目标', value: '旧格式' } }, { add: { path: 'player.resources.wood', delta: 1 } }] }))).toBe(true);
    expect(vm.getState().玩家.当前目标).toBe('旧格式');
  });

  test('全部不合格时提取重试一次，重试请求带上本次输出与逐条原因', async () => {
    const vm = manager();
    const requests: string[] = [];
    const bad = '<UpdateVariable>{"intents":[{"add":"player.xp","delta":40,"because":"打赢了"}]}</UpdateVariable>';
    const good = '<UpdateVariable>{"intents":[{"set":"玩家.当前目标","value":"休整","because":"打完架很累"}]}</UpdateVariable>';
    globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
      requests.push(String(options?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: requests.length === 1 ? bad : good } }] }));
    }) as unknown as typeof fetch;
    await runTurnVariableExtraction({ varMgr: vm, parsed: { content: '你打退了野狗，坐下来喘气。', thinking: '' }, round: 1, userText: '打退野狗',
      mainApiConfig: { baseUrl: 'https://intents.test', apiKey: 'test', model: 'test', provider: 'custom', stream: false },
      worldBook: null, worldId: island.id, delayMs: 0, maxRetries: 1, isCurrent: () => true });
    expect(requests).toHaveLength(2);
    const retry = (JSON.parse(requests[1]).messages as Array<{ content: string }>).map(message => message.content).join('\n');
    expect(retry).toContain('意图全部未通过校验：第 1 条');
    expect(retry).toContain('"add":"player.xp"');
    expect(vm.getState().玩家.当前目标).toBe('休整');
  });
});

describe('提取提示词', () => {
  test('只教意图格式；示例输出本身能通过校验并生效', () => {
    const vm = manager();
    const state = vm.getState();
    const host = createGameplayHost(island, state);
    const prompt = buildVariableExtractionPrompt({ 生存资源: island.modules!.find(module => module.moduleId === 'survival')!.moduleConfig }, undefined, {
      summaries: host.summarize(state, 'extraction'), commands: formatAiCommands(host),
    });
    expect(prompt).toContain('{"intents":[');
    expect(prompt).toContain('"command":"resources.consume"');
    expect(prompt).not.toContain('"effects":[');
    expect(prompt).not.toContain('"op":"remove"');
    const example = prompt.match(/【示例输出】[\s\S]*?<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/)?.[1];
    expect(example).toBeDefined();
    expect(vm.applyUpdateVariable(example!)).toBe(true);
    expect(vm.getState().人物档案.神秘老者?.姓名).toBe('神秘老者');
  });

  test('本回合已结算的变化写进提示（替代不再写入的 effectLog）', () => {
    const vm = manager();
    const state = vm.getState();
    expect(formatSettledChanges(state)).toBe('（本回合还没有本地结算）');
    const host = createGameplayHost(island, state);
    const gathered = host.dispatch(host.prepare(state), 'resources.gather', { id: 'wood' }, { source: 'player', label: '采集木材' });
    expect(formatSettledChanges(gathered.state)).toContain('- 采集木材：');
    expect(formatSettledChanges(gathered.state)).toContain('resources.stocks.wood');
  });
});
