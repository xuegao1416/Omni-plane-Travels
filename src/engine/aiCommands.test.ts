// 变量 AI 的模块命令：白名单内的命令按本地规则结算，白名单外的整笔拒绝；提取提示词用宿主模块的说明。
import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { VariableManager } from './variableManager';
import { createGameplayHost } from '../core/registry';
import { formatAiCommands } from '../core/aiCommands';
import { buildVariableExtractionPrompt } from '../utils/prompts/editor-prompts';

const tradeWorld = {
  id: 'ai_trade', name: '商路', description: '',
  modules: [
    { moduleId: 'business', enabled: true, moduleConfig: { description: '边贸', funds: 0, cycleName: '天', market: { items: [{ name: '羽绒服', basePrice: 80, trend: 'stable', changePercent: 0 }] }, assets: [], rules: { contractChance: 0 } } },
    { moduleId: 'survival', enabled: true, moduleConfig: { resources: [{ id: 'water', name: '淡水', amount: 3, max: 10 }] } },
  ],
} as unknown as WorldDef;

function manager() {
  const state = createDefaultGameState();
  state.世界.时间系统.时钟 = { schemaVersion: 2, elapsedMinutes: 8 * 60 };
  state.玩家.货币资源.主货币 = { 名称: '卢布', 数量: 100 };
  const vm = new VariableManager(state);
  vm.bindWorld(tradeWorld);
  return vm;
}

describe('变量 AI 的模块命令', () => {
  test('白名单命令按本地规则结算（物资增减受上限约束）', () => {
    const vm = manager();
    const ok = vm.applyUpdateVariable(JSON.stringify({
      id: 'turn-1', source: 'ai', label: '变量裁定',
      commands: [{ command: 'resources.grant', args: { id: 'water', amount: 20, reason: '接到雨水' } }],
    }));
    expect(ok).toBe(true);
    expect(vm.getState().resources?.stocks.water).toBe(10);
  });

  test('命令与普通效果可以写在同一笔事务里；仓库没货时卖出命令失败只记警告', () => {
    const vm = manager();
    const ok = vm.applyUpdateVariable(JSON.stringify({
      id: 'turn-2', source: 'ai', label: '变量裁定',
      effects: [{ set: { path: '玩家.当前目标', value: '去口岸' } }],
      commands: [{ command: 'economy.sell', args: { market: 'local', goods: '羽绒服', quantity: 2 } }],
    }));
    expect(ok).toBe(true);
    expect(vm.getState().玩家.当前目标).toBe('去口岸');
    expect(vm.getState().玩家.货币资源.主货币.数量).toBe(100);
  });

  test('白名单外的命令整笔拒绝', () => {
    const vm = manager();
    const ok = vm.applyUpdateVariable(JSON.stringify({
      id: 'turn-3', source: 'ai', label: '变量裁定',
      effects: [{ set: { path: '玩家.当前目标', value: '作弊' } }],
      commands: [{ command: 'events.trigger', args: { eventId: 'x' } }],
    }));
    expect(ok).toBe(false);
    expect(vm.getLastAiUpdateRejection()).toContain('commands');
    expect(vm.getState().玩家.当前目标).not.toBe('作弊');
  });

  test('提取提示词列出本世界可用的命令与模块变量说明，不再给旧的经营资产写法', () => {
    const state = manager().getState();
    const host = createGameplayHost(tradeWorld, state);
    const prompt = buildVariableExtractionPrompt({ 经营资产: tradeWorld.modules![0].moduleConfig }, undefined, {
      summaries: host.summarize(state, 'extraction'), commands: formatAiCommands(host),
    });
    expect(prompt).toContain('economy.sell');
    expect(prompt).toContain('resources.grant');
    expect(prompt).toContain('player.resources.<id>');
    expect(prompt).not.toContain('【经营资产更新规则】');
    expect(prompt).not.toContain('"path":"玩家.当前经验值"');
  });
});
