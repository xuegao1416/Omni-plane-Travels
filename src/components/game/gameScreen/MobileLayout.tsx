import { Menu, Maximize2, Minimize2, PanelRightOpen } from 'lucide-react';
import MobileOverlay from '../MobileOverlay';
import type { OverlayPanel } from './types';
import type { MobileNavItem } from './navConfig';
import { getNavLabel } from './navConfig';

interface MobileLayoutProps {
  // Header
  worldName: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;

  // Left nav overlay
  showLeftOverlay: boolean;
  onShowLeftOverlay: (show: boolean) => void;
  mobileNavItems: MobileNavItem[];
  t: (key: string) => string;

  // Right overlay
  showRightOverlay: boolean;
  onShowRightOverlay: (show: boolean) => void;

  // Active panel
  mobileActivePanel: OverlayPanel;
  onMobileActivePanelChange: (panel: OverlayPanel) => void;
  panelTitle: string;
  panelEmblemSrc?: string;
  panelContent: React.ReactNode;

  // Right panel
  rightPanel: React.ReactNode;

  // ChatPanel (passed as children)
  children: React.ReactNode;
}

export default function MobileLayout({
  worldName,
  isFullscreen,
  onToggleFullscreen,
  showLeftOverlay,
  onShowLeftOverlay,
  mobileNavItems,
  t,
  showRightOverlay,
  onShowRightOverlay,
  mobileActivePanel,
  onMobileActivePanelChange,
  panelTitle,
  panelEmblemSrc,
  panelContent,
  rightPanel,
  children,
}: MobileLayoutProps) {
  return (
    <div
      className="full-height game-journey game-journey--mobile"
    >
      {/* 移动端头部 */}
      <header className="mobile-header game-journey__mobile-header">
        <button
          className="mobile-header-btn"
          onClick={() => onShowLeftOverlay(true)}
          aria-label="打开导航菜单"
        >
          <Menu size={22} />
        </button>

        <div className="mobile-header-title">
          {worldName || '世界漫游指南'}
        </div>

        <div className="game-journey__mobile-actions">
          <button
            className="mobile-header-btn"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? '退出全屏' : '全屏'}
          >
            {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>
          <button
            className="mobile-header-btn"
            onClick={() => onShowRightOverlay(true)}
            aria-label="打开信息面板"
          >
            <PanelRightOpen size={22} />
          </button>
        </div>
      </header>

      {/* 中间主区域 */}
      <main className="game-journey__mobile-main">
        <div className="game-journey__reading-surface game-journey__reading-surface--main">
          <div className="game-journey__frame-content">
            {children}
          </div>
        </div>
      </main>

      {/* 左侧导航覆盖层 */}
      <MobileOverlay
        open={showLeftOverlay}
        onClose={() => onShowLeftOverlay(false)}
        title="导航"
        side="left"
        width={260}
      >
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 0' }}>
          {mobileNavItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={item.action}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--font-size-md)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  minHeight: 'var(--touch-min)',
                  width: '100%',
                  textAlign: 'left',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {item.emblemSrc ? <img src={item.emblemSrc} alt="" aria-hidden="true" style={{ width: 20, height: 20, objectFit: 'contain', flex: '0 0 20px' }} /> : <Icon size={20} strokeWidth={1.5} />}
                <span>{getNavLabel(item.id)}</span>
              </button>
            );
          })}
        </nav>
      </MobileOverlay>

      {/* 左侧面板覆盖层（显示具体内容） */}
      {mobileActivePanel && (
        <MobileOverlay
          open={true}
          onClose={() => onMobileActivePanelChange(null)}
          title={panelTitle}
          emblemSrc={panelEmblemSrc}
          side="left"
          width={300}
        >
          {panelContent}
        </MobileOverlay>
      )}

      {/* 右侧信息覆盖层 */}
      <MobileOverlay
        open={showRightOverlay}
        onClose={() => onShowRightOverlay(false)}
        title="信息面板"
        side="right"
        width={320}
      >
        {rightPanel}
      </MobileOverlay>
    </div>
  );
}
