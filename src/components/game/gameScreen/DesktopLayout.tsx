import { Settings, ChevronLeft, ChevronRight, Minimize2, Maximize2 } from 'lucide-react';
import DrawerPanel from './DrawerPanel';
import type { NavButton, OverlayPanel, Screen } from './types';

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
  drawerContent: React.ReactNode;

  // Right panel
  rightCollapsed: boolean;
  onToggleRightPanel: () => void;
  rightPanel: React.ReactNode;

  // ChatPanel (passed as children)
  children: React.ReactNode;
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
  drawerContent,
  rightCollapsed,
  onToggleRightPanel,
  rightPanel,
  children,
}: DesktopLayoutProps) {
  return (
    <div
      className="full-height"
      style={{
        display: 'flex',
        flexDirection: 'row',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}
    >
      {/* 左侧图标导航栏 */}
      <div style={{
        width: '52px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '10px 0',
        gap: '2px',
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border)',
      }}>
        {navButtons.map(btn => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.id}
              onClick={() => {
                if (btn.id === 'home') { onNavigate('start'); return; }
                onOverlayChange(overlay === btn.id ? null : btn.id);
              }}
              title={t(btn.labelKey)}
              style={{
                width: '38px',
                height: '38px',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: overlay === btn.id ? 'var(--accent-dim)' : 'transparent',
                color: overlay === btn.id ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (overlay !== btn.id) e.currentTarget.style.background = 'var(--accent-dim)';
              }}
              onMouseLeave={e => {
                if (overlay !== btn.id) e.currentTarget.style.background = 'transparent';
              }}
            >
              <Icon size={18} strokeWidth={1.5} />
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <button
          onClick={onToggleFullscreen}
          title={isFullscreen ? '退出全屏' : '全屏'}
          className="btn-ghost btn-icon"
        >
          {isFullscreen ? <Minimize2 size={18} strokeWidth={1.5} /> : <Maximize2 size={18} strokeWidth={1.5} />}
        </button>

        <button
          onClick={() => onNavigate('settings')}
          title={t('nav.settings')}
          className="btn-ghost btn-icon"
        >
          <Settings size={18} strokeWidth={1.5} />
        </button>
      </div>

      {/* 中间主区域 */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {children}
        </div>

        {/* 侧滑抽屉面板 */}
        <DrawerPanel
          open={overlay !== null}
          title={drawerTitle}
          onClose={() => onOverlayChange(null)}
        >
          {drawerContent}
        </DrawerPanel>
      </div>

      {/* 右侧信息栏 */}
      <div style={{
        width: rightCollapsed ? '0px' : 'var(--right-panel-width)',
        flexShrink: 0,
        overflow: 'hidden',
        borderLeft: rightCollapsed ? 'none' : '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {!rightCollapsed && rightPanel}
      </div>

      {/* 右侧折叠按钮 */}
      <button
        onClick={onToggleRightPanel}
        style={{
          position: 'fixed',
          right: rightCollapsed ? '0' : 'var(--right-panel-width)',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '24px',
          height: '40px',
          border: '1px solid var(--border)',
          borderRight: rightCollapsed ? '1px solid var(--border)' : 'none',
          borderRadius: '4px 0 0 4px',
          background: 'var(--bg-secondary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--text-muted)',
          zIndex: 50,
          transition: 'right 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {rightCollapsed ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
      </button>
    </div>
  );
}
