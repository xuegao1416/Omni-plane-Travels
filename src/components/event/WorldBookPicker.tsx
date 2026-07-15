import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Search, Tag, X, Check, CornerDownLeft } from 'lucide-react';
import type { WorldBookEntryDef, WorldBookEntryType, WorldDef } from '../../data/worlds-schema';
import { WORLDS } from '../../data/worldLoader';
import { STORAGE_KEYS } from '../../config/storageKeys';

/** 条目分类 → 维度色（仅作数据徽章，禁用渐变） */
const ENTRY_COLORS: Record<WorldBookEntryType, string> = {
  setting: 'var(--dim-world-type)',
  factions: 'var(--dim-factions)',
  npcs: 'var(--dim-npcs)',
  rules: 'var(--dim-rules)',
  economy: 'var(--dim-geography)',
  culture: 'var(--dim-culture)',
  events: 'var(--event-level-mythic)',
  relationships: 'var(--dim-conflict)',
  highlights: 'var(--dim-tone)',
  lore: 'var(--dim-geography)',
  module_rule: 'var(--dim-world-type)',
};

const ENTRY_LABEL: Record<WorldBookEntryType, string> = {
  setting: '设定',
  factions: '势力',
  npcs: 'NPC',
  rules: '规则',
  economy: '经济',
  events: '事件',
  relationships: '关系',
  highlights: '特色',
  lore: '地理',
  culture: '文化',
  module_rule: '模块规则',
};

const CATEGORIES: Array<WorldBookEntryType | 'all'> = [
  'all', 'setting', 'factions', 'npcs', 'rules', 'economy', 'events', 'relationships', 'culture', 'lore', 'highlights',
];

/** 选择条目：世界 id + 条目 uid 合成的稳定键 */
export type WorldBookSelection = string; // `${worldId}:${uid}`

export interface PickerEntry extends WorldBookEntryDef {
  selId: WorldBookSelection;
  worldId: string;
}

/** 聚合所有已注册世界的世界书条目（供选择器读取）
 * 含内置世界(WORLDS)与自建世界(localStorage CUSTOM_WORLDS)，按 id 去重、自建优先（与 findWorldDef 语义一致） */
export function getAllWorldBookEntries(): PickerEntry[] {
  const out: PickerEntry[] = [];
  const seen = new Set<string>();
  // 1) 自建世界优先
  try {
    const custom: WorldDef[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
    for (const w of custom) {
      for (const e of w.worldBookEntries ?? []) {
        out.push({ ...e, selId: `${w.id}:${e.uid}`, worldId: w.id });
      }
      seen.add(w.id);
    }
  } catch { /* ignore */ }
  // 2) 内置世界兜底（跳过已被自建覆盖的 id）
  for (const w of WORLDS) {
    if (seen.has(w.id)) continue;
    for (const e of w.worldBookEntries ?? []) {
      out.push({ ...e, selId: `${w.id}:${e.uid}`, worldId: w.id });
    }
  }
  return out;
}

export interface WorldBookPickerProps {
  open: boolean;
  entries: PickerEntry[];
  /** 已选 selId 列表（受控初始值） */
  selectedIds?: WorldBookSelection[];
  /** 确认选择（引用选中） */
  onConfirm: (ids: WorldBookSelection[]) => void;
  onClose: () => void;
  /** 标题，默认「世界书条目」 */
  title?: string;
  /** 确认按钮文案，默认「引用选中」（只读浏览场景可覆盖为「完成」） */
  confirmLabel?: string;
}

/**
 * 可复用世界书选择器（抽屉/弹层）。
 * 读 WorldBookEntryDef[]，多选并回调 selId 列表。键盘 ↑↓ 导航、Enter 切换、Esc 关闭。
 */
export function WorldBookPicker({
  open,
  entries,
  selectedIds = [],
  onConfirm,
  onClose,
  title = '世界书条目',
  confirmLabel = '引用选中',
}: WorldBookPickerProps) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<WorldBookEntryType | 'all'>('all');
  const [picked, setPicked] = useState<Set<WorldBookSelection>>(new Set(selectedIds));
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 每次打开重置选择为初始值
  useEffect(() => {
    if (open) {
      setPicked(new Set(selectedIds));
      setQuery('');
      setCat('all');
      setActiveIdx(0);
    }
  }, [open, selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (cat !== 'all' && e.entryType !== cat) return false;
      if (!q) return true;
      return (
        (e.comment ?? '').toLowerCase().includes(q) ||
        (e.content ?? '').toLowerCase().includes(q) ||
        (e.key ?? []).some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [entries, query, cat]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, activeIdx]);

  if (!open) return null;

  const toggle = (id: WorldBookSelection) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cur = filtered[activeIdx];
      if (cur) toggle(cur.selId);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={onClose}
    >
      <div
        className="event-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'var(--drawer-width)',
          maxWidth: 'var(--overlay-max)',
          height: '100%',
          background: 'var(--bg-elevated)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* 头部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-4)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <BookOpen size={18} strokeWidth={2} style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, fontFamily: 'var(--font-display)', margin: 0 }}>
            {title}
          </h2>
          <button
            className="btn-ghost btn-sm"
            onClick={onClose}
            aria-label="关闭"
            style={{ marginLeft: 'auto', minHeight: 'var(--touch-min)', display: 'flex', alignItems: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 搜索 + 分类 */}
        <div style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索条目标题、内容或关键词"
              aria-label="搜索世界书条目"
              style={{
                width: '100%',
                padding: '8px 10px 8px 32px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: 'var(--font-size-base)',
                fontFamily: 'var(--font-body)',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', overflowX: 'auto' }}>
            {CATEGORIES.map((c) => {
              const active = cat === c;
              const color = c === 'all' ? 'var(--text-secondary)' : ENTRY_COLORS[c as WorldBookEntryType];
              return (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    border: `1px solid ${active ? color : 'var(--border)'}`,
                    background: active ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                    color: active ? color : 'var(--text-secondary)',
                  }}
                >
                  {c !== 'all' && <Tag size={11} style={{ color }} />}
                  {c === 'all' ? '全部' : ENTRY_LABEL[c as WorldBookEntryType]}
                </button>
              );
            })}
          </div>
        </div>

        {/* 列表 */}
        <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: '0 var(--space-4) var(--space-4)' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              没有匹配的世界书条目
            </div>
          ) : (
            filtered.map((e, i) => {
              const isPicked = picked.has(e.selId);
              const isActive = i === activeIdx;
              const color = e.entryType ? ENTRY_COLORS[e.entryType] : 'var(--text-secondary)';
              return (
                <button
                  key={e.selId}
                  onClick={() => toggle(e.selId)}
                  onMouseEnter={() => setActiveIdx(i)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    width: '100%',
                    textAlign: 'left',
                    padding: 'var(--space-3)',
                    marginBottom: 'var(--space-2)',
                    borderRadius: 'var(--radius-md)',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    background: isPicked ? 'var(--accent-glow)' : 'var(--bg-secondary)',
                    cursor: 'pointer',
                    outline: isActive ? '2px solid var(--accent-glow)' : 'none',
                    outlineOffset: '1px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '1px 8px',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 600,
                        color,
                        background: 'color-mix(in srgb, ' + color + ' 12%, transparent)',
                      }}
                    >
                      <Tag size={10} />
                      {e.entryType ? ENTRY_LABEL[e.entryType] : '条目'}
                    </span>
                    <span style={{ fontSize: 'var(--font-size-md)', fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.comment || '(无标题)'}
                    </span>
                    {isPicked && <Check size={16} style={{ color: 'var(--accent)' }} />}
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {e.content || '（无内容）'}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* 底部 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
            已选 {picked.size} 条
          </span>
          <button className="btn-ghost btn-sm" onClick={onClose} style={{ marginLeft: 'auto' }}>
            取消
          </button>
          <button
            className="btn-primary btn-sm"
            onClick={() => onConfirm([...picked])}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <CornerDownLeft size={15} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 世界书浏览器（EventsScreen 'worldbook' 子视图使用）。
 * 聚合所有世界的世界书条目，作为独立选择器使用。
 */
export function WorldBookBrowser({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<WorldBookSelection[]>([]);
  const entries = useMemo(() => getAllWorldBookEntries(), []);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'var(--space-6)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        共载入 {entries.length} 条世界书条目，仅作只读浏览。
        {picked.length > 0 && ` 当前已勾选 ${picked.length} 条。`}
        <br />
        要在事件中引用世界书，请在大纲编辑器的卡片块里点击「世界书」选择器插入。
      </div>
      <WorldBookPicker
        open={open}
        entries={entries}
        selectedIds={picked}
        confirmLabel="完成"
        onConfirm={() => {
          setOpen(false);
          onClose();
        }}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="世界书条目（只读）"
      />
    </div>
  );
}
