import { describe, expect, test } from 'bun:test';
import { generateModuleData, normalizeProgressionConfig, parseModuleJSON } from './buildPipeline';

describe('模块初始数据：生成 → 校验 → 修复', () => {
  const island = (resources: unknown[]) => JSON.stringify({ description: '荒岛', resources, rules: { cycleName: '一天', consumePerCycle: '每天 1 水', criticalThreshold: 2 } });
  const water = { id: 'water', name: '淡水', symbol: '💧', amount: 3, max: 10, scarce: true, description: '' };

  test('校验错误交回 AI 修一次，采用修好的版本', async () => {
    const calls: Array<Array<{ role: string; content: string }>> = [];
    const replies = [island([water, { ...water, name: '雨水' }]), island([water, { ...water, id: 'rain', name: '雨水' }])];
    const progress: string[] = [];
    const result = await generateModuleData<{ resources: Array<{ id: string }> }>('survival', '生成生存资源', async messages => { calls.push(messages); return replies.shift()!; }, (_stage, detail) => progress.push(detail));
    expect(result?.value.resources.map(item => item.id)).toEqual(['water', 'rain']);
    expect(result?.repaired).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].at(-1)?.content).toContain('resources[1].id：id「water」重复');
    expect(progress.some(line => line.includes('正在请 AI 修正'))).toBe(true);
  });

  test('格式两次都坏时返回空（调用方用默认值）；合格数据没有错误', async () => {
    expect(await generateModuleData('stat', '生成', async () => '抱歉，我无法生成')).toBeNull();
    const broken = JSON.stringify({ attrA: { name: '生命', max: 100 }, attrB: { name: '能量', max: 100 }, special: [] });
    const result = await generateModuleData('stat', '生成', async () => broken);
    expect(result?.issues.filter(issue => issue.level === 'error')).toEqual([]);
  });

  test('解析容忍代码块、尾逗号与全角结构引号；正文里的“”引用保持原样', () => {
    expect(parseModuleJSON('好的：\n```json\n{“a”: 1,}\n```')).toEqual({ a: 1 });
    expect(parseModuleJSON('{"description": "他说“快跑”。",}')).toEqual({ description: '他说“快跑”。' });
  });
});
import { normalizeModule } from './normalizeModule';
import type { ProgressionModuleSchema } from './schema';

describe('build pipeline progression normalization', () => {
  test('preserves generated caps and fills deterministic tier experience', () => {
    const raw = {
      mode: 'tiered',
      currentTierIndex: 0,
      currentXP: 0,
      xpFormula: { baseXP: 100, exponent: 2, scaleFactor: 1 },
      tiers: [
        { name: '初入江湖', description: '初学者', statBonuses: { attrAMax: 100, attrBMax: 90, dim1Max: 50, dim2Max: 50, dim3Max: 50, dim4Max: 50, dim5Max: 50, dim6Max: 50 } },
        { name: '小有名气', description: '已立足', statBonuses: { attrAMax: 150, attrBMax: 130, dim1Max: 70, dim2Max: 70, dim3Max: 70, dim4Max: 70, dim5Max: 70, dim6Max: 70 } },
      ],
    } as ProgressionModuleSchema;
    const config = normalizeProgressionConfig(raw);
    expect(config.tiers?.[0]).toMatchObject({ xpRequired: 0, statBonuses: { attrAMax: 100 } });
    expect(config.tiers?.[1]).toMatchObject({ xpRequired: 100, statBonuses: { attrAMax: 150 } });
  });

  test('repairs zeroed previous-version progression caps without rewriting current stat modules', () => {
    const config = normalizeProgressionConfig({
      mode: 'tiered',
      xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 },
      tiers: [
        { name: '一', description: '', xpRequired: 0, statBonuses: {} },
        { name: '二', description: '', xpRequired: 0, statBonuses: {} },
        { name: '三', description: '', xpRequired: 0, statBonuses: {} },
      ],
    } as ProgressionModuleSchema);
    expect(config.tiers?.map(tier => tier.xpRequired)).toEqual([0, 100, 300]);
    expect(config.tiers?.map(tier => tier.statBonuses?.attrAMax)).toEqual([100, 125, 156]);

    const stat = normalizeModule({
      moduleId: 'stat', name: '数值属性', enabled: true,
      moduleConfig: { attrA: { name: '生命', max: 100 } },
      initialState: { attrA: 80 },
    });
    expect(stat.moduleConfig).toMatchObject({ attrA: { name: '生命', max: 100 } });
    expect(stat.initialState).toEqual({ attrA: 80 });
  });
});
