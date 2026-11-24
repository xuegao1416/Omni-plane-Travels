// 游戏右栏的自创模块面板，以及点按钮之后给玩家的提示。
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDefaultGameState } from '../../../schema/variables';
import type { CustomGameplayModuleV3 } from '../../../custom-modules/schema';
import { createInitialCustomModuleState } from '../../../custom-modules/stateStore';
import { describeCustomModuleButtonOutcome } from '../../../custom-modules/engineBridge';
import { CustomModulePanel } from './CustomModulePanel';
import { validateCustomGameplayModule } from '../../../custom-modules/validator';

function module(id: string, title: string, slot: 'left-panel' | 'right-panel'): CustomGameplayModuleV3 {
  return {
    kind: 'custom-gameplay-module', schemaVersion: 3, id, name: title, version: '1.0.0', author: 'test', scope: 'world',
    inputs: {}, capabilities: [], items: {}, state: { count: { type: 'number', default: 3, min: 0 } },
    permissions: { read: [], write: 'own-state-only' },
    logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [] },
    view: { slot, title, components: [{ type: 'number', label: '计数', path: 'count' }, { type: 'button', label: '加一', event: 'plus' }] },
  };
}

describe('自创模块面板', () => {
  test('右栏与左栏的模块都显示，右栏的排在前面；停用的不显示', () => {
    const game = createDefaultGameState();
    const left = module('left-mod', '左栏模块', 'left-panel');
    const right = module('right-mod', '右栏模块', 'right-panel');
    const off = module('off-mod', '停用模块', 'right-panel');
    game.customModules = {
      [left.id]: createInitialCustomModuleState(left),
      [right.id]: createInitialCustomModuleState(right),
      [off.id]: { ...createInitialCustomModuleState(off), enabled: false },
    };
    const html = renderToStaticMarkup(<CustomModulePanel gameState={game} />);
    expect(html).toContain('左栏模块');
    expect(html).toContain('右栏模块');
    expect(html).not.toContain('停用模块');
    expect(html.indexOf('右栏模块')).toBeLessThan(html.indexOf('左栏模块'));
    expect(html).toContain('加一');
  });

  test('left-panel 仍然通过校验，并给作者一条「显示在右栏」的提醒', () => {
    const result = validateCustomGameplayModule(module('left-mod', '左栏模块', 'left-panel'));
    expect(result.valid).toBe(true);
    expect(result.warnings.map(item => item.code)).toContain('left-panel-shown-right');
    expect(validateCustomGameplayModule(module('right-mod', '右栏模块', 'right-panel')).warnings.map(item => item.code)).not.toContain('left-panel-shown-right');
  });
});

describe('按钮提示', () => {
  test('失败时去掉模块 id 前缀并去重；什么都没发生时也提示；成功时不提示', () => {
    expect(describeCustomModuleButtonOutcome({ activeModuleIds: ['bench'], applied: 0, warnings: ['bench: 铜钱不足', 'bench: 铜钱不足'] }, 'bench', '铁匠台')).toBe('「铁匠台」：铜钱不足');
    expect(describeCustomModuleButtonOutcome({ activeModuleIds: ['bench'], applied: 0, warnings: [] }, 'bench', '铁匠台')).toBe('「铁匠台」：现在条件不满足，这次没有发生变化。');
    expect(describeCustomModuleButtonOutcome({ activeModuleIds: ['bench'], applied: 2, warnings: [] }, 'bench', '铁匠台')).toBeUndefined();
    expect(describeCustomModuleButtonOutcome({ activeModuleIds: [], applied: 0, warnings: ['游戏状态已切换或变化，本次模块执行未提交。'] }, 'bench', '铁匠台')).toBe('「铁匠台」：游戏状态已切换或变化，本次模块执行未提交。');
  });
});
