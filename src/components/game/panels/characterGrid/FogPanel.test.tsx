import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FogPanel, hasBlockContent } from './FogPanel';
import { toLabel } from './ListOrRecord';

test('迷雾：内容照常渲染，上面糊一层高斯模糊的毛玻璃', () => {
  const hidden = renderToStaticMarkup(
    <FogPanel label="技能与状态（幕后）" revealed={false}>
      <div>烈焰斩 · 三级</div>
    </FogPanel>,
  );
  expect(hidden).toContain('技能与状态（幕后）');
  expect(hidden).toContain('••••••');
  expect(hidden).toContain('blur(6px)');
  expect(hidden).toContain('backdrop-filter');
  expect(hidden).not.toContain('角色尚不知');
});

test('展开后玻璃消失，并标注角色尚不知', () => {
  const shown = renderToStaticMarkup(
    <FogPanel label="技能与状态（幕后）" revealed>
      <div>烈焰斩 · 三级</div>
    </FogPanel>,
  );
  expect(shown).toContain('烈焰斩');
  expect(shown).toContain('角色尚不知');
  expect(shown).not.toContain('blur(6px)');
  expect(shown).not.toContain('••••••');
});

test('迷雾块在有实质内容时才成立：hasBlockContent 判定', () => {
  expect(hasBlockContent(undefined, null, '')).toBe(false);
  expect(hasBlockContent([], {})).toBe(false);
  expect(hasBlockContent([], { 剑术: '精通' })).toBe(true);
  expect(hasBlockContent(['火球术'])).toBe(true);
  expect(hasBlockContent({ 血量: 30 })).toBe(true);
});

test('数组里的对象元素不能直接当子节点渲染，需取可读名称', () => {
  expect(toLabel('火球术')).toBe('火球术');
  expect(toLabel({ 技能名: '烈焰斩', 品质: '稀有' })).toBe('烈焰斩');
  expect(toLabel({ 品质: '稀有', 名称: '铁剑' })).toBe('铁剑');
  expect(toLabel({})).toBe('{}');
});
