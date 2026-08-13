import { describe, expect, it } from 'bun:test';
import { toDisplayText } from './displayText';

describe('toDisplayText', () => {
  it('extracts readable text from legacy object-shaped fields', () => {
    expect(toDisplayText({ 描述: '抱歉，耽误你时间了', 阶段: [] })).toBe('抱歉，耽误你时间了');
  });
});
