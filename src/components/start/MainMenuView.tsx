import { useState, useEffect } from 'react';
import { Play, FolderOpen, Settings } from 'lucide-react';
import type { SaveMeta } from '../../storage/db';
import BackgroundMusic from '../BackgroundMusic';

interface MainMenuViewProps {
  allSaves: SaveMeta[];
  onStartWizard: () => void;
  onViewSaves: () => void;
  onSettings: () => void;
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
}

export default function MainMenuView({
  allSaves, onStartWizard, onViewSaves, onSettings,
  title, subtitle, beginLabel, settingsLabel,
}: MainMenuViewProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const menuItems: MenuItem[] = [
    { label: beginLabel, icon: Play, onClick: onStartWizard },
    { label: '读取存档', icon: FolderOpen, onClick: onViewSaves, badge: allSaves.length > 0 ? String(allSaves.length) : undefined },
    { label: settingsLabel, icon: Settings, onClick: onSettings },
  ];

  return (
    <div
      className="full-height"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `
          radial-gradient(ellipse at 50% 30%, var(--accent-glow) 0%, transparent 60%),
          var(--bg-deep)
        `,
        padding: '2rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
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
        gap: '3rem',
        maxWidth: '520px',
        width: '100%',
      }}>
        {/* 标题区域 */}
        <div style={{ textAlign: 'center' }}>
          {/* 主标题 */}
          <h1 style={{
            fontFamily: 'var(--font-display, serif)',
            fontSize: 'clamp(2.4rem, 7vw, 3.6rem)',
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '0.15em',
            margin: 0,
            lineHeight: 1.2,
            opacity: ready ? 1 : 0,
            transform: ready ? 'translateY(0)' : 'translateY(-20px)',
            transition: 'opacity 0.8s ease, transform 0.8s ease',
          }}>
            {title}
          </h1>

          {/* 金色分隔线 */}
          <div style={{
            height: '1px',
            margin: '20px auto',
            maxWidth: '240px',
            background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
            width: ready ? '100%' : '0%',
            opacity: ready ? 1 : 0,
            transition: 'width 1s ease 0.3s, opacity 0.6s ease 0.3s',
          }} />

          {/* 副标题 */}
          <p style={{
            fontFamily: 'var(--font-display, serif)',
            fontSize: 'clamp(0.9rem, 2.5vw, 1.15rem)',
            color: 'var(--text-muted)',
            letterSpacing: '0.2em',
            margin: 0,
            opacity: ready ? 1 : 0,
            transform: ready ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.6s ease 0.5s, transform 0.6s ease 0.5s',
          }}>
            {subtitle}
          </p>
        </div>

        {/* 菜单项列表 */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          width: '100%',
          maxWidth: '420px',
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
        v2.0.0
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
      onClick={item.onClick}
      className="menu-item-btn"
      style={{
        opacity: ready ? 1 : 0,
        transform: ready ? 'translateY(0)' : 'translateY(-12px)',
        transitionDelay: `${delay}s, ${delay}s, 0s, 0s, 0s, 0s`,
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
