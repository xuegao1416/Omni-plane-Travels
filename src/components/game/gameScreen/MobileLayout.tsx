import type { LucideIcon } from 'lucide-react';
import { Menu,Maximize2,Minimize2,PanelRightOpen } from 'lucide-react';
import MobileOverlay from '../MobileOverlay';
import type { OverlayPanel } from './types';
import type { MobileNavItem } from './navConfig';
import { getNavLabel } from './navConfig';

interface MobileLayoutProps {
  worldName: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;

  showLeftOverlay: boolean;
  onShowLeftOverlay: (show: boolean) => void;
  mobileNavItems: MobileNavItem[];

  showRightOverlay: boolean;
  onShowRightOverlay: (show: boolean) => void;

  mobileActivePanel: OverlayPanel;
  onMobileActivePanelChange: (panel: OverlayPanel) => void;
  panelTitle: string;
  panelSubtitle?: string;
  panelIcon?: LucideIcon;
  panelContent: React.ReactNode;

  rightPanel: React.ReactNode;
  children: React.ReactNode;
}

export default function MobileLayout({
  worldName,
  isFullscreen,
  onToggleFullscreen,
  showLeftOverlay,
  onShowLeftOverlay,
  mobileNavItems,
  showRightOverlay,
  onShowRightOverlay,
  mobileActivePanel,
  onMobileActivePanelChange,
  panelTitle,
  panelSubtitle,
  panelIcon,
  panelContent,
  rightPanel,
  children,
}: MobileLayoutProps) {
  return (
    <div className="full-height game-journey game-journey--mobile">
      <header className="game-journey__mobile-header">
        <button type="button" className="mobile-header-btn" onClick={() => onShowLeftOverlay(true)} aria-label="打开导航菜单">
          <Menu size={21} strokeWidth={1.6} />
        </button>

        <div className="mobile-header-title">
          <small aria-hidden="true">当前位面</small>
          <span>{worldName || '世界漫游指南'}</span>
        </div>

        <div className="game-journey__mobile-actions">
          <button type="button" className="mobile-header-btn" onClick={onToggleFullscreen} aria-label={isFullscreen ? '退出全屏' : '全屏'}>
            {isFullscreen ? <Minimize2 size={19} strokeWidth={1.6} /> : <Maximize2 size={19} strokeWidth={1.6} />}
          </button>
          <button type="button" className="mobile-header-btn" onClick={() => onShowRightOverlay(true)} aria-label="打开信息面板">
            <PanelRightOpen size={21} strokeWidth={1.6} />
          </button>
        </div>
      </header>

      <main className="game-journey__mobile-main">
        <div className="game-journey__reading-surface game-journey__reading-surface--main">
          <div className="game-journey__frame-content">
            {children}
          </div>
        </div>
      </main>

      <MobileOverlay open={showLeftOverlay} onClose={() => onShowLeftOverlay(false)} title="旅程仪表" side="left" width={272}>
        <nav className="game-journey__mobile-nav" aria-label="旅程导航">
          {mobileNavItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                onClick={item.action}
                className={`game-journey__mobile-nav-item${item.id === 'home' || item.id === 'settings' ? ' is-utility' : ''}`}
              >
                <span className="game-journey__mobile-nav-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.5} /></span>
                <span>{getNavLabel(item.id)}</span>
              </button>
            );
          })}
        </nav>
      </MobileOverlay>

      {mobileActivePanel && (
        <MobileOverlay
          open={true}
          onClose={() => onMobileActivePanelChange(null)}
          title={panelTitle}
          subtitle={panelSubtitle}
          icon={panelIcon}
          side="left"
          width={420}
        >
          {panelContent}
        </MobileOverlay>
      )}

      <MobileOverlay open={showRightOverlay} onClose={() => onShowRightOverlay(false)} title="旅程状态" side="right" width={340}>
        {rightPanel}
      </MobileOverlay>
    </div>
  );
}
