import { ChevronLeft, ChevronRight, Minimize2, Maximize2 } from 'lucide-react';
import DrawerPanel from './DrawerPanel';
import type { NavButton, OverlayPanel, Screen } from './types';
import { getNavLabel } from './navConfig';

interface DesktopLayoutProps {
  // Nav
  navButtons: NavButton[];
  overlay: OverlayPanel;
  onOverlayChange: (panel: OverlayPanel) => void;
  onNavigate: (screen: Screen) => void;
  t: (key: string) => string;

  // Fullscreen
  isFullscreen: boolean;
  onToggleFullscreen: () => void;

  // Drawer
  drawerTitle: string;
  drawerEmblemSrc?: string;
  drawerContent: React.ReactNode;

  // Right panel
  rightCollapsed: boolean;
  onToggleRightPanel: () => void;
  rightPanel: React.ReactNode;

  // ChatPanel (passed as children)
  children: React.ReactNode;
  worldName: string;
}

export default function DesktopLayout({
  navButtons,
  overlay,
  onOverlayChange,
  onNavigate,
  t,
  isFullscreen,
  onToggleFullscreen,
  drawerTitle,
  drawerEmblemSrc,
  drawerContent,
  rightCollapsed,
  onToggleRightPanel,
  rightPanel,
  children,
  worldName,
}: DesktopLayoutProps) {
  return (
    <div
      className="full-height game-journey game-journey--desktop"
    >
      {/* 左侧图标导航栏 */}
      <nav className="game-journey__nav" aria-label="游戏导航">
        {navButtons.map(btn => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.id}
              onClick={() => {
                if (btn.id === 'home') { onNavigate('start'); return; }
                onOverlayChange(overlay === btn.id ? null : btn.id);
              }}
              title={getNavLabel(btn.id ?? '')}
              aria-label={getNavLabel(btn.id ?? '')}
              className={`game-journey__nav-button${overlay === btn.id ? ' is-active' : ''}`}
            >
              {btn.emblemSrc ? <img src={btn.emblemSrc} alt="" aria-hidden="true" /> : <Icon size={18} strokeWidth={1.5} />}
            </button>
          );
        })}

        <div className="game-journey__nav-spacer" />

        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? '退出全屏' : '全屏'}
          aria-label={isFullscreen ? '退出全屏' : '全屏'}
          className="btn-ghost btn-icon game-journey__nav-button game-journey__nav-button--utility"
        >
          {isFullscreen ? <Minimize2 size={18} strokeWidth={1.5} /> : <Maximize2 size={18} strokeWidth={1.5} />}
        </button>

        <button
          onClick={() => onNavigate('settings')}
          title={getNavLabel('settings')}
          aria-label={getNavLabel('settings')}
          className="btn-ghost btn-icon game-journey__nav-button game-journey__nav-button--utility"
        >
          <img src="/art/theme/emblems/emblem-26-v2.png" alt="" aria-hidden="true" />
        </button>
      </nav>

      {/* 中间主区域 */}
      <main className="game-journey__main">
        <header className="game-journey__world-bar">
          <span className="game-journey__world-bar-mark" aria-hidden="true" />
          <strong>{worldName || '世界漫游指南'}</strong>
          <span>旅程卷宗</span>
        </header>
        <div className="game-journey__reading-surface game-journey__reading-surface--main">
          <div className="game-journey__frame-content">
            {children}
          </div>
        </div>

        {/* 侧滑抽屉面板 */}
        <DrawerPanel
          open={overlay !== null}
          title={drawerTitle}
          emblemSrc={drawerEmblemSrc}
          onClose={() => onOverlayChange(null)}
        >
          {drawerContent}
        </DrawerPanel>
      </main>

      {/* 右侧信息栏 */}
      <aside className={`game-journey__right-panel${rightCollapsed ? ' is-collapsed' : ''}`}>
        {!rightCollapsed && rightPanel}
      </aside>

      {/* 右侧折叠按钮 */}
      <button
        onClick={onToggleRightPanel}
        aria-label={rightCollapsed ? '展开右侧信息栏' : '折叠右侧信息栏'}
        className={`game-journey__right-toggle${rightCollapsed ? ' is-collapsed' : ''}`}
      >
        {rightCollapsed ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
      </button>
    </div>
  );
}
