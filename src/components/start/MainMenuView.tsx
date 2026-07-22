import { useState, useEffect } from 'react';
import { Play, FolderOpen, Settings, Boxes, Cloud } from 'lucide-react';
import type { SaveMeta } from '../../storage/db';
import { useAuthStore } from '../../stores/authStore';
import BackgroundMusic from '../BackgroundMusic';

interface MainMenuViewProps {
  allSaves: SaveMeta[];
  onStartWizard: () => void;
  onViewSaves: () => void;
  onSettings: () => void;
  onOpenEvents: () => void;
  onOpenUserCenter: () => void;
  title: string;
  subtitle: string;
  beginLabel: string;
  settingsLabel: string;
}

interface MenuItem {
  label: string;
  icon: typeof Play;
  onClick: () => void;
  badge?: string;
  disabled?: boolean;
}

export default function MainMenuView({
  allSaves, onStartWizard, onViewSaves, onSettings, onOpenEvents, onOpenUserCenter,
  title, subtitle, beginLabel, settingsLabel,
}: MainMenuViewProps) {
  const { user, isAuthenticated } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);

  useEffect(() => {
    const t = requestAnimationFrame(() => setReady(true));
    const mql = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => { cancelAnimationFrame(t); mql.removeEventListener('change', handler); };
  }, []);

  const menuItems: MenuItem[] = [
    { label: beginLabel, icon: Play, onClick: onStartWizard },
    { label: '读取存档', icon: FolderOpen, onClick: onViewSaves, badge: allSaves.length > 0 ? String(allSaves.length) : undefined },
    { label: settingsLabel, icon: Settings, onClick: onSettings },
    { label: '事件中心', icon: Boxes, onClick: onOpenEvents, badge: 'Beta测试' },
  ];

  return (
    <div
      className="full-height"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: `
          radial-gradient(ellipse at 50% 30%, var(--accent-glow) 0%, transparent 60%),
          url('${isMobile ? '/bg-main-phone.png' : '/bg-main.png'}')
        `,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        padding: '2rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 右上角：用户中心入口 */}
      <button
        onClick={onOpenUserCenter}
        style={{
          position: 'absolute',
          top: '16px',
          right: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          background: 'rgba(0, 0, 0, 0.1)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 'var(--radius-md)',
          color: '#ffffffcc',
          cursor: 'pointer',
          fontSize: 'var(--font-size-sm)',
          opacity: 0.8,
          transform: ready ? 'translateY(0)' : 'translateY(-12px)',
          transition: 'transform 0.4s ease, color 0.15s, border-color 0.15s',
          zIndex: 10,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(0,0,0,0.1)';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
        }}
      >
        <Cloud size={16} strokeWidth={1.5} />
        <span>{isAuthenticated ? (user?.username || user?.email || '已登录') : '登录'}</span>
      </button>

      {/* 装饰：顶部和底部细金线 */}
      <div style={{
        position: 'absolute',
        top: 0, left: '10%', right: '10%',
        height: '1px',
        background: 'linear-gradient(90deg, transparent, var(--accent-dim), var(--accent), var(--accent-dim), transparent)',
        opacity: ready ? 0.6 : 0,
        transition: 'opacity 1.2s ease 0.5s',
      }} />
      <div style={{
        position: 'absolute',
        bottom: 0, left: '10%', right: '10%',
        height: '1px',
        background: 'linear-gradient(90deg, transparent, var(--accent-dim), var(--accent), var(--accent-dim), transparent)',
        opacity: ready ? 0.4 : 0,
        transition: 'opacity 1.2s ease 0.8s',
      }} />

      {/* 主内容容器 */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        maxWidth: '640px',
        width: '100%',
      }}>
        {/* 主标题 */}
        <img
          src="/title-main.png"
          alt={title}
          style={{
            maxWidth: '600px',
            width: '100%',
            height: 'auto',
            opacity: ready ? 1 : 0,
            transform: ready ? 'translateY(0)' : 'translateY(-20px)',
            transition: 'opacity 0.8s ease, transform 0.8s ease',
          }}
        />

        {/* 菜单项列表 */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          width: '100%',
          maxWidth: '420px',
          marginTop: '-2rem',
        }}>
          {menuItems.map((item, i) => (
            <MenuItemButton
              key={item.label}
              item={item}
              index={i}
              ready={ready}
            />
          ))}
        </div>
      </div>

      {/* 底部版本信息 */}
      <div style={{
        position: 'absolute',
        bottom: '24px',
        fontSize: 'var(--font-size-sm)',
        color: 'var(--text-muted)',
        opacity: ready ? 0.4 : 0,
        transition: 'opacity 1s ease 1.2s',
        letterSpacing: '0.05em',
      }}>
        v2.6.6
      </div>
      <BackgroundMusic />
    </div>
  );
}

function MenuItemButton({
  item,
  index,
  ready,
}: {
  item: MenuItem;
  index: number;
  ready: boolean;
}) {
  const Icon = item.icon;
  const delay = 0.6 + index * 0.1;

  return (
    <button
      onClick={item.disabled ? undefined : item.onClick}
      disabled={item.disabled}
      className="menu-item-btn"
      style={{
        opacity: ready ? (item.disabled ? 0.35 : 0.8) : 0,
        transform: ready ? 'translateY(0)' : 'translateY(-12px)',
        transitionDelay: `${delay}s, ${delay}s, 0s, 0s, 0s, 0s`,
        cursor: item.disabled ? 'not-allowed' : undefined,
      }}
    >
      <Icon size={18} strokeWidth={1.5} className="menu-item-icon" />
      <span className="menu-item-label">{item.label}</span>
      {item.badge && (
        <span className="menu-item-badge">{item.badge}</span>
      )}
    </button>
  );
}
