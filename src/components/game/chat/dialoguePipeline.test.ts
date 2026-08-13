import { describe, expect, test } from 'bun:test';
import { getBuiltinDisplayScripts, getBuiltinPreset } from '../../../data/builtinPresets';
import { processRegexScripts } from '../../../utils/regexScripts';
import { mergeDisplayScripts } from './messageBubble/renderPipeline';
import { renderDialogueMarkup } from '../../../utils/dialogueMarkup';

const speakFixture = '[SPEAK]{"img":"","who":"雾中引路人","sub":"晨光庭守望者","msg":"不要急着走，先听听庭院的风。","act":"他抬手指向门后的晨雾。"}';

describe('NPC dialogue display pipeline', () => {
  test('the structured parser produces a stable dialogue card from raw message text', () => {
    const cleaned = renderDialogueMarkup(processRegexScripts(speakFixture, getBuiltinDisplayScripts()));
    expect(cleaned).toContain('class="inline-dialogue-card"');
    expect(cleaned).toContain('data-name="雾中引路人"');
  });

  test('defers dialogue portals until streaming finishes and removes duplicate scripts', () => {
    const scripts = getBuiltinDisplayScripts();
    const merged = mergeDisplayScripts(scripts, scripts, [{
      id: 'builtin_display_dialogue_avatar',
      scriptName: '旧头像正则',
      findRegex: 'unsafe',
      replaceString: 'unsafe',
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: false,
    }]);
    expect(merged.length).toBe(scripts.length);
    expect(merged.some(script => script.id.includes('dialogue'))).toBe(false);

    const streaming = processRegexScripts(speakFixture, merged);
    expect(streaming).toContain('[SPEAK]');
    expect(streaming).not.toContain('dialogue-avatar-placeholder');

    const completed = renderDialogueMarkup(processRegexScripts(speakFixture, merged));
    expect(completed).toContain('class="inline-dialogue-card"');
  });

  test('keeps avatar output instructions exclusive to the dialogue preset', () => {
    for (const id of ['default', 'claude', 'deepseek']) {
      expect(getBuiltinPreset(id).prompts.some(prompt => prompt.content.includes('[SPEAK]'))).toBe(false);
    }
    const dialoguePreset = getBuiltinPreset('dialogue_avatar');
    expect(dialoguePreset.prompts.some(prompt => prompt.content.includes('[SPEAK]'))).toBe(true);
    expect(dialoguePreset.systemPrompt).toContain('英文双引号必须写成 \\"');
    expect(dialoguePreset.systemPrompt).toContain('不要另起“时间：”“地点：”“人物：”“摘要：”');
  });

  test('never guesses metadata from visible prose and only strips explicit system tags', () => {
    const raw = [
      '他收回手：“抱歉，耽误你时间了。”',
      '时间：黄昏',
      '地点：我们约在旧车站。',
      '人物：她从来不认为自己是故事主角。',
      '摘要：这是他亲手写下的文章标题。',
      '<UpdateVariable>{"世界":{"时间系统":{"当前天气":"晴"}}}</UpdateVariable>',
    ].join('\n');
    const cleaned = processRegexScripts(raw, getBuiltinDisplayScripts());
    expect(cleaned).toContain('“抱歉，耽误你时间了。”');
    expect(cleaned).toContain('时间：黄昏');
    expect(cleaned).toContain('地点：我们约在旧车站。');
    expect(cleaned).toContain('人物：她从来不认为自己是故事主角。');
    expect(cleaned).toContain('摘要：这是他亲手写下的文章标题。');
    expect(cleaned).not.toContain('<UpdateVariable>');
  });
});
