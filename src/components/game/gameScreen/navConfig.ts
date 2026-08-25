import { Home, User, Users, Settings, Layers, Brain, Globe, Package, Target, Swords, ScrollText, Map } from 'lucide-react';
import type { NavButton, OverlayPanel, Screen } from './types';
import { themeEmblem } from '../../../data/themeEmblemCatalog';

export const navButtons: NavButton[] = [
  { id: 'home', icon: Home, labelKey: 'nav.home', emblemSrc: '/art/theme/emblems/emblem-27-v2.png' },
  { id: 'profile', icon: User, labelKey: 'nav.profile', emblemSrc: '/art/theme/emblems/emblem-25-v2.png' },
  { id: 'characters', icon: Users, labelKey: 'nav.characters', emblemSrc: '/art/theme/emblems/emblem-17-v2.png' },
  { id: 'tasks', icon: Target, labelKey: 'nav.tasks', emblemSrc: '/art/theme/emblems/emblem-11-v2.png' },
  { id: 'profession', icon: Swords, labelKey: 'nav.profession', emblemSrc: themeEmblem(33) },
  { id: 'notebook', icon: ScrollText, labelKey: 'nav.chronicle', emblemSrc: themeEmblem(32) },
  { id: 'variables', icon: Layers, labelKey: 'nav.variables', emblemSrc: '/art/theme/emblems/emblem-08-v2.png' },
  { id: 'worldbook', icon: Map, labelKey: 'nav.worldbook', emblemSrc: themeEmblem(34) },
  { id: 'dynamics', icon: Globe, labelKey: 'nav.dynamics', emblemSrc: '/art/theme/emblems/emblem-20-v2.png' },
  { id: 'memory', icon: Brain, labelKey: 'nav.memory', emblemSrc: '/art/theme/emblems/emblem-24-v2.png' },
  { id: 'modules', icon: Package, labelKey: 'nav.modules', emblemSrc: '/art/theme/emblems/emblem-13-v2.png' },
];

const NAV_LABELS: Record<string, string> = {
  home: '返回旅庭',
  profile: '人物档案',
  characters: '角色关系',
  tasks: '任务',
  profession: '职业',
  notebook: '纪事',
  variables: '变量',
  worldbook: '世界书',
  dynamics: '世界动态',
  memory: '记忆',
  modules: '模块',
  settings: '设置',
};

export function getNavLabel(id: string): string {
  return NAV_LABELS[id] ?? id;
}

export interface MobileNavItem {
  id: string;
  icon: typeof Home;
  labelKey: string;
  action: () => void;
  emblemSrc?: string;
}

export function buildMobileNavItems(opts: {
  navigate: (screen: Screen) => void;
  setShowLeftOverlay: (v: boolean) => void;
  setMobileActivePanel: (panel: OverlayPanel) => void;
}): MobileNavItem[] {
  const { navigate, setShowLeftOverlay, setMobileActivePanel } = opts;
  const close = () => setShowLeftOverlay(false);
  return [
    { id: 'home', icon: Home, labelKey: 'nav.home', emblemSrc: '/art/theme/emblems/emblem-27-v2.png', action: () => { close(); navigate('start'); } },
    { id: 'profile', icon: User, labelKey: 'nav.profile', emblemSrc: '/art/theme/emblems/emblem-25-v2.png', action: () => { close(); setMobileActivePanel('profile'); } },
    { id: 'characters', icon: Users, labelKey: 'nav.characters', emblemSrc: '/art/theme/emblems/emblem-17-v2.png', action: () => { close(); setMobileActivePanel('characters'); } },
    { id: 'tasks', icon: Target, labelKey: 'nav.tasks', emblemSrc: '/art/theme/emblems/emblem-11-v2.png', action: () => { close(); setMobileActivePanel('tasks'); } },
    { id: 'profession', icon: Swords, labelKey: 'nav.profession', emblemSrc: themeEmblem(33), action: () => { close(); setMobileActivePanel('profession'); } },
    { id: 'notebook', icon: ScrollText, labelKey: 'nav.chronicle', emblemSrc: themeEmblem(32), action: () => { close(); setMobileActivePanel('notebook'); } },
    { id: 'variables', icon: Layers, labelKey: 'nav.variables', emblemSrc: '/art/theme/emblems/emblem-08-v2.png', action: () => { close(); setMobileActivePanel('variables'); } },
    { id: 'worldbook', icon: Map, labelKey: 'nav.worldbook', emblemSrc: themeEmblem(34), action: () => { close(); setMobileActivePanel('worldbook'); } },
    { id: 'dynamics', icon: Globe, labelKey: 'nav.dynamics', emblemSrc: '/art/theme/emblems/emblem-20-v2.png', action: () => { close(); setMobileActivePanel('dynamics'); } },
    { id: 'memory', icon: Brain, labelKey: 'nav.memory', emblemSrc: '/art/theme/emblems/emblem-24-v2.png', action: () => { close(); setMobileActivePanel('memory'); } },
    { id: 'modules', icon: Package, labelKey: 'nav.modules', emblemSrc: '/art/theme/emblems/emblem-13-v2.png', action: () => { close(); setMobileActivePanel('modules'); } },
    { id: 'settings', icon: Settings, labelKey: 'nav.settings', emblemSrc: '/art/theme/emblems/emblem-26-v2.png', action: () => { close(); navigate('settings'); } },
  ];
}
