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

  it('constant=true + 有关键词 → 无视关键词常驻注入（对齐 SillyTavern 语义）', () => {
    const entries: WorldInfoEntry[] = [
      entry({ uid: 'a', content: '世界法则', key: ['未出现的关键词'], constant: true }),
    ];
    // 扫描文本不含关键词，但 constant=true 仍注入
    expect(scanWorldInfo([], { entries }, '毫无相关的文本')).toHaveLength(1);
  });

  it('constant=true + selective 次级关键词 → 次级门控被跳过', () => {
    const entries: WorldInfoEntry[] = [
      entry({
        uid: 'a',
        content: '常驻法则',
        key: ['主线'],
        constant: true,
        selective: true,
        keysecondary: ['从未出现的次级词'],
      }),
    ];
    expect(scanWorldInfo([], { entries }, '主线剧情开始了')).toHaveLength(1);
  });

  it('exclude_key 排除关键词对 constant 条目仍生效（安全兜底）', () => {
    const entries: WorldInfoEntry[] = [
      entry({ uid: 'a', content: '常驻设定', key: [], constant: true, exclude_key: ['关闭'] }),
    ];
    expect(scanWorldInfo([], { entries }, '关闭')).toHaveLength(0);
    expect(scanWorldInfo([], { entries }, '正常文本')).toHaveLength(1);
  });
});
