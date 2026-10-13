import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DirectorDetails } from './DirectorDetails';

test('collapsed details never build their child controls', () => {
  let builds = 0;
  const html = renderToStaticMarkup(<DirectorDetails summary="编辑事件">{() => {
    builds++;
    return <textarea defaultValue="剧情内容" />;
  }}</DirectorDetails>);
  expect(builds).toBe(0);
  expect(html).toContain('<summary>编辑事件</summary>');
  expect(html.includes('<textarea')).toBe(false);
});

test('expanded details build current controls while nested sections remain deferred', () => {
  let nestedBuilds = 0;
  const html = renderToStaticMarkup(<DirectorDetails summary="编辑事件" defaultOpen>{() => <>
    <textarea defaultValue="剧情内容" />
    <DirectorDetails summary="事件依赖">{() => {
      nestedBuilds++;
      return <input type="checkbox" />;
    }}</DirectorDetails>
  </>}</DirectorDetails>);
  expect(html).toContain('剧情内容</textarea>');
  expect(html).toContain('<summary>事件依赖</summary>');
  expect(nestedBuilds).toBe(0);
  expect(html.includes('type="checkbox"')).toBe(false);
});
