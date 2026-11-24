import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NpcGearBlock, NpcPackBlock } from './NPCDetail';

test('行囊页签把剧情中增减的物品栏与静态物品列表合成一个有容量的行囊', () => {
  const markup = renderToStaticMarkup(
    <NpcPackBlock data={{ 物品栏: { 火把: { 数量: 2, 类型: '消耗品' } }, 物品列表: { 家传玉佩: { 品质: '稀有' } } }} />,
  );
  expect(markup).toContain('随身行囊');
  expect(markup).toContain('火把');
  expect(markup).toContain('×2');
  expect(markup).toContain('家传玉佩');
  // NPC 随身 8 格：两件物品各占一格，其余是空格，不再铺满 48 格。
  expect(markup).toContain('2<small> / 8 格</small>');
  expect(markup.match(/eqi__cell eqi__cell--empty/g)?.length).toBe(6);
});

test('背包放进行囊位扩充格数，名称数组形式的旧物品列表按名称显示', () => {
  const markup = renderToStaticMarkup(
    <NpcPackBlock data={{ 物品栏: { 旧皮背包: { 数量: 1, 类型: '背包', 品质: '精良' } }, 物品列表: ['短刀', '火石'] }} />,
  );
  expect(markup).toContain('旧皮背包');
  expect(markup).toContain('+6 格');
  expect(markup).toContain('2<small> / 14 格</small>');
  expect(markup).toContain('短刀');
  expect(markup).not.toContain('>0<');
});

test('装备页签把旧的装备列表按部位放进装备环', () => {
  const markup = renderToStaticMarkup(
    <NpcGearBlock data={{ 装备列表: { 武器: '铁剑' }, 装备栏: { 头部: { 名称: '铁盔', 品质: '精良' } } }} name="守卫" portrait={<span>守</span>} />,
  );
  expect(markup).toContain('武器：铁剑');
  expect(markup).toContain('头部：铁盔');
  expect(markup).toContain('穿戴 2 / 8');
});
