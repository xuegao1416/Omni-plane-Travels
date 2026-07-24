// ============================================================
//  卡片工作流模板选择器 — 预览 + 一键应用
// ============================================================
import { useState, useMemo } from 'react';
import { X, Compass, Store, MessageCircle, Zap, GitBranch, Package, Link, Sparkles } from 'lucide-react';
import { getAllCardWorkflowTemplates, type CardWorkflowTemplate } from '../../modules/cardWorkflowTemplates';
import type { CardWorkflowDefinition } from '../../modules/schema';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Compass, Store, MessageCircle, Zap, GitBranch, Package, Link, Sparkles,
};

interface Props {
  open: boolean;
  onSelect: (workflow: CardWorkflowDefinition) => void;
  onClose: () => void;
}

export default function CardTemplatePicker({ open, onSelect, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const templates = useMemo(() => getAllCardWorkflowTemplates(), []);

  const categories = useMemo(() => {
    const cats = new Map<string, CardWorkflowTemplate[]>();
    for (const t of templates) {
      const list = cats.get(t.category) ?? [];
      list.push(t);
      cats.set(t.category, list);
    }
    return cats;
  }, [templates]);

  if (!open) return null;

  const selected = templates.find(t => t.id === selectedId);

  return (
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
          width: 'min(600px, 92vw)', maxHeight: '80vh', overflow: 'auto',
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
          <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)' }}>选择模板</span>
          <button onClick={onClose} className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
            <X size={16} />
          </button>
        </div>

        {/* 模板列表 */}
        <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[...categories.entries()].map(([cat, catTemplates]) => (
            <div key={cat}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                {cat}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-2)' }}>
                {catTemplates.map((t) => {
                  const Icon = ICON_MAP[t.icon] ?? Compass;
                  const isSelected = selectedId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      style={{
                        padding: 'var(--space-3)',
                        background: isSelected ? 'var(--accent)' : 'var(--bg-primary)',
                        color: isSelected ? '#fff' : 'var(--text-primary)',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Icon size={16} />
                        <span style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>{t.name}</span>
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>{t.description}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 预览 + 应用 */}
        {selected && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>{selected.name}</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                {selected.description} · {selected.create().nodes.length} 个节点
              </div>
            </div>
            <button
              className="btn-primary btn-sm"
              onClick={() => {
                onSelect(selected.create());
                onClose();
              }}
            >
              使用模板
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
