// ============================================================
// 事件包预览 — 折叠列表：事件名 → 点开看卡片
//   支持新格式（CardWorkflowDefinition）和旧格式（CardFile）
// ============================================================
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X, Loader2, FileText, ScrollText, MessageCircle } from 'lucide-react';
import { getWebEvent } from '../../modules/eventDb';
import type { EventPackFile, CardWorkflowDefinition, CardNodeExecutionResult } from '../../modules/schema';
import { executeCardWorkflow } from '../../modules/cardWorkflowEngine';
import { getCardNodeDefinition } from '../../modules/cardNodeRegistry';

interface EventEntry {
  id: string;
  name: string;
  /** 新格式：工作流执行结果 */
  renderData?: CardNodeExecutionResult['renderData'][];
  /** 新格式：选项 */
  choices?: CardNodeExecutionResult['choices'];
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

        const evRaw = rec.files['schema/events.json'];
        if (typeof evRaw !== 'string') { setLoading(false); return; }
        const evFile = JSON.parse(evRaw) as EventPackFile;
        const entries: EventEntry[] = [];

        for (const ev of evFile.events ?? []) {
          const canvasRaw = rec.files[`schema/event-${ev.id}.json`];
          if (typeof canvasRaw !== 'string') {
            entries.push({ id: ev.id, name: ev.name });
            continue;
          }

          try {
            const parsed = JSON.parse(canvasRaw);

            // 新格式：CardWorkflowDefinition
            if (parsed.nodes && Array.isArray(parsed.nodes)) {
              const wf = parsed as CardWorkflowDefinition;
              const result = executeCardWorkflow(wf, {
                tick: 0, events: [], permissions: [],
                gameState: {},
              });
              entries.push({
                id: ev.id,
                name: ev.name,
                renderData: result.renderData,
                choices: result.choices,
              });
              continue;
            }

            // 旧格式：CardFile — 跳过，不预览
          } catch { /* skip */ }

          entries.push({ id: ev.id, name: ev.name });
        }

        if (!cancelled) {
          setEvents(entries);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventPackId]);

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 130,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-6)',
      }}
      onClick={onClose}
    >
      <div
        className="event-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(500px, 92vw)', maxHeight: '80vh', overflow: 'auto',
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* 标题栏 */}
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
        }}>
          <span style={{ fontWeight: 600, flex: 1 }}>{packName}</span>
          <button onClick={onClose} className="btn-ghost btn-sm"><X size={16} /></button>
        </div>

        {loading ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : events.length === 0 ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
            暂无事件
          </div>
        ) : (
          <div style={{ padding: 'var(--space-2)' }}>
            {events.map((ev) => (
              <div key={ev.id} style={{ borderBottom: '1px solid var(--border)' }}>
                {/* 事件标题 */}
                <button
                  onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 'var(--font-size-sm)', color: 'var(--text-primary)',
                  }}
                >
                  <ChevronRight
                    size={14}
                    style={{ transform: expandedId === ev.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
                  />
                  {ev.name}
                </button>

                {/* 展开内容 */}
                {expandedId === ev.id && (
                  <div style={{ padding: '0 var(--space-3) var(--space-3)', paddingLeft: 'var(--space-6)' }}>
                    {ev.renderData && ev.renderData.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {ev.renderData.map((r, i) => (
                          <PreviewBlock key={i} data={r} />
                        ))}
                        {ev.choices && ev.choices.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {ev.choices.map((c, i) => (
                              <div key={i} style={{
                                padding: 'var(--space-2)',
                                background: 'var(--bg-primary)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: 'var(--font-size-xs)',
                              }}>
                                · {c?.label}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                        （空事件）
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PreviewBlock({ data }: { data: CardNodeExecutionResult['renderData'] }) {
  if (!data) return null;

  const iconMap = {
    title: FileText,
    text: ScrollText,
    image: FileText,
    dialog: MessageCircle,
  };
  const Icon = iconMap[data.type] ?? FileText;

  return (
    <div style={{
      padding: 'var(--space-2)',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
        <Icon size={12} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{data.type}</span>
      </div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)' }}>
        {data.title ?? data.text ?? data.npcName ?? ''}
      </div>
    </div>
  );
}
