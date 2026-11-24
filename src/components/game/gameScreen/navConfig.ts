import { Compass,UserRound,Users,Target,Swords,ScrollText,Variable,LibraryBig,Clapperboard,Brain,Puzzle,Settings2,Map as MapIcon } from 'lucide-react';
import type { NavButton,OverlayPanel } from './types';

/** Instrument rail: one entry per dossier, plus the way back to the orrery. */
export const navButtons: NavButton[] = [
  { id: 'home', icon: Compass, labelKey: 'nav.home' },
  { id: 'profile', icon: UserRound, labelKey: 'nav.profile' },
  { id: 'map', icon: MapIcon, labelKey: 'nav.map' },
  { id: 'characters', icon: Users, labelKey: 'nav.characters' },
  { id: 'tasks', icon: Target, labelKey: 'nav.tasks' },
  { id: 'profession', icon: Swords, labelKey: 'nav.profession' },
  { id: 'notebook', icon: ScrollText, labelKey: 'nav.chronicle' },
  { id: 'variables', icon: Variable, labelKey: 'nav.variables' },
  { id: 'worldbook', icon: LibraryBig, labelKey: 'nav.worldbook' },
  { id: 'dynamics', icon: Clapperboard, labelKey: 'nav.dynamics' },
  { id: 'memory', icon: Brain, labelKey: 'nav.memory' },
  { id: 'modules', icon: Puzzle, labelKey: 'nav.modules' },
];

const NAV_LABELS: Record<string, string> = {
  home: '返回星图',
  profile: '人物档案',
  map: '地图',
  characters: '角色关系',
  tasks: '任务',
  profession: '职业',
  notebook: '纪事',
  variables: '变量',
  worldbook: '世界书',
  dynamics: '剧情导演',
  memory: '记忆',
  modules: '模块',
  settings: '设置',
};

export function getNavLabel(id: string): string {
  return NAV_LABELS[id] ?? id;
}

export interface MobileNavItem {
  id: string;
  icon: typeof Compass;
  labelKey: string;
  action: () => void;
}

export function buildMobileNavItems(opts: {
  navigate: (screen: 'start' | 'settings') => void;
  setShowLeftOverlay: (v: boolean) => void;
  setMobileActivePanel: (panel: OverlayPanel) => void;
}): MobileNavItem[] {
  const { navigate, setShowLeftOverlay, setMobileActivePanel } = opts;
  const close = () => setShowLeftOverlay(false);
  const panels = navButtons
    .filter((button): button is NavButton & { id: Exclude<OverlayPanel, null> } => button.id !== 'home' && button.id !== null)
    .map(button => ({ id: button.id, icon: button.icon, labelKey: button.labelKey, action: () => { close(); setMobileActivePanel(button.id); } }));
  return [
    { id: 'home', icon: Compass, labelKey: 'nav.home', action: () => { close(); navigate('start'); } },
    ...panels,
    { id: 'settings', icon: Settings2, labelKey: 'nav.settings', action: () => { close(); navigate('settings'); } },
  ];
}
