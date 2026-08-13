import { describe, expect, test } from 'bun:test';
import { dialogueMarkupToPlainText, renderDialogueMarkup } from './dialogueMarkup';

describe('structured dialogue markup', () => {
  test('renders multiple SPEAK blocks without crossing block boundaries', () => {
    const raw = [
      '她推开门。',
      '[SPEAK]{"img":"","who":"艾莉丝","sub":"守门人","msg":"他说\\\"别走\\\"。","act":"她抬起手。"}',
      '[SPEAK]{"img":"","who":"村长","sub":"长者","msg":"先坐下吧。","act":"他指向木椅。"}',
    ].join('\n');
    const rendered = renderDialogueMarkup(raw);
    expect(rendered.match(/class="inline-dialogue-card"/g)?.length).toBe(2);
    expect(rendered).not.toContain('dialogue-avatar-placeholder');
    expect(rendered).toContain('data-name="艾莉丝"');
    expect(rendered).toContain('他说&quot;别走&quot;。');
    expect(rendered).toContain('data-name="村长"');
  });

  test('leaves malformed blocks visible instead of swallowing nearby prose', () => {
    const raw = '前文\n[SPEAK]{"who":"艾莉丝","msg":"未闭合"\n后文';
    expect(renderDialogueMarkup(raw)).toBe(raw);
  });

  test('converts dialogue markers into readable copied text', () => {
    const raw = '[SPEAK]{"img":"","who":"艾莉丝","sub":"守门人","msg":"欢迎回来。","act":"她微微点头。"}';
    expect(dialogueMarkupToPlainText(raw)).toBe('艾莉丝 · 守门人：欢迎回来。\n（她微微点头。）');
  });

  test('keeps legacy ui:DL messages readable after switching presets', () => {
    const raw = '/ui:DL {"av":"","nm":"旅店老板","tt":"掌柜","tx":"房间已经备好。","ac":"他把钥匙放在柜台上。"}';
    expect(renderDialogueMarkup(raw)).toContain('data-name="旅店老板"');
    expect(renderDialogueMarkup(raw)).toContain('class="inline-dialogue-card"');
    expect(dialogueMarkupToPlainText(raw)).toBe('旅店老板 · 掌柜：房间已经备好。\n（他把钥匙放在柜台上。）');
  });
});
