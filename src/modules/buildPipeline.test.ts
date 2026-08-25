import { describe, expect, test } from 'bun:test';
import { normalizeProgressionConfig } from './buildPipeline';
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

  test('repairs zeroed legacy caps cumulatively without corrupting stat modules', () => {
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
      data: { attrA: { name: '生命', current: 80, max: 100 } },
    } as any);
    expect(stat.moduleConfig).toMatchObject({ attrA: { name: '生命', max: 100 } });
    expect(stat.moduleConfig).not.toHaveProperty('mode');
  });
});
