import { describe, it, expect } from 'bun:test';
import { scanWorldInfo, type WorldInfoEntry } from './worldInfoEngine';

function entry(partial: Partial<WorldInfoEntry> & { content: string }): WorldInfoEntry {
  return { ...partial };
}

describe('scanWorldInfo 无关键词条目的注入语义', () => {
  it('无关键词 + constant=true → 常驻注入', () => {
    const activated = scanWorldInfo([], {
      entries: [entry({ uid: 'a', content: '常驻设定', constant: true, key: [] })],
    }, '');
    expect(activated).toHaveLength(1);
    expect(activated[0]!.content).toBe('常驻设定');
  });

  it('无关键词 + constant=false → 不注入（修复：此前会全量注入）', () => {
    const entries: WorldInfoEntry[] = [
      entry({ uid: 'a', content: '不该出现的条目1', constant: false, key: [] }),
      entry({ uid: 'b', content: '不该出现的条目2', constant: false, key: [] }),
    ];
    const activated = scanWorldInfo([], { entries }, '');
    expect(activated).toHaveLength(0);
  });

  it('有关键词 → 必须命中才注入（关键词未出现时不注入）', () => {
    const entries: WorldInfoEntry[] = [
      entry({ uid: 'a', content: '巴黎设定', key: ['巴黎'], constant: false }),
    ];
    expect(scanWorldInfo([], { entries }, '今天天气不错')).toHaveLength(0);
    expect(scanWorldInfo([], { entries }, '我来到了巴黎')).toHaveLength(1);
  });

  it('扫描最近聊天历史中的关键词', () => {
    const entries: WorldInfoEntry[] = [
      entry({ uid: 'a', content: '巴黎设定', key: ['巴黎'], constant: false }),
    ];
    const history = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '我昨天去了巴黎' },
    ];
    expect(scanWorldInfo(history, { entries }, '今天呢')).toHaveLength(1);
  });

  it('禁用条目不注入', () => {
    const entries: WorldInfoEntry[] = [
      entry({ uid: 'a', content: '常驻', constant: true, key: [], disable: true }),
    ];
    expect(scanWorldInfo([], { entries }, '')).toHaveLength(0);
  });
});
