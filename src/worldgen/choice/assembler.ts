// 选择式世界生成管线 — 选择结果组装器
// 将用户在各维度的选择组装为 WorldBookEntryDef[]
// ============================================================

import type { WorldBookEntryDef } from '../../data/worlds-schema';
import type { WorldSkeleton } from '../types';
import type { DimensionSelection } from './types';

/**
 * 从选择结果和骨架组装世界书条目
 */
export function assembleFromChoices(
  selections: DimensionSelection[],
  skeleton: WorldSkeleton,
): WorldBookEntryDef[] {
  const entries: WorldBookEntryDef[] = [];
  let uid = 1;

  const getSelection = (key: string) => selections.find(s => s.dimensionKey === key);

  /**
   * 获取维度的所有选择（支持多选）
   * 如果有 choices 数组则返回所有选择，否则返回 [choice]
   */
  const getChoices = (sel: DimensionSelection | undefined) => {
    if (!sel) return [];
    return sel.choices && sel.choices.length > 0 ? sel.choices : [sel.choice];
  };

  // ── 1. setting 条目（基调 + 骨架概述）──
  const tone = getSelection('tone');
  const toneChoices = getChoices(tone);
  const settingContent = [
    skeleton.overview,
    toneChoices.length > 0
      ? `\n【基调】${toneChoices.map(c => `${c.title}：${c.subtitle}`).join('、')}`
      : '',
  ].filter(Boolean).join('');
  entries.push({
    uid: uid++, key: [], constant: true, comment: '世界设定',
    content: settingContent, order: 1, position: 'before_char', entryType: 'setting',
    meta: {
      atmosphere: tone?.choice.title || undefined,
      timePeriod: skeleton.timePeriod || undefined,
    },
  });

  // ── 2. lore 条目（地理选择，支持多选）──
  const geo = getSelection('geography');
  const geoChoices = getChoices(geo);
  for (const choice of geoChoices) {
    entries.push({
      uid: uid++, key: [choice.title], constant: false,
      comment: choice.title, content: choice.subtitle,
      order: 2, position: 'before_char', entryType: 'lore',
    });
  }

  // ── 3. factions 条目（势力选择，支持多选，关键词触发）──
  const factions = getSelection('factions');
  const factionsChoices = getChoices(factions);
  for (const choice of factionsChoices) {
    entries.push({
      uid: uid++, key: [choice.title], constant: false, comment: choice.title,
      content: `${choice.title}：${choice.subtitle}`,
      order: 3, position: 'before_char', entryType: 'factions',
      meta: {
        factions: [{
          name: choice.title,
          description: choice.subtitle,
          alignment: '中立',
        }],
      },
    });
  }

  // ── 4. culture 条目（文化选择，支持多选）──
  const culture = getSelection('culture');
  const cultureChoices = getChoices(culture);
  if (cultureChoices.length > 0) {
    entries.push({
      uid: uid++, key: ['文化', '风俗'], constant: false,
      comment: '文化风俗',
      content: cultureChoices.map(c => `${c.title}：${c.subtitle}`).join('\n'),
      order: 4, position: 'before_char', entryType: 'culture',
    });
  }

  // ── 5. economy 条目（经济选择）──
  const economy = getSelection('economy');
  if (economy) {
    entries.push({
      uid: uid++, key: ['货币', '经济', '消费'], constant: false,
      comment: '经济系统', content: `${economy.choice.title}：${economy.choice.subtitle}`,
      order: 5, position: 'before_char', entryType: 'economy',
    });
  }

  // ── 6. npcs 条目（NPC选择，支持多选，关键词触发）──
  const npcs = getSelection('npcs');
  const npcsChoices = getChoices(npcs);
  for (const choice of npcsChoices) {
    entries.push({
      uid: uid++, key: [choice.title], constant: false, comment: choice.title,
      content: `${choice.title}：${choice.subtitle}`,
      order: 6, position: 'before_char', entryType: 'npcs',
      meta: {
        npcs: [{
          name: choice.title,
          role: '关键人物',
          description: choice.subtitle,
        }],
      },
    });
  }

  // ── 7. rules 条目（规则选择）──
  const rules = getSelection('rules');
  if (rules) {
    entries.push({
      uid: uid++, key: [], constant: true, comment: '世界规则',
      content: `${rules.choice.title}：${rules.choice.subtitle}`,
      order: 7, position: 'before_char', entryType: 'rules',
      meta: {
        powerSystem: rules.choice.title,
        specialRules: [rules.choice.subtitle],
      },
    });
  }

  // ── 8. highlights 条目（从骨架提取）──
  if (skeleton.tags && skeleton.tags.length > 0) {
    entries.push({
      uid: uid++, key: [], constant: true, comment: '核心特色',
      content: skeleton.tags.join('、'),
      order: 8, position: 'before_char', entryType: 'highlights',
      meta: { highlights: skeleton.tags },
    });
  }

  return entries;
}
