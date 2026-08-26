import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InnateTalentDef, ProfessionDef, ProfessionModuleSchema } from '../../modules/schema';
import StepAbilityAlloc from './StepAbilityAlloc';
import { getTalentSelectionState } from './TalentCodexOverlay';
import TarotCard from './professionTarot/TarotCard';

const profession: ProfessionDef = {
  id: 'swordsman',
  name: '剑客',
  description: '以剑心立道。',
  archetype: '近战输出',
  abilities: [{ id: 'slash', name: '斩击', description: '快速出剑。', type: 'active', tier: 1 }],
};

describe('creation tarot UI contracts', () => {
  test('tarot cards expose the correct front and back faces to keyboard users', () => {
    const markup = renderToStaticMarkup(
      <TarotCard
        profession={profession}
        index={1}
        total={2}
        flipped={false}
        selected
        onFlip={() => undefined}
      />,
    );

    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="翻开剑客"');
    expect(markup).toContain('class="tarot-card__back"');
    expect(markup).toContain('class="tarot-card__face"');
    expect(markup).toContain('--tarot-index:1');
  });

  test('tarot fan drops its outer cards progressively below the centered card', () => {
    const edge = renderToStaticMarkup(
      <TarotCard profession={profession} index={0} total={3} flipped={false} selected={false} onFlip={() => undefined} />,
    );
    const nearCenter = renderToStaticMarkup(
      <TarotCard profession={profession} index={1} total={5} flipped={false} selected={false} onFlip={() => undefined} />,
    );
    const center = renderToStaticMarkup(
      <TarotCard profession={profession} index={1} total={3} flipped={false} selected={false} onFlip={() => undefined} />,
    );

    expect(edge).toContain('--tarot-lift:54px');
    expect(nearCenter).toContain('--tarot-lift:14px');
    expect(center).toContain('--tarot-lift:0px');
  });

  test('ability allocation covers base, six-dimension and special stats with safe steppers', () => {
    const statConfig = {
      attrA: { name: '生命', current: 80, max: 100 },
      attrB: { name: '灵力', current: 20, max: 100 },
      dim1: { name: '力量', value: 4, range: [0, 10] },
      dim2: { name: '体质', value: 4, range: [0, 10] },
      dim3: { name: '敏捷', value: 4, range: [0, 10] },
      dim4: { name: '智识', value: 4, range: [0, 10] },
      dim5: { name: '意志', value: 4, range: [0, 10] },
      dim6: { name: '感知', value: 4, range: [0, 10] },
      special: [{ id: 'luck', name: '命数', value: 2, range: [0, 5], description: '命运偏爱。' }],
    };
    const markup = renderToStaticMarkup(
      <StepAbilityAlloc
        statConfig={statConfig}
        allocations={{ attrA: 4 }}
        poolRemaining={0}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="减少生命"');
    expect(markup).toMatch(/aria-label="增加生命"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="减少灵力"[^>]*disabled=""/);
    expect(markup).toContain('感知');
    expect(markup).toContain('命数');
    expect(markup).toContain('class="alloc-track__mid"');
  });

  test('ability allocation previews negative and fractional bases without changing their scale', () => {
    const markup = renderToStaticMarkup(
      <StepAbilityAlloc
        statConfig={{ dim1: { name: '寒热', value: -10, range: [-10, 100] } }}
        allocations={{ dim1: 1 }}
        poolRemaining={1}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('aria-valuemin="-10"');
    expect(markup).toContain('aria-valuenow="-5"');
    expect(markup).toContain('-5<i>/100</i>');
  });

  test('talent direct selection reports divine, prerequisite, exclusion and balance gates', () => {
    const talents: InnateTalentDef[] = [
      { id: 'owned', name: '已有', description: '', cost: 1, exclusiveGroup: 'path' },
      { id: 'divine', name: '神技', description: '', cost: 99999 },
      { id: 'locked', name: '前置', description: '', cost: 1, prerequisites: ['missing'] },
      { id: 'exclusive', name: '互斥', description: '', cost: 1, exclusiveGroup: 'path' },
      { id: 'expensive', name: '昂贵', description: '', cost: 3 },
    ];
    const config: ProfessionModuleSchema = {
      professions: [],
      innateTalents: talents,
      creationTalentBudget: 0,
      allowNoProfession: true,
    };
    const state = (talent: InnateTalentDef) => getTalentSelectionState({
      config,
      talent,
      talentIds: ['owned'],
      remaining: 1,
      directCost: item => item.cost,
    });

    expect(state(talents[1]).reason).toContain('仅可抽取');
    expect(state(talents[2]).reason).toContain('前置');
    expect(state(talents[3]).reason).toContain('互斥');
    expect(state(talents[4]).reason).toContain('需要 3');
  });
});
