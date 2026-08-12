import { describe, expect, test } from 'bun:test';
import { getBuiltinDisplayScripts } from '../../../data/builtinPresets';
import { processRegexScripts } from '../../../utils/regexScripts';
import { parseContent } from '../../../utils/markdown';

const speakFixture = '[SPEAK]{"img":"","who":"雾中引路人","sub":"晨光庭守望者","msg":"不要急着走，先听听庭院的风。","act":"他抬手指向门后的晨雾。"}';

describe('NPC dialogue display pipeline', () => {
  test('the built-in display script produces a dialogue portal from raw message text', () => {
    const cleaned = processRegexScripts(speakFixture, getBuiltinDisplayScripts());
    expect(cleaned).toContain('dialogue-avatar-placeholder');
    expect(cleaned).toContain('data-name="雾中引路人"');
    expect(parseContent(cleaned).content).toContain('dialogue-avatar-placeholder');
  });
});
