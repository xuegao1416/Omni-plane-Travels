import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FogPanel, hasBlockContent } from './FogPanel';

test('整片迷雾：默认盖住幕后内容，真相不在 DOM 里', () => {
  const markup = renderToStaticMarkup(
    <FogPanel label="技能与状态（幕后）">
      <div>烈焰斩 · 三级</div>
    </FogPanel>,
  );
  expect(markup).toContain('技能与状态（幕后）');
  expect(markup).toContain('••••••');
  expect(markup).toContain('查看幕后内容');
  expect(markup).not.toContain('烈焰斩');
  expect(markup).not.toContain('角色尚不知');
});

test('迷雾块在有实质内容时才成立：hasBlockContent 判定', () => {
  expect(hasBlockContent(undefined, null, '')).toBe(false);
  expect(hasBlockContent([], {})).toBe(false);
  expect(hasBlockContent([], { 剑术: '精通' })).toBe(true);
  expect(hasBlockContent(['火球术'])).toBe(true);
  expect(hasBlockContent({ 血量: 30 })).toBe(true);
});
