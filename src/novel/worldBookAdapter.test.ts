import { describe, expect, test } from 'bun:test';
import { buildNovelWorldBookEntries, identifyLegacyNovelEntries, mergeNovelWorldBookEntries } from './worldBookAdapter';
import { parseWorldBookImport } from '../utils/worldBookImport';
import { scanWorldInfo } from '../worldbook/worldInfoEngine';

describe('novel world-book adapter', () => {
  test('round-trips provenance and activates only matching native archives', () => {
    const source = { datasetId: 'roundtrip', analysisVersion: 3 };
    const entries = buildNovelWorldBookEntries({ summary: '荒野世界', items: [{ id: 'sword', name: '旧剑', aliases: ['照夜'], description: '物品档案' }, { id: 'ring', name: '银环', description: '戒指档案' }] }, 1, source);
    const imported = parseWorldBookImport(JSON.parse(JSON.stringify({ worldBookEntries: entries }))).entries;
    expect(imported[1]?.novelProvenance).toEqual(entries[1]?.novelProvenance);
    const activated = scanWorldInfo([], { entries: imported.map(entry => ({ ...entry, uid: String(entry.uid), position: 0 })) }, '我举起照夜');
    expect(activated.some(entry => entry.comment === '旧剑')).toBe(true);
    expect(activated.some(entry => entry.comment === '银环')).toBe(false);
    const next = buildNovelWorldBookEntries({ items: [{ id: 'sword', name: '旧剑', description: '更新档案' }] }, 10, source);
    expect(mergeNovelWorldBookEntries(imported, next).find(entry => entry.comment === '旧剑')?.content).toContain('更新档案');
  });
  test('uses stable entity identities across renames and exposes manual conflicts', () => {
    const source = { datasetId: 'stable', analysisVersion: 3 };
    const original = buildNovelWorldBookEntries({ items: [{ id: 'item-1', name: '旧名', description: '旧描述' }] }, 1, source);
    const next = buildNovelWorldBookEntries({ items: [{ id: 'item-1', name: '新名', description: '新描述' }] }, 2, source);
    expect(mergeNovelWorldBookEntries(original, next)).toHaveLength(1);
    expect(mergeNovelWorldBookEntries(original, next)[0]?.comment).toBe('新名');
    const edited = [{ ...original[0]!, content: '手工内容' }];
    expect(mergeNovelWorldBookEntries(edited, next)[0]?.novelProvenance?.reviewStatus).toBe('manual_conflict');
    expect(mergeNovelWorldBookEntries(original, [])[0]?.novelProvenance?.reviewStatus).toBe('missing_from_regeneration');
  });

  test('keeps large details keyword-triggered and limits resident context without dropping facts', () => {
    const rules = Array.from({ length: 50 }, (_, i) => `规则${i}：${'此规则的完整说明。'.repeat(30)}`);
    const entries = buildNovelWorldBookEntries({ summary: '世界。'.repeat(1000), rules, settings: ['背景详情'], relations: ['某人属于某城'], highlights: ['特色'] }, 1);
    expect(entries.filter(entry => entry.constant).reduce((sum, entry) => sum + entry.content.length, 0)).toBeLessThan(4000);
    for (const rule of rules) expect(entries.some(entry => entry.content.includes(rule))).toBe(true);
  });
  test('keeps world rules resident and named archives keyword-triggered', () => {
    const entries = buildNovelWorldBookEntries({
      summary: '浮空城邦围绕古代能源遗迹展开竞争。',
      rules: ['能量耗尽前不得连续启动跃迁装置。'],
      factions: [{ name: '北岸议会', description: '管理浮空港口的议事组织。' }],
      characters: [{ name: '洛安', role: '调查员', description: '正在追查能源遗迹的去向。' }],
    }, 700);

    expect(entries).toHaveLength(4);
    expect(entries.find(entry => entry.entryType === 'rules')).toMatchObject({ constant: true, key: [] });
    expect(entries.find(entry => entry.comment === '北岸议会')).toMatchObject({
      constant: false,
      key: ['北岸议会'],
      entryType: 'factions',
      meta: { factions: [{ name: '北岸议会', description: '管理浮空港口的议事组织。' }] },
    });
    expect(entries.find(entry => entry.comment === '洛安')).toMatchObject({
      key: ['洛安'],
      entryType: 'npcs',
      meta: { npcs: [{ name: '洛安', role: '调查员', description: '正在追查能源遗迹的去向。' }] },
    });
  });

  test('compiles optional culture, economy, highlights and important items into native entry types', () => {
    const entries = buildNovelWorldBookEntries({
      items: [{ name: '照夜令', description: '可以调动北境驿骑的旧王信物。' }],
      culture: ['北境以冬至盟誓确认封臣关系。'],
      highlights: ['旧王遗产争夺', '严寒边境求生'],
      economy: { currencyName: '雪铢', currencySymbol: '❄', priceLevel: '物资紧缺', calendar: '北境历' },
    }, 800);

    expect(entries.map(entry => entry.entryType)).toEqual(['items', 'economy', 'culture', 'highlights']);
    expect(entries.find(entry => entry.entryType === 'economy')?.meta).toMatchObject({
      currency: { name: '雪铢', symbol: '❄' },
      priceLevel: '物资紧缺',
      calendar: '北境历',
    });
  });

  test('keeps chronology out of world books and writes usable rules metadata', () => {
    const entries = buildNovelWorldBookEntries({ rules: ['施法消耗生命'], powerSystem: '符文施法', events: [{ name: '夺剑', description: '主角得到宝剑' }] }, 1);
    expect(entries.some(entry => entry.entryType === 'events')).toBe(false);
    expect(entries[0]?.meta).toEqual({ specialRules: ['施法消耗生命'], powerSystem: '符文施法' });
  });

  test('regenerates only unchanged generated entries and preserves manual edits', () => {
    const original = buildNovelWorldBookEntries({ rules: ['旧规则'], items: [{ name: '剑', description: '旧描述' }] }, 1, { datasetId: 'novel', analysisVersion: 2 });
    const edited = original.map(entry => entry.entryType === 'items' ? { ...entry, content: '玩家手工描述' } : entry);
    const next = buildNovelWorldBookEntries({ rules: ['新规则'], items: [{ name: '剑', description: '新描述' }] }, 20, { datasetId: 'novel', analysisVersion: 2 });
    const merged = mergeNovelWorldBookEntries([...edited, { ...original[0]!, uid: 99, novelProvenance: undefined, content: '手工规则' }], next);
    expect(merged.find(entry => entry.uid === original[0]!.uid)?.content).toContain('新规则');
    expect(merged.find(entry => entry.entryType === 'items')?.content).toBe('玩家手工描述');
    expect(merged.some(entry => entry.content === '手工规则')).toBe(true);
  });

  test('upgrades exactly matching legacy items without globally deleting events', () => {
    const previous = { items: [{ name: '剑', description: '宝剑' }], events: [{ name: '夺剑', description: '获得宝剑' }] };
    const generatedItem = buildNovelWorldBookEntries(previous, 1)[0]!;
    const oldItem = { ...generatedItem, entryType: 'lore' as const };
    const oldEvent = { uid: 2, key: ['夺剑'], comment: '夺剑', content: '【原著事件】夺剑\n获得宝剑', constant: false, order: 200, position: 'before_char' as const, entryType: 'events' as const };
    const manualEvent = { ...oldEvent, uid: 3, content: '手工剧情' };
    const upgraded = identifyLegacyNovelEntries([oldItem, oldEvent, manualEvent], previous, 'novel');
    expect(upgraded).toHaveLength(2);
    expect(upgraded[0]?.novelProvenance?.sourceKey).toBe('items:剑');
    expect(upgraded[1]?.content).toBe('手工剧情');
  });
});
