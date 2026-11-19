import { useUITheme } from '../../hooks/useUITheme';

/**
 * Wording for the entry screens. The night theme speaks of star charts and
 * voyages; 晨雾琉璃 is a crystal palace, so its labels describe halls,
 * crystals and travel journals instead. Copy only: actions and data flow are
 * identical in both themes.
 */
export interface EntryLexicon {
  eyebrow: string;
  start: string;
  brand: string;
  hallLabel: string;
  navLabel: string;
  sectorNav: string;
  prevSector: string;
  nextSector: string;
  sector: (page: number, roman: string) => string;
  log: string;
  logKicker: string;
  logAria: (count: number) => string;
  back: string;
  locked: string;
  watching: string;
  pick: string;
  pickHint: string;
  emptySector: string;
  emptySectorHint: string;
  backHome: string;
  musicOn: string;
  musicOff: string;
  logEmpty: string;
}

const NIGHT: EntryLexicon = {
  eyebrow: 'ATLAS OF CROSSINGS · 万界航图',
  start: '点击任意处启航',
  brand: '万界航图',
  hallLabel: '万界星图',
  navLabel: '星图功能',
  sectorNav: '星区分页',
  prevSector: '上一星区',
  nextSector: '下一星区',
  sector: (page, roman) => (page === 0 ? '原初星区' : `拓界星区 ${roman}`),
  log: '航行日志',
  logKicker: 'VOYAGE LOG',
  logAria: count => `打开航行日志，已有 ${count} 段旅程`,
  back: '返回星图',
  locked: '已锁定航向',
  watching: '观测中',
  pick: '选择一个位面',
  pickHint: '点击透镜观测世界',
  emptySector: '本星区尚待开拓',
  emptySectorHint: '点击未知位面编织新世界',
  backHome: '返回标题',
  musicOn: '开启星图音乐',
  musicOff: '静音星图音乐',
  logEmpty: '回到星图选择一个位面，开启你的第一段旅程；也可以导入已有存档。',
};

const DAWN: EntryLexicon = {
  eyebrow: 'HALL OF CRYSTALS · 万界琉璃殿',
  start: '点击任意处入殿',
  brand: '万界琉璃殿',
  hallLabel: '万界琉璃殿',
  navLabel: '殿堂功能',
  sectorNav: '殿厅分页',
  prevSector: '上一殿厅',
  nextSector: '下一殿厅',
  sector: (page, roman) => (page === 0 ? '原初正殿' : `拓界偏殿 ${roman}`),
  log: '旅程手札',
  logKicker: 'TRAVEL JOURNAL',
  logAria: count => `打开旅程手札，已有 ${count} 段旅程`,
  back: '返回殿堂',
  locked: '已择定',
  watching: '凝视中',
  pick: '选择一个世界',
  pickHint: '触碰水晶，窥见世界',
  emptySector: '此殿尚有空座',
  emptySectorHint: '触碰空座，编织新世界',
  backHome: '返回殿门',
  musicOn: '开启殿堂音乐',
  musicOff: '静音殿堂音乐',
  logEmpty: '回到殿堂选择一个世界，开启你的第一段旅程；也可以导入已有存档。',
};

export function useEntryLexicon(): EntryLexicon {
  return useUITheme() === 'dawn' ? DAWN : NIGHT;
}
