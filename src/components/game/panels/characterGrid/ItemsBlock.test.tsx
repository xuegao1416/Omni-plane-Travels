import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ItemsBlock } from './NPCDetail';

test('物品页签同时呈现剧情中增减的物品栏与静态物品列表', () => {
  const markup = renderToStaticMarkup(
    <ItemsBlock data={{ 物品栏: { 火把: { 数量: 2, 类型: '消耗品' } }, 物品列表: { 家传玉佩: { 品质: '稀有' } }, 装备列表: { 武器: '铁剑' } }} />,
  );
  expect(markup).toContain('随身物品栏');
  expect(markup).toContain('火把');
  expect(markup).toContain('物品列表');
  expect(markup).toContain('家传玉佩');
  expect(markup).toContain('装备列表');
  expect(markup).toContain('铁剑');
});

test('两栏皆空时不渲染任何分区，交给外层显示暂无', () => {
  const markup = renderToStaticMarkup(<ItemsBlock data={{}} />);
  expect(markup).not.toContain('随身物品栏');
  expect(markup).not.toContain('装备列表');
});
