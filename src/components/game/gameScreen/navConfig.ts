import { Home, User, Users, BookOpen, Settings, Layers, Brain, BookMarked, Globe, Package, Target } from 'lucide-react';
import type { NavButton, OverlayPanel, Screen } from './types';

export const navButtons: NavButton[] = [
  { id: 'home', icon: Home, labelKey: 'nav.home' },
  { id: 'profile', icon: User, labelKey: 'nav.profile' },
  { id: 'characters', icon: Users, labelKey: 'nav.characters' },
  { id: 'tasks', icon: Target, labelKey: 'nav.tasks' },
  { id: 'notebook', icon: BookOpen, labelKey: 'nav.chronicle' },
  { id: 'variables', icon: Layers, labelKey: 'nav.variables' },
  { id: 'worldbook', icon: BookMarked, labelKey: 'nav.worldbook' },
  { id: 'dynamics', icon: Globe, labelKey: 'nav.dynamics' },
  { id: 'memory', icon: Brain, labelKey: 'nav.memory' },
  { id: 'modules', icon: Package, labelKey: 'nav.modules' },
];

export interface MobileNavItem {
  id: string;
  icon: typeof Home;
  labelKey: string;
  action: () => void;
}

export function buildMobileNavItems(opts: {
  navigate: (screen: Screen) => void;
  setShowLeftOverlay: (v: boolean) => void;
  setMobileActivePanel: (panel: OverlayPanel) => void;
}): MobileNavItem[] {
  const { navigate, setShowLeftOverlay, setMobileActivePanel } = opts;
  const close = () => setShowLeftOverlay(false);
  return [
    { id: 'home', icon: Home, labelKey: 'nav.home', action: () => { close(); navigate('start'); } },
    { id: 'profile', icon: User, labelKey: 'nav.profile', action: () => { close(); setMobileActivePanel('profile'); } },
    { id: 'characters', icon: Users, labelKey: 'nav.characters', action: () => { close(); setMobileActivePanel('characters'); } },
    { id: 'tasks', icon: Target, labelKey: 'nav.tasks', action: () => { close(); setMobileActivePanel('tasks'); } },
    { id: 'notebook', icon: BookOpen, labelKey: 'nav.chronicle', action: () => { close(); setMobileActivePanel('notebook'); } },
    { id: 'variables', icon: Layers, labelKey: 'nav.variables', action: () => { close(); setMobileActivePanel('variables'); } },
    { id: 'worldbook', icon: BookMarked, labelKey: 'nav.worldbook', action: () => { close(); setMobileActivePanel('worldbook'); } },
    { id: 'dynamics', icon: Globe, labelKey: 'nav.dynamics', action: () => { close(); setMobileActivePanel('dynamics'); } },
    { id: 'memory', icon: Brain, labelKey: 'nav.memory', action: () => { close(); setMobileActivePanel('memory'); } },
    { id: 'modules', icon: Package, labelKey: 'nav.modules', action: () => { close(); setMobileActivePanel('modules'); } },
    { id: 'settings', icon: Settings, labelKey: 'nav.settings', action: () => { close(); navigate('settings'); } },
  ];
}
