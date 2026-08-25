/**
 * 主题徽章图鉴（对应 public/art/theme/emblems/emblem-01..60-v2.png）。
 *
 * 这里集中维护“编号 → 语义”，避免把默认世界徽章（18）误当成职业、设置等
 * 功能入口。素材文件名保留编号以兼容已有存档与布局配置，界面只通过本表取用。
 */
export interface ThemeEmblemDefinition {
  id: number;
  name: string;
  file: string;
}

const EMBLEM_NAMES = [
  '法院/圣堂', '城市', '山水亭台', '荒漠碉堡', '椰林海浪', '十字路口', '星芒书册', '分支网络',
  '警示', '搜索', '目标旗帜', '沙漏', '模块', '调音台设置', '未知徽章', '典藏书册', '人物', '默认世界',
  '神道', '指南针', '右返回', '宝箱', '碎片', '漩涡', '头像框', '设置', '左返回', '关闭', '搜索镜',
  '法槌', '湖泊透镜', '羽笔与面具', '冒险者公会', '地图', '王冠旗帜', '三人关系', '面具与宝箱', '天秤',
  '时钟', '时钟·刻度', '蓝色宝石', '财富天秤', '法官木槌', '烛火徽章', '皇冠高塔', '爪印徽章', '天气',
  '收获', '飞艇', '信号塔', '望远镜', '钥匙之眼', '握手', '裂盾', '火山', '和平鸽', '城堡', '森林', '海洋', '星空',
] as const;

export const THEME_EMBLEMS: readonly ThemeEmblemDefinition[] = EMBLEM_NAMES.map((name, index) => ({
  id: index + 1,
  name,
  file: `/art/theme/emblems/emblem-${String(index + 1).padStart(2, '0')}-v2.png`,
}));

export function themeEmblem(id: number): string {
  return THEME_EMBLEMS[id - 1]?.file ?? THEME_EMBLEMS[17].file;
}

