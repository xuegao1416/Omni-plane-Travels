import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { buildCustomModuleHostContext, readCustomModuleHostInput } from './context';

describe('custom module host context', () => {
  test('exposes a cloned safe snapshot instead of GameState references', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.血量 = 80;
    state.玩家.货币资源.主货币.数量 = 42;
    const context = buildCustomModuleHostContext(state, { round: 3, event: { type: 'button', moduleId: 'demo', event: 'refresh' } });
    expect(readCustomModuleHostInput(context, 'player.stats.attrA')).toBe(80);
    expect(readCustomModuleHostInput(context, 'player.currency.primary')).toBe(42);
    expect(readCustomModuleHostInput(context, 'game.round')).toBe(3);
    expect(readCustomModuleHostInput(context, 'event.button.event')).toBe('refresh');
    expect((context as unknown as { gameState?: unknown }).gameState).toBeUndefined();
    context.player.stats.attrA = 1;
    expect(state.玩家.生存状态.血量).toBe(80);
  });
});
