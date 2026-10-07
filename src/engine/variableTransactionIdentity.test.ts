import { expect, test } from 'bun:test';
import { VariableManager } from './variableManager';
import { runTurnVariableExtraction } from './turnVariableExtraction';
import type { GameState } from '../schema/variables';
import { selectPlayerKnownNPCs } from './playerKnowledge';

test('canonical AI transaction resolves a newly created NPC for its subsequent effects', () => {
  const manager = new VariableManager();
  const applied = manager.applyAiUpdateVariable(JSON.stringify({ id: 'create-and-update', source: 'ai', label: '人物登场', effects: [
    { set: { path: '世界.空间定位.当前位置', value: '校园走廊' } },
    { set: { path: '人物档案.classmate-001', value: { 姓名: '佐藤花', 性别: '女', 人物分类: '在场', 个人信息: { 当前位置: '校园走廊' } } } },
    { set: { path: '人物档案.classmate-001.当前行动', value: '带玩家去教务处' } },
    { append: { path: '人物档案.佐藤花.人物事迹', value: '在走廊首次见到玩家' } },
  ] }));
  expect(applied).toBe(true);
  expect(manager.getState().人物档案['classmate-001'].当前行动).toBe('带玩家去教务处');
  expect(manager.getState().人物档案['classmate-001'].人物事迹).toEqual(['在走廊首次见到玩家']);
  expect(manager.getState().世界.空间定位.当前位置).toBe('校园走廊');
});

test('unmodified real Flash response applies through extraction with its public campus snapshot', async () => {
  const fixture = await Bun.file(new URL('./variableFlash.fixture.json', import.meta.url)).json() as {
    state: GameState; userText: string; narrative: string; responseText: string;
  };
  const originalFetch = globalThis.fetch;
  const manager = new VariableManager();
  manager.setState(fixture.state);
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: fixture.responseText } }] }))) as unknown as typeof fetch;
  try {
    await runTurnVariableExtraction({ varMgr: manager, parsed: { content: fixture.narrative, thinking: '' }, round: 1, userText: fixture.userText,
      mainApiConfig: { baseUrl: 'https://public-flash-fixture.test', apiKey: 'test', model: 'test', provider: 'custom', stream: false },
      worldBook: null, worldId: 'default', delayMs: 0, maxRetries: 0, isCurrent: () => true });
    expect(manager.getState().世界.空间定位.当前位置).toBe('私立樱丘高校·主教学楼一层走廊（一年级四班外）');
    expect(manager.getState().玩家.当前目标).toBe('前往鞋柜查看分班名单，确认自己的所属班级与座位');
    expect(manager.getState().人物档案.门卫.人物分类).toBe('离场');
    expect(selectPlayerKnownNPCs(manager.getState()).门卫.姓名).toBe('门卫');
    expect(manager.getState().gameplay?.logs.at(-1)?.status).toBe('applied');
  } finally { globalThis.fetch = originalFetch; }
});

test('unknown partial NPC writes still reject the whole transaction before costs or valid effects commit', () => {
  const manager = new VariableManager();
  const before = manager.getState();
  expect(manager.applyAiUpdateVariable(JSON.stringify({ id: 'missing-npc', source: 'ai', effects: [
    { set: { path: '世界.空间定位.当前位置', value: '不应提交' } },
    { set: { path: '人物档案.unknown.当前行动', value: '不允许隐式人物' } },
  ] }))).toBe(false);
  expect(manager.getState()).toEqual(before);
});
