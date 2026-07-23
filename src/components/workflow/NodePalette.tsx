// ============================================================
//  节点面板 — 可搜索、可折叠的分类节点库
// ============================================================
import { useState, useMemo } from 'react';
import { Search, ChevronRight, ChevronDown, Zap, Clock, TrendingUp, Play, MousePointerClick, Timer, Radio, GitCompare, Coins, Heart, Flag, Backpack, User, Ampersand, Pipette, ToggleLeft, Filter, Variable, Package, HeartPulse, Swords, AlarmClock, UserCog, ShoppingBag, NotebookPen, Globe, Eye, Database, BarChart, UserCheck, Hash, Dices, Calculator, Type, Search as SearchIcon, ListChecks, GitBranch, GitMerge, ListOrdered, DoorOpen, ArrowRightLeft, CreditCard, FileText, Sparkles, CircleDot } from 'lucide-react';
import { searchNodes, getNodeCategories } from '../../modules/nodeRegistry';
import type { NodeDefinition } from '../../modules/workflowSchema';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  Zap, Clock, TrendingUp, Play, MousePointerClick, Timer, Radio,
  GitCompare, Coins, Heart, Flag, Backpack, User, Ampersand, Pipette, ToggleLeft, Filter,
  Variable, Package, HeartPulse, Swords, AlarmClock, UserCog, ShoppingBag, NotebookPen, Globe,
  Eye, Database, BarChart, UserCheck, Hash, Dices, Calculator, Type, Search: SearchIcon, ListChecks,
  GitBranch, GitMerge, ListOrdered, DoorOpen, ArrowRightLeft,
  CreditCard, FileText, Sparkles, CircleDot,
};

const CATEGORY_LABELS: Record<string, string> = {
  triggers: '触发器',
  conditions: '条件',
  actions: '动作',
  data: '数据',
  flow: '流程控制',
  output: '输出',
};

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  triggers: Zap,
  conditions: GitBranch,
  actions: Gauge,
  data: Database,
  flow: GitMerge,
  output: CreditCard,
};

// 临时导入缺失的 icon
import { Gauge } from 'lucide-react';

interface NodePaletteProps {
  onAddNode: (typeId: string) => void;
}

export default function NodePalette({ onAddNode }: NodePaletteProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['triggers', 'actions']));

  const categories = useMemo(() => getNodeCategories(), []);

  const results = useMemo(() => {
    if (!query.trim()) return null; // null = 显示分类视图
    return searchNodes(query);
  }, [query]);

  const toggleCategory = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 搜索框 */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索节点…"
            style={{ border: 'none', background: 'none', outline: 'none', fontSize: '12px', color: 'var(--text-primary)', width: '100%' }}
          />
        </div>
      </div>

      {/* 节点列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {results ? (
          // 搜索结果
          <div>
            {results.length === 0 && (
              <div style={{ padding: '12px 10px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                无匹配节点
              </div>
            )}
            {results.map((def) => (
              <NodeItem key={def.typeId} def={def} onClick={() => onAddNode(def.typeId)} />
            ))}
          </div>
        ) : (
          // 分类视图
          <div>
            {[...categories.entries()].map(([cat, defs]) => {
              const CatIcon = CATEGORY_ICONS[cat] ?? Zap;
              const isExpanded = expanded.has(cat);
              return (
                <div key={cat}>
                  <button
                    onClick={() => toggleCategory(cat)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                      padding: '6px 10px', border: 'none', background: 'none',
                      cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 600,
                    }}
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <CatIcon size={12} />
                    {CATEGORY_LABELS[cat] ?? cat}
                    <span style={{ marginLeft: 'auto', fontSize: '9px', opacity: 0.5 }}>{defs.length}</span>
                  </button>
                  {isExpanded && defs.map((def) => (
                    <NodeItem key={def.typeId} def={def} onClick={() => onAddNode(def.typeId)} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function NodeItem({ def, onClick }: { def: NodeDefinition; onClick: () => void }) {
  const Icon = ICON_MAP[def.icon] ?? Zap;
  return (
    <button
      onClick={onClick}
      title={def.description}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
        padding: '5px 10px 5px 24px', border: 'none', background: 'none',
        cursor: 'pointer', color: 'var(--text-primary)', fontSize: '11px',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none'; }}
    >
      <Icon size={13} style={{ color: def.color, flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.name}</span>
    </button>
  );
}
