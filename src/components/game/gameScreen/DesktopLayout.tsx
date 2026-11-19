import type { LucideIcon } from 'lucide-react';
import { Maximize2,Minimize2,PanelRightClose,PanelRightOpen,Settings2 } from 'lucide-react';
import DrawerPanel from './DrawerPanel';
import type { NavButton,OverlayPanel } from './types';
import { getNavLabel } from './navConfig';

interface DesktopLayoutProps {
  navButtons: NavButton[];
  overlay: OverlayPanel;
  onOverlayChange: (panel: OverlayPanel) => void;
  onNavigate: (screen: 'start' | 'settings') => void;

  isFullscreen: boolean;
  onToggleFullscreen: () => void;

  drawerTitle: string;
  drawerSubtitle?: string;
  drawerIcon?: LucideIcon;
  drawerContent: React.ReactNode;

  rightCollapsed: boolean;
  onToggleRightPanel: () => void;
  rightPanel: React.ReactNode;

  children: React.ReactNode;
}

export default function DesktopLayout({
  navButtons,
  overlay,
  onOverlayChange,
  onNavigate,
  isFullscreen,
  onToggleFullscreen,
  drawerTitle,
  drawerSubtitle,
  drawerIcon,
  drawerContent,
  rightCollapsed,
  onToggleRightPanel,
  rightPanel,
  children,
}: DesktopLayoutProps) {
  const [home, ...panels] = navButtons;
  const HomeIcon = home?.icon;
  return (
    <div className="full-height game-journey game-journey--desktop">
      <nav className="game-journey__nav" aria-label="旅程仪表">
        {home && HomeIcon && (
          <button
            type="button"
            onClick={() => onNavigate('start')}
            title={getNavLabel('home')}
            aria-label={getNavLabel('home')}
            className="game-journey__nav-button game-journey__nav-button--home"
          >
            <HomeIcon size={19} strokeWidth={1.5} />
          </button>
        )}
        <span className="game-journey__nav-rule" aria-hidden="true" />
        {panels.map(btn => {
          const Icon = btn.icon;
          const active = overlay === btn.id;
          const label = getNavLabel(btn.id ?? '');
          return (
            <button
              type="button"
              key={btn.id}
              onClick={() => onOverlayChange(active ? null : btn.id as OverlayPanel)}
              aria-label={label}
              aria-pressed={active}
              data-tip={label}
              className={`game-journey__nav-button${active ? ' is-active' : ''}`}
            >
              <Icon size={18} strokeWidth={1.5} />
            </button>
          );
        })}

        <div className="game-journey__nav-spacer" />

        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? '退出全屏' : '全屏'}
          data-tip={isFullscreen ? '退出全屏' : '全屏'}
          className="game-journey__nav-button game-journey__nav-button--utility"
        >
          {isFullscreen ? <Minimize2 size={17} strokeWidth={1.5} /> : <Maximize2 size={17} strokeWidth={1.5} />}
        </button>
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          aria-label={getNavLabel('settings')}
          data-tip={getNavLabel('settings')}
          className="game-journey__nav-button game-journey__nav-button--utility"
        >
          <Settings2 size={17} strokeWidth={1.5} />
        </button>
      </nav>

      <main className="game-journey__main">
        <div className="game-journey__reading-surface game-journey__reading-surface--main">
          <div className="game-journey__frame-content">
            {children}
          </div>
        </div>

        <DrawerPanel
          open={overlay !== null}
          title={drawerTitle}
          subtitle={drawerSubtitle}
          icon={drawerIcon}
          onClose={() => onOverlayChange(null)}
        >
          {drawerContent}
        </DrawerPanel>
      </main>

      <aside className={`game-journey__right-panel${rightCollapsed ? ' is-collapsed' : ''}`} aria-label="旅程状态">
        {!rightCollapsed && rightPanel}
      </aside>

      <button
        type="button"
        onClick={onToggleRightPanel}
        aria-label={rightCollapsed ? '展开右侧信息栏' : '折叠右侧信息栏'}
        aria-expanded={!rightCollapsed}
        className={`game-journey__right-toggle${rightCollapsed ? ' is-collapsed' : ''}`}
      >
        {rightCollapsed ? <PanelRightOpen size={16} strokeWidth={1.6} /> : <PanelRightClose size={16} strokeWidth={1.6} />}
      </button>
    </div>
  );
}
