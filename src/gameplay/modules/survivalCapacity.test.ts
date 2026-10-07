import { expect, test } from 'bun:test';
import { createDefaultGameState } from '../../schema/variables';
import { craftSurvivalRecipe } from './survival';

test('crafting cannot overfill output while material costs remain atomic and definitions remain immutable', () => {
  const original = createDefaultGameState(); original.玩家.生存资源 = { wood: { 数量: 8, 最大值: 10 }, plank: { 数量: 8, 最大值: 10 } };
  const recipe = { id: 'plank', name: '木板', inputs: { wood: 2 }, output: { resourceId: 'plank', amount: 5 }, description: '' };
  const result = craftSurvivalRecipe(original, recipe, { tick: 0, enabledModules: ['survival'] });
  expect(result.status).toBe('applied'); expect(result.state.玩家.生存资源?.plank.数量).toBe(10);
  expect(result.state.玩家.生存资源?.wood.数量).toBe(6); expect(original.玩家.生存资源?.wood.数量).toBe(8); expect(recipe.output.amount).toBe(5);
});
