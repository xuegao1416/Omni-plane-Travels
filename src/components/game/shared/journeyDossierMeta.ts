import type { LucideIcon } from 'lucide-react';
import { UserRound,Users,Target,Swords,ScrollText,Variable,LibraryBig,Clapperboard,Brain,Puzzle,Settings2,FileQuestion,TriangleAlert,Map as MapIcon } from 'lucide-react';

export type DossierPanelId =
  | 'profile' | 'relations' | 'tasks' | 'chronicle' | 'variables'
  | 'worldbook' | 'dynamics' | 'memory' | 'modules' | 'settings'
  | 'profession' | 'map'
  | 'empty' | 'error';

export interface DossierPanelMeta {
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export const DOSSIER_META: Record<DossierPanelId, DossierPanelMeta> = {
  profile: { title: '人物档案', subtitle: '身份、能力与随身行囊', icon: UserRound },
  map: { title: '世界舆图', subtitle: '当前位置、已知地点与赶路路线', icon: MapIcon },
  relations: { title: '角色关系', subtitle: '同行者、阵营与互动记录', icon: Users },
  tasks: { title: '任务卷宗', subtitle: '目标、阶段与可领取回报', icon: Target },
  profession: { title: '职业', subtitle: '按四阶道路查看前置关系与已掌握能力', icon: Swords },
  chronicle: { title: '旅途纪事', subtitle: '按时间整理的世界日志', icon: ScrollText },
  variables: { title: '变量档案', subtitle: '玩家、世界与资源状态', icon: Variable },
  worldbook: { title: '世界书', subtitle: '条目、目录与启用状态', icon: LibraryBig },
  dynamics: { title: '剧情导演', subtitle: '剧情计划、落实回执与幕后发展', icon: Clapperboard },
  memory: { title: '记忆回廊', subtitle: '长期、短期与关键记忆', icon: Brain },
  modules: { title: '本局模块', subtitle: '只影响当前旅程的启用开关', icon: Puzzle },
  settings: { title: '旅途设置', subtitle: '主题、文字、显示与生成偏好', icon: Settings2 },
  empty: { title: '空卷宗', subtitle: '这里暂时没有可展示的旅途记录', icon: FileQuestion },
  error: { title: '卷宗读取失败', subtitle: '可以重试或关闭当前卷宗', icon: TriangleAlert },
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
