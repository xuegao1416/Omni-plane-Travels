import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Search, Store, X } from 'lucide-react';
import { PUBLIC_WORKSHOP_TYPES } from '../../workshopCatalog';
import { WORKSHOP_SORTS, WORKSHOP_SORT_LABELS, type WorkshopSort } from '../../workshop/protocol';
import { WORKSHOP_PAGE_SIZE, useWorkshopStore } from '../../stores/workshopStore';
import WorkshopCard from './WorkshopCard';
import { EmptyState, Spinner, TYPE_META } from './shared';

/** 发现页：搜索、类型、排序（全部由服务端支持）、分页。 */
export default function WorkshopBrowse({ onOpen }: { onOpen: (id: string) => void }) {
  const { query, items, total, loading, error, setQuery, fetchItems, installed } = useWorkshopStore();
  const [search, setSearch] = useState(query.q);

  useEffect(() => { void fetchItems(); }, [fetchItems]);
  useEffect(() => {
    if (search.trim() === query.q.trim()) return;
    const timer = setTimeout(() => { void setQuery({ q: search }); }, 350);
    return () => clearTimeout(timer);
  }, [search, query.q, setQuery]);

  const installedById = useMemo(() => new Map(installed.map(entry => [entry.record.itemId, entry])), [installed]);
  const pages = Math.max(1, Math.ceil(total / WORKSHOP_PAGE_SIZE));
  const filtered = Boolean(query.q.trim() || query.type || query.author);

  return (
    <section className="ws-section" aria-label="发现">
      <div className="ws-toolbar">
        <label className="ws-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            className="pk-input"
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void setQuery({ q: search }); }}
            placeholder="搜索标题、简介、标签"
            aria-label="搜索创意工坊"
          />
        </label>
        <label className="ws-sort registry-field">
          <span>排序</span>
          <select className="pk-input" value={query.sort} onChange={event => void setQuery({ sort: event.target.value as WorkshopSort })}>
            {WORKSHOP_SORTS.map(sort => <option key={sort} value={sort}>{WORKSHOP_SORT_LABELS[sort]}</option>)}
          </select>
        </label>
      </div>

      <div className="registry-type-tabs registry-workshop-type-tabs" role="group" aria-label="按类型筛选">
        <button type="button" aria-pressed={!query.type} onClick={() => void setQuery({ type: '' })}>全部</button>
        {PUBLIC_WORKSHOP_TYPES.map(type => (
          <button type="button" key={type} aria-pressed={query.type === type} onClick={() => void setQuery({ type })}>{TYPE_META[type].label}</button>
        ))}
      </div>

      {query.author && (
        <div className="ws-filter-chip">
          <span>只看作者「{query.authorName || query.author}」的作品</span>
          <button type="button" onClick={() => void setQuery({ author: '', authorName: '' })} aria-label="取消作者筛选"><X size={13} /></button>
        </div>
      )}

      {error && (
        <div className="registry-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>{error}</span>
          <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" onClick={() => void fetchItems()}>重试</button>
        </div>
      )}

      {!error && !loading && items.length === 0 && (
        <EmptyState icon={Store} title={filtered ? '没有符合条件的作品' : '创意工坊暂无内容'}>
          {filtered && <small>换个关键词，或切回“全部”看看。</small>}
        </EmptyState>
      )}

      {items.length > 0 && (
        <div className={`ws-grid${loading ? ' is-refreshing' : ''}`}>
          {items.map(item => <WorkshopCard key={item.id} item={item} installed={installedById.get(item.id)} onOpen={onOpen} />)}
        </div>
      )}
      {loading && items.length === 0 && <Spinner />}

      {pages > 1 && (
        <nav className="ws-pager" aria-label="分页">
          <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" disabled={query.page <= 1 || loading} onClick={() => void setQuery({ page: query.page - 1 })}>
            <ChevronLeft size={14} />上一页
          </button>
          <span>第 {query.page} / {pages} 页 · 共 {total} 件</span>
          <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" disabled={query.page >= pages || loading} onClick={() => void setQuery({ page: query.page + 1 })}>
            下一页<ChevronRight size={14} />
          </button>
        </nav>
      )}
    </section>
  );
}
