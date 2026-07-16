import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  SquareArrowOutUpRight,
  Download,
  Trash2,
  MoreHorizontal,
  ChevronRight,
} from 'lucide-react';
import type { EventRegistryEntry } from '../../modules/schema';
import { resolveEventIcon } from './eventIcons';
import EventSwitch from './EventSwitch';
import EventPackBadge from './EventPackBadge';
import PackEventList from './PackEventList';
import { useIsPhone } from '../../hooks/useIsMobile';
import { isEventActive } from '../../modules/eventActivation';

interface EventListRowProps {
  entry: EventRegistryEntry;
  onEnable: (id: string) => void | Promise<void>;
  onDisable: (id: string) => void | Promise<void>;
  onUninstall: (id: string) => void | Promise<void>;
  onExport: (id: string) => void | Promise<void>;
  onOpen?: (entry: EventRegistryEntry) => void;
}

/** 依据封面底色计算反白文字色（仅返回 #000 / #fff，属硬编码例外） */
function textOn(hex: string): string {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return '#ffffff';
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5 ? '#000000' : '#ffffff';
}

export default function EventListRow({
  entry,
  onEnable,
  onDisable,
  onUninstall,
  onExport,
  onOpen,
}: EventListRowProps) {
  const { meta } = entry;
  const Icon = resolveEventIcon(meta.icon, meta.type);
  const coverText = textOn(meta.coverColor);
  const isPhone = useIsPhone();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  const openMenu = useCallback(() => {
    if (menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setMenuOpen(true);
  }, []);

  // 窗口变化时更新位置
  useEffect(() => {
    if (!menuOpen) return;
    const update = () => {
      if (menuBtnRef.current) {
        const rect = menuBtnRef.current.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
      }
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [menuOpen]);
  // 3 级层级：行本身为「事件包」(小类)，可展开显示包内「事件」(小小类)
  const [expanded, setExpanded] = useState(false);
  const isActive = isEventActive(entry.enabled);

  const actions = (
    <>
      {onOpen && (
        <button className="btn-ghost btn-sm" onClick={() => onOpen(entry)} title="打开" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px' }}>
          <SquareArrowOutUpRight size={15} /> 打开
        </button>
      )}
      <button className="btn-ghost btn-sm" onClick={() => onExport(meta.id)} title="导出" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px' }}>
        <Download size={15} /> 导出
      </button>
      {!entry.builtin && (
        <button
          className="btn-ghost btn-sm"
          onClick={() => onUninstall(meta.id)}
          title="卸载"
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', color: 'var(--danger)' }}
        >
          <Trash2 size={15} /> 卸载
        </button>
      )}
    </>
  );

  return (
    <div className="event-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isPhone ? 'var(--space-2)' : 'var(--space-3)',
          padding: isPhone ? 'var(--space-2) var(--space-3)' : 'var(--space-3) var(--space-4)',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          transition:
            'box-shadow var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)',
        }}
      >
        {/* 展开/收起事件包内事件（3 级层级：事件库 → 事件包 → 事件） */}
        <button
          type="button"
          className="btn-ghost btn-icon-sm"
          onClick={() => setExpanded((o) => !o)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起事件' : '展开事件'}
          style={{ flexShrink: 0, color: 'var(--text-secondary)', padding: isPhone ? 2 : undefined }}
        >
          <ChevronRight
            size={isPhone ? 16 : 18}
            style={{
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform var(--duration-fast) var(--ease-out)',
            }}
          />
        </button>

        {/* 封面实色块（manifest.coverColor，schema 已拒绝渐变） */}
      <div
        style={{
          width: isPhone ? 40 : 56,
          height: isPhone ? 40 : 56,
          borderRadius: 'var(--radius-md)',
          background: meta.coverColor,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: coverText,
        }}
      >
        <Icon size={isPhone ? 18 : 24} strokeWidth={1.75} />
      </div>

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-display)',
              fontSize: isPhone ? 'var(--font-size-sm)' : 'var(--font-size-md)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {meta.name}
          </span>
          {!isPhone && <EventPackBadge packId={meta.id} />}
          {entry.builtin && (
            <span style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              color: 'var(--accent)',
              border: '1px solid var(--accent-dim)',
              borderRadius: 'var(--radius-md)',
              padding: isPhone ? '0 4px' : '1px 6px',
              flexShrink: 0,
            }}>内置</span>
          )}
        </div>
        <div
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-muted)',
            marginTop: isPhone ? 0 : '2px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {meta.author} · v{meta.version}
          {isPhone && entry.builtin && <EventPackBadge packId={meta.id} />}
        </div>
      </div>

      {/* 操作：桌面端内联，移动端收进「更多」 */}
      {isPhone ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
          <div>
            <button
              ref={menuBtnRef}
              className="btn-icon btn-icon-sm btn-ghost"
              onClick={() => menuOpen ? setMenuOpen(false) : openMenu()}
              aria-label="更多操作"
              aria-expanded={menuOpen}
              style={{ padding: 4 }}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && createPortal(
              <>
                <div
                  onClick={() => setMenuOpen(false)}
                  style={{ position: 'fixed', inset: 0 }}
                />
                <div
                  style={{
                    position: 'fixed',
                    top: menuPos.top,
                    right: menuPos.right,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-md)',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 'var(--space-1)',
                    minWidth: '132px',
                  }}
                >
                  {actions}
                </div>
              </>,
              document.body,
            )}
          </div>
          {/* 启用开关 */}
          <EventSwitch
            checked={isActive}
            onChange={(next) => (next ? onEnable(meta.id) : onDisable(meta.id))}
            label={`启用 ${meta.name}`}
          />
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>{actions}</div>
          {/* 启用开关 */}
          <EventSwitch
            checked={isActive}
            onChange={(next) => (next ? onEnable(meta.id) : onDisable(meta.id))}
            label={`启用 ${meta.name}`}
          />
        </>
      )}
      </div>

      {/* 事件包内事件（小小类）—— 展开后惰性读取并解析包内容 */}
      {expanded && (
        <div
          style={{
            marginLeft: 'var(--space-8)',
            paddingLeft: 'var(--space-3)',
            borderLeft: '2px solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <PackEventList packId={meta.id} />
        </div>
      )}
    </div>
  );
}
