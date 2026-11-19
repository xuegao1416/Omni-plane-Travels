/**
 * Picks a battlefield scene from what a world says about itself (name, tags,
 * description). No world ids are hard-coded, so custom worlds get a fitting
 * scene too; anything unrecognised falls back to a neutral twilight field.
 */
export type BattleSceneId = 'ink' | 'ruins' | 'city' | 'wilds' | 'castle' | 'void' | 'dusk';

export interface BattleWorldHint {
  name?: string;
  tags?: string[];
  description?: string;
}

const RULES: { scene: BattleSceneId; words: string[] }[] = [
  { scene: 'ink', words: ['武侠', '仙侠', '修仙', '修真', '江湖', '古风', '古代', '宫廷', '朝堂', '王朝', '三国', '东方玄幻', '玄幻', '侠', '宗门', '门派', '剑客', '国风', '水墨', '仙', '妖', '道观', '唐', '宋', '明朝', '清朝', '战国', '秦', '汉'] },
  { scene: 'ruins', words: ['末日', '废土', '丧尸', '辐射', '灾变', '核', '后启示录', '变异', '废墟', '生化', '天灾'] },
  { scene: 'void', words: ['星际', '太空', '宇宙', '星舰', '机甲', '外星', '银河', '科幻', '赛博', '义体', '未来'] },
  { scene: 'castle', words: ['奇幻', '魔法', '西幻', '骑士', '中世纪', '龙', '精灵', '矮人', '巫师', '魔王', '剑与魔法', '王国', '地下城'] },
  { scene: 'wilds', words: ['荒岛', '荒野', '丛林', '森林', '野外', '海岛', '原始', '部落', '求生', '冒险', '探险', '山林'] },
  { scene: 'city', words: ['都市', '现代', '城市', '职场', '商战', '黑帮', '街头', '霓虹', '校园', '年代', '贸易', '边境', '纸醉金迷', '警', '豪门'] },
];

export function resolveBattleScene(world?: BattleWorldHint | null): BattleSceneId {
  if (!world) return 'dusk';
  const tagText = (world.tags ?? []).filter(tag => typeof tag === 'string').join(' ');
  const sources = [
    { text: `${tagText} ${world.name ?? ''}`, weight: 3 },
    { text: world.description ?? '', weight: 1 },
  ];
  let best: BattleSceneId = 'dusk';
  let bestScore = 0;
  for (const rule of RULES) {
    let score = 0;
    for (const { text, weight } of sources) {
      if (!text) continue;
      for (const word of rule.words) if (text.includes(word)) score += weight * (word.length > 1 ? 2 : 1);
    }
    if (score > bestScore) { best = rule.scene; bestScore = score; }
  }
  return best;
}
