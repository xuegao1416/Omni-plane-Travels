import { describe, expect, test } from 'bun:test';
import type { WorldBookEntryDef } from '../data/worlds-schema';
import { findNovelModuleConflicts } from './moduleCompatibility';

const rule = (content: string): WorldBookEntryDef => ({
  uid: 1, key: [], constant: true, comment: '原著硬规则', content,
  order: 1, position: 'before_char', entryType: 'rules',
});

describe('novel module compatibility', () => {
  test('only reports explicit source-rule conflicts for enabled module families', () => {
    const conflicts = findNovelModuleConflicts([
      rule('此世界不存在货币，禁止任何交易。修行者境界终生固定，无法升级。'),
    ], ['business', 'progression', 'combat']);

    expect(conflicts.map(conflict => conflict.moduleId)).toEqual(['business', 'progression']);
    expect(conflicts.every(conflict => conflict.sourceRule.includes('此世界'))).toBe(true);
  });
});
