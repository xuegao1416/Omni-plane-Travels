import type { LucideIcon } from 'lucide-react';

export type Screen = 'start' | 'settings' | 'game';
export type OverlayPanel = null | 'profile' | 'notebook' | 'characters' | 'variables' | 'worldbook' | 'memory' | 'dynamics';

export interface NavButton {
  id: OverlayPanel | 'home';
  icon: LucideIcon;
  labelKey: string;
}
