// ============================================================
//  卡片节点面板 — 按分类展示、拖拽添加、搜索过滤
// ============================================================
import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { getAllCardNodeDefinitions, getCardNodeCategories, searchCardNodes } from '../../modules/cardNodeRegistry';
import type { CardNodeDefinition } from '../../modules/schema';

interface Props {
  onAddNode: (typeId: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  narrative: '叙事',
  choice: '交互',
  effect: '效果',
  flow: '流程',
};

const CATEGORY_COLORS: Record<string, string> = {
  narrative: '#8b5cf6',
  choice: '#f59e0b',
  effect: '#10b981',
  flow: '#f97316',
};

export default function CardNodePalette({ onAddNode }: Props) {
  const [search, setSearch] = useState('');
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return search ? searchCardNodes(search) : getAllCardNodeDefinitions();
  }, [search]);

  const categories = useMemo(() => {
    const cats = new Map<string, CardNodeDefinition[]>();
    for (const def of filtered) {
      const list = cats.get(def.category) ?? [];
      list.push(def);
      cats.set(def.category, list);
    }
    return cats;
  }, [filtered]);

  return (
    <div style={{ width: 220, background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 搜索 */}
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索节点..."
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 'var(--font-size-xs)', color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      {/* 节点列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
        {[...categories.entries()].map(([cat, nodes]) => (
          <div key={cat} style={{ marginBottom: 4 }}>
            <button
              onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 600,
                color: CATEGORY_COLORS[cat] ?? 'var(--text-primary)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLORS[cat] }} />
              {CATEGORY_LABELS[cat] ?? cat}
              <span style={{ marginLeft: 'auto', fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>{nodes.length}</span>
            </button>

            {(expandedCat === cat || expandedCat === null) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 16 }}>
                {nodes.map((def) => (
                  <button
                    key={def.typeId}
                    onClick={() => onAddNode(def.typeId)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/cardNodeType', def.typeId);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'grab',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--text-primary)',
                      textAlign: 'left',
                    }}
                    title={def.description}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: def.color, flexShrink: 0 }} />
                    {def.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
