// ============================================================
// 事件包预览 — 折叠列表：事件名 → 点开看卡片
//   替代之前的浮层叠加方案，与事件中心的包详情体验一致。
// ============================================================
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X, Loader2 } from 'lucide-react';
import { getWebEvent } from '../../modules/eventDb';
import type { OptEventFile, CardFile } from '../../modules/schema';
import CardRenderer, { cardFileToBlocks, type CardBlockView } from './CardRenderer';

interface EventEntry {
  id: string;
  name: string;
  blocks: CardBlockView[];
}

interface Props {
  eventPackId: string;
  onClose: () => void;
}

export default function EventPackPreview({ eventPackId, onClose }: Props) {
  const [packName, setPackName] = useState('');
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rec = await getWebEvent(eventPackId).catch(() => undefined);
        if (!rec || cancelled) return;
        setPackName(rec.manifest?.name ?? '事件包');

        // 读 events.json 获取事件列表
        const evRaw = rec.files['schema/events.json'];
        if (typeof evRaw !== 'string') { setLoading(false); return; }
        const evFile = JSON.parse(evRaw) as OptEventFile;
        const entries: EventEntry[] = [];

        for (const ev of evFile.events ?? []) {
          // 读该事件独立的画布文件
          const canvasRaw = rec.files[`schema/event-${ev.id}.json`];
          let blocks: CardBlockView[] = [];
          if (typeof canvasRaw === 'string') {
            const cf = JSON.parse(canvasRaw) as CardFile;
            blocks = cardFileToBlocks(cf);
          }
          entries.push({ id: ev.id, name: ev.name || '未命名事件', blocks });
        }

        if (!cancelled) {
          setEvents(entries);
          if (entries.length > 0) setExpandedId(entries[0].id);
        }
      } catch {
        /* 静默 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventPackId]);

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
    }} onClick={onClose}>
      <div
        style={{
          background: 'var(--bg-primary)', color: 'var(--text-primary)',
          borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
          width: 'min(520px, 90vw)', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-secondary)', flexShrink: 0,
        }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)', fontFamily: 'var(--font-display)' }}>
            {packName}
          </span>
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            {events.length} 个事件
          </span>
          <button className="btn-ghost btn-icon-sm" onClick={onClose} style={{ marginLeft: 'auto' }}>
            <X size={18} />
          </button>
        </div>

        {/* 事件列表 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-3)' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
              <Loader2 size={18} className="event-spin" />
            </div>
          ) : events.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>
              事件包内没有事件
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {events.map((ev, i) => {
                const isOpen = expandedId === ev.id;
                return (
                  <div key={ev.id} style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-secondary)',
                    overflow: 'hidden',
                  }}>
                    {/* 事件头（可折叠） */}
                    <button
                      onClick={() => setExpandedId(isOpen ? null : ev.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        width: '100%', padding: '10px 12px',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-primary)', textAlign: 'left',
                      }}
                    >
                      <ChevronRight size={16} style={{
                        transform: isOpen ? 'rotate(90deg)' : 'none',
                        transition: 'transform 0.15s ease',
                        flexShrink: 0, color: 'var(--text-muted)',
                      }} />
                      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>
                        {ev.name}
                      </span>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                        {ev.blocks.length} 张卡片
                      </span>
                    </button>

                    {/* 事件卡片（展开时显示） */}
                    {isOpen && ev.blocks.length > 0 && (
                      <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)' }}>
                        <CardRenderer blocks={ev.blocks} />
                      </div>
                    )}
                    {isOpen && ev.blocks.length === 0 && (
                      <div style={{ padding: '8px 12px 12px', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
                        该事件暂无卡片
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
