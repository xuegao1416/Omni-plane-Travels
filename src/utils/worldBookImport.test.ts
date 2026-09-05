import { describe, it, expect } from 'bun:test';
import { parseWorldBookImport, mergeWorldBookEntries } from './worldBookImport';
import type { WorldBookEntryDef } from '../data/worlds-schema';

describe('parseWorldBookImport', () => {
  it('解析本应用原生格式（worldBookEntries 数组）并标记为 native', () => {
    const data = {
      worldBookEntries: [
        { uid: 1, key: ['魔法'], comment: 'A', content: '内容A', constant: false, order: 1, position: 'before_char' },
      ],
    };
    const result = parseWorldBookImport(data);
    expect(result.native).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ uid: 1, comment: 'A', position: 'before_char' });
  });

  it('解析站内通用格式：小写 entries + 对象值（SillyTavern 世界书）', () => {
    const data = {
      entries: {
        '0': { uid: 0, key: ['巴黎'], comment: '巴黎', content: '巴黎是……', constant: false, order: 100, position: 0 },
        '1': { uid: 1, key: [], comment: '世界观', content: '常驻设定', constant: true, order: 10, position: 1 },
      },
    };
    const result = parseWorldBookImport(data);
    expect(result.native).toBe(false);
    expect(result.entries).toHaveLength(2);
    // ST 数值 position 0 → before_char，其余 → after_char
    expect(result.entries[0]!.position).toBe('before_char');
    expect(result.entries[1]!.position).toBe('after_char');
    expect(result.entries[1]!.constant).toBe(true);
  });

  it('顶层键大小写不敏感：ENTRIES / Entries / WorldBookEntries 均可解析', () => {
    const mk = (key: string) => ({ [key]: [{ key: ['x'], content: 'y', constant: false }] });
    for (const key of ['ENTRIES', 'Entries', 'entries', 'WorldBookEntries', 'worldbookentries', 'Worldbook Entries', 'world_book_entries']) {
      const result = parseWorldBookImport(mk(key));
      expect(result.entries).toHaveLength(1);
      expect(result.native).toBe(false);
    }
  });

  it('解析角色卡内嵌世界书（data.character_book.entries）', () => {
    const data = {
      name: '角色卡',
      data: {
        character_book: {
          entries: [
            { keys: ['关键词'], content: '条目内容', constant: false, insertion_order: 5, insertion_position: 'before_char' },
          ],
        },
      },
    };
    const result = parseWorldBookImport(data);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ key: ['关键词'], content: '条目内容', order: 5, position: 'before_char' });
  });

  it('解析裸数组与纯字符串条目（字符串条目按常驻处理）', () => {
    const result = parseWorldBookImport(['第一条', '第二条']);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ constant: true, content: '第一条' });
  });

  it('跳过没有正文的条目', () => {
    const data = { entries: [{ key: ['x'], comment: '空条目' }, { key: ['y'], content: '有效' }] };
    const result = parseWorldBookImport(data);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.content).toBe('有效');
    expect(result.entries[0]!.comment).toBe('条目 2'); // 标题沿用原始下标
  });

  it('单条对象兜底：本身就是一条条目', () => {
    const result = parseWorldBookImport({ key: ['测试'], content: '单条内容', comment: '单条', constant: false });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.content).toBe('单条内容');
  });

  it('识别无效数据', () => {
    expect(parseWorldBookImport({ foo: 'bar' }).entries).toHaveLength(0);
    expect(parseWorldBookImport(null).entries).toHaveLength(0);
    expect(parseWorldBookImport('string').entries).toHaveLength(0);
  });

  it('归一化字段别名：keys / secondary_keys / exclude_key / disable', () => {
    const data = {
      entries: [{
        keys: ['主键'],
        secondary_keys: ['次键'],
        exclude_key: ['排除'],
        name: '条目名',
        text: '正文',
        enabled: false,
        selectiveLogic: 3,
      }],
    };
    const result = parseWorldBookImport(data);
    const entry = result.entries[0]!;
    expect(entry.key).toEqual(['主键']);
    expect(entry.keysecondary).toEqual(['次键']);
    expect(entry.exclude_key).toEqual(['排除']);
    expect(entry.comment).toBe('条目名');
    expect(entry.content).toBe('正文');
    expect(entry.disable).toBe(true);
    expect(entry.selectiveLogic).toBe(3);
  });
});

describe('mergeWorldBookEntries', () => {
  const existing: WorldBookEntryDef[] = [
    { uid: 1, key: ['旧'], comment: '旧条目', content: '旧内容', constant: false, order: 1 },
  ];

  it('原生格式按 uid 替换', () => {
    const parsed = parseWorldBookImport({
      worldBookEntries: [
        { uid: 1, key: ['新'], comment: '新条目', content: '新内容', constant: false, order: 1 },
        { uid: 2, key: [], comment: '新增', content: '新增内容', constant: true, order: 2 },
      ],
    });
    const { merged, added, replaced } = mergeWorldBookEntries(existing, parsed);
    expect(replaced).toBe(1);
    expect(added).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.comment).toBe('新条目');
  });

  it('外部格式 uid 冲突时重新分配，全部新增（不误替换现有条目）', () => {
    // SillyTavern 条目 uid 从 0/1 开始，容易和现有条目撞号
    const parsed = parseWorldBookImport({
      entries: { '0': { uid: 1, key: ['外部'], content: '外部内容', constant: false } },
    });
    const { merged, added, replaced } = mergeWorldBookEntries(existing, parsed);
    expect(replaced).toBe(0);
    expect(added).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.comment).toBe('旧条目'); // 原有条目未被覆盖
    expect(merged[1]!.uid).toBe(2); // 重新分配
  });
});
