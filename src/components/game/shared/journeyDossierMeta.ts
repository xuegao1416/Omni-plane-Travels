export type DossierPanelId =
  | 'profile' | 'relations' | 'tasks' | 'chronicle' | 'variables'
  | 'worldbook' | 'dynamics' | 'memory' | 'modules' | 'settings'
  | 'empty' | 'error';

export interface DossierPanelMeta {
  title: string;
  subtitle: string;
  emblemSrc?: string;
}

export const DOSSIER_META: Record<DossierPanelId, DossierPanelMeta> = {
  profile: { title: '人物档案', subtitle: '身份、能力与随身行囊', emblemSrc: '/art/theme/emblems/emblem-25-v2.png' },
  relations: { title: '角色关系', subtitle: '同行者、阵营与互动记录', emblemSrc: '/art/theme/emblems/emblem-17-v2.png' },
  tasks: { title: '任务卷宗', subtitle: '目标、阶段与可领取回报', emblemSrc: '/art/theme/emblems/emblem-11-v2.png' },
  chronicle: { title: '旅途纪事', subtitle: '按时间整理的世界日志', emblemSrc: '/art/theme/emblems/emblem-16-v2.png' },
  variables: { title: '变量档案', subtitle: '玩家、世界与资源状态', emblemSrc: '/art/theme/emblems/emblem-08-v2.png' },
  worldbook: { title: '世界书', subtitle: '条目、目录与启用状态', emblemSrc: '/art/theme/emblems/emblem-07-v2.png' },
  dynamics: { title: '世界动态', subtitle: '时间流、状态轴与最近变化', emblemSrc: '/art/theme/emblems/emblem-20-v2.png' },
  memory: { title: '记忆回廊', subtitle: '长期、短期与关键记忆', emblemSrc: '/art/theme/emblems/emblem-24-v2.png' },
  modules: { title: '本局模块', subtitle: '只影响当前旅程的启用开关', emblemSrc: '/art/theme/emblems/emblem-13-v2.png' },
  settings: { title: '旅途设置', subtitle: '主题、文字、显示与生成偏好', emblemSrc: '/art/theme/emblems/emblem-26-v2.png' },
  empty: { title: '空卷宗', subtitle: '这里暂时没有可展示的旅途记录', emblemSrc: '/art/theme/emblems/emblem-05-v2.png' },
  error: { title: '卷宗读取失败', subtitle: '可以重试或关闭当前卷宗', emblemSrc: '/art/theme/emblems/emblem-09-v2.png' },
};

export const DOSSIER_ALIASES: Record<string, DossierPanelId> = {
  characters: 'relations',
  notebook: 'chronicle',
};

export function normalizeDossierPanel(value: string | null | undefined): DossierPanelId {
  const key = (value ?? '').trim().toLowerCase();
  const normalized = DOSSIER_ALIASES[key] ?? key;
  return normalized in DOSSIER_META ? normalized as DossierPanelId : 'error';
}
