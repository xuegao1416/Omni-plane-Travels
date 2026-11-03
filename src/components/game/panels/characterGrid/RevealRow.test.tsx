import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevealRow, resolveReveal } from './RevealRow';

test('读者视角字段：角色不知道的秘密默认遮住，不点眼睛不出现在 DOM 里', () => {
  const markup = renderToStaticMarkup(<RevealRow label="当前想法" known={undefined} hidden="我打算今晚动手" />);
  expect(markup).toContain('当前想法');
  expect(markup).toContain('••••••');
  expect(markup).not.toContain('我打算今晚动手');
  expect(markup).not.toContain('角色尚不知');
});

test('角色已知的字段直接显示，不再需要眼睛', () => {
  const markup = renderToStaticMarkup(<RevealRow label="当前想法" known="他当众说了实话" hidden="他其实在撒谎" />);
  expect(markup).toContain('他当众说了实话');
  expect(markup).not.toContain('他其实在撒谎');
  expect(markup).not.toContain('••••••');
});

test('已知与幕后都为空时退化成未知，不出现眼睛按钮', () => {
  const markup = renderToStaticMarkup(<RevealRow label="长期目标" known={undefined} hidden={undefined} />);
  expect(markup).toContain('未知');
  expect(markup).not.toContain('••••••');
});

test('resolveReveal 判定优先级：角色已知 > 幕后真相 > 未知', () => {
  expect(resolveReveal('已知', '幕后')).toEqual({ text: '已知', concealed: false });
  expect(resolveReveal('', '幕后')).toEqual({ text: '幕后', concealed: true });
  expect(resolveReveal(undefined, { 说明: '结构化' })).toEqual({ text: '{"说明":"结构化"}', concealed: true });
  expect(resolveReveal(undefined, '')).toEqual({ text: '未知', concealed: false });
});
