import { useEffect, useMemo, useState } from 'react';
import {
  Upload,
  Download,
  Trash2,
  SquareArrowOutUpRight,
  Search,
  Loader2,
  PackageOpen,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import type { EventRegistryEntry, EventMeta, EventType } from '../../modules/schema';
import type { UseEventsResult } from './useEvents';
import { resolveEventIcon } from './eventIcons';
import EventSwitch from './EventSwitch';
import EventPackBadge, {
  derivePackFlags,
  parseOptEventFile,
  type EventPackFlags,
} from './EventPackBadge';
import { getWebEvent } from '../../modules/eventDb';
import PackEventList from './PackEventList';
import { EmptyState } from './EmptyState';
import { useIsPhone } from '../../hooks/useIsMobile';
import { isEventActive } from '../../modules/eventActivation';
import { textOn } from './colorUtils';

interface EventLibraryProps {
  eventApi: UseEventsResult;
  onOpenMod: (entry: EventRegistryEntry) => void;
}

export default function EventLibrary({ eventApi, onOpenMod }: EventLibraryProps) {
  const { mods, discovered, loading, error, enable, disable, uninstall, exportMod, importMod } = eventApi;
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all');
  const isPhone = useIsPhone();

  const entryById = useMemo(
    () => new Map(mods.map((m) => [m.meta.id, m] as const)),
    [mods],
  );

  // 包内容构成标记缓存（id → flags），由事件包真实 OptEventFile 内容派生（与 EventPackBadge 同源，
  // 而非只看陈旧的 meta.type 单一字段）。发现态包无内容摘要，需惰性读 IndexedDB。
  const [flagsMap, setFlagsMap] = useState<Record<string, EventPackFlags | null>>({});

  useEffect(() => {
    if (discovered.length === 0) {
      setFlagsMap({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        discovered.map(async (m) => {
          try {
            const rec = await getWebEvent(m.id);
            // rec 不存在（如非 IndexedDB 环境）→ null，交由筛选回退到旧 type
            if (!rec) return [m.id, null] as const;
            return [m.id, derivePackFlags(parseOptEventFile(rec.files))] as const;
          } catch {
            return [m.id, null] as const;
          }
        }),
      );
      if (!cancelled) setFlagsMap(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [discovered]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return discovered.filter((m) => {
      if (q && !(m.name.toLowerCase().includes(q) || m.author.toLowerCase().includes(q))) return false;
      if (typeFilter === 'all') return true;
      const f = flagsMap[m.id];
      if (f === undefined) return true; // 内容标记尚未就绪：先全部展示，避免列表闪烁，就绪后精确收敛
      if (f === null) return m.type === typeFilter; // 内容不可用：回退旧 meta.type
      // 已加载真实内容：按构成标记筛选
      switch (typeFilter) {
        case 'card': return f.hasCards;
        case 'rule': return f.hasRules;
        case 'worldbook': return f.hasWorldbook;
        case 'periodic': return f.hasPeriodic;
        case 'bundle': return f.eventCount > 1;
        default: return true;
      }
    });
  }, [discovered, query, typeFilter, flagsMap]);

  return (
    <div
      className="event-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        padding: isPhone ? 'var(--space-3)' : 'var(--space-4)',
      }}
    >
      {/* 顶栏：搜索 + 类型筛选 + 导入（本地优先，无评分/发布/在线） */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '160px' }}>
          <Search
            size={16}
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            className="input-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索事件名称或作者"
            style={{ width: '100%', paddingLeft: 32, minHeight: 'var(--touch-min)' }}
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as EventType | 'all')}
          className="input-field"
          style={{ minHeight: 'var(--touch-min)' }}
        >
          <option value="all">全部类型</option>
          <option value="card">卡片</option>
          <option value="rule">规则</option>
          <option value="worldbook">世界书</option>
          <option value="bundle">合集</option>
          <option value="periodic">周期</option>
        </select>
        <button className="btn-primary" onClick={() => importMod()}>
          <Upload size={16} /> 导入 .opt-event
        </button>
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--danger-bg-soft)',
            color: 'var(--danger)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: 'var(--space-8)',
            color: 'var(--text-muted)',
          }}
        >
          <Loader2 size={18} className="event-spin" /> 加载中…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title="事件库为空"
          description="尚未导入任何事件，点击右上角「导入 .opt-event」选择本地包。"
          action={
            <button className="btn-primary" onClick={() => importMod()}>
              <Upload size={16} /> 导入 .opt-event
            </button>
          }
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(var(--grid-card-min), 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {filtered.map((m) => (
            <LibraryCard
              key={m.id}
              meta={m}
              entry={entryById.get(m.id)}
              onEnable={enable}
              onDisable={disable}
              onUninstall={uninstall}
              onExport={exportMod}
              onOpen={onOpenMod}
              onImport={() => { void importMod(); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface LibraryCardProps {
  meta: EventMeta;
  entry?: EventRegistryEntry;
  onEnable: (id: string) => void | Promise<void>;
  onDisable: (id: string) => void | Promise<void>;
  onUninstall: (id: string) => void | Promise<void>;
  onExport: (id: string) => void | Promise<void>;
  onOpen: (entry: EventRegistryEntry) => void;
  onImport: () => void | Promise<void>;
}

function LibraryCard({
  meta,
  entry,
  onEnable,
  onDisable,
  onUninstall,
  onExport,
  onOpen,
  onImport,
}: LibraryCardProps) {
  const Icon = resolveEventIcon(meta.icon, meta.type);
  const coverText = textOn(meta.coverColor);
  const installed = !!entry;
  // 3 级层级：卡片本身为「事件包」(小类)，可展开显示包内「事件」(小小类)
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isActive = isEventActive(entry?.enabled);

  return (
    <div
      className="event-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderColor: hovered ? 'var(--accent)' : 'var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: hovered ? 'var(--shadow-md)' : 'none',
        transition:
          'box-shadow var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* 展开/收起事件包内事件（3 级层级：事件库 → 事件包 → 事件） */}
        <button
          type="button"
          className="btn-ghost btn-icon-sm"
          onClick={() => setExpanded((o) => !o)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起事件' : '展开事件'}
          style={{ flexShrink: 0, color: 'var(--text-secondary)' }}
        >
          <ChevronRight
            size={18}
            style={{
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform var(--duration-fast) var(--ease-out)',
            }}
          />
        </button>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-md)',
            background: meta.coverColor,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: coverText,
          }}
        >
          <Icon size={22} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {meta.name}
          </div>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {meta.author} · v{meta.version}
          </div>
        </div>
        <EventPackBadge packId={meta.id} />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
        }}
      >
        {installed ? (
          <EventSwitch
            checked={isActive}
            onChange={(next) => (next ? onEnable(meta.id) : onDisable(meta.id))}
            label={`启用 ${meta.name}`}
          />
        ) : (
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>未安装</span>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {installed ? (
            <>
              <button
                className="btn-ghost btn-icon-sm"
                title="打开"
                onClick={() => entry && onOpen(entry)}
              >
                <SquareArrowOutUpRight size={15} />
              </button>
              <button
                className="btn-ghost btn-icon-sm"
                title="导出"
                onClick={() => onExport(meta.id)}
              >
                <Download size={15} />
              </button>
              <button
                className="btn-ghost btn-icon-sm"
                title="卸载"
                style={{ color: 'var(--danger)' }}
                onClick={() => onUninstall(meta.id)}
              >
                <Trash2 size={15} />
              </button>
            </>
          ) : (
            <button className="btn-primary btn-sm" onClick={() => onImport()}>
              <Upload size={14} /> 导入
            </button>
          )}
        </div>
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
