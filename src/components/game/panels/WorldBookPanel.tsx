// 世界书面板 — 展示当前世界的 worldBookEntries
import { useState,useMemo,useCallback } from 'react';
import { BookOpen,Pencil } from 'lucide-react';
import InGameWorldBookEditor from './InGameWorldBookEditor';
import type { WorldBookPanelProps } from './worldBook/types';
import { mapEntries,filterEntries,groupEntries } from './worldBook/utils';
import { EntryFilters } from './worldBook/EntryFilters';
import { EntryList } from './worldBook/EntryList';

export default function WorldBookPanel({ worldId, engine }: WorldBookPanelProps) {
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showDisabled, setShowDisabled] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);

  const entries = useMemo(() => mapEntries(worldId), [worldId]);
  const filtered = useMemo(() => filterEntries(entries, search, showDisabled), [entries, search, showDisabled]);
  const grouped = useMemo(() => groupEntries(filtered), [filtered]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <>
      <div className="game-worldbook-panel">
        {/* Header */}
        <div className="game-worldbook-header">
          <BookOpen size={16} style={{ color: 'var(--accent)' }} />
          <span className="game-worldbook-title">世界书</span>
          <span className="game-worldbook-meta">{worldId} · {entries.length} 条</span>
          <div className="game-worldbook-header-spacer" />
          {engine && (
            <button
              onClick={() => setEditorOpen(true)}
              title="编辑世界书条目"
              className="btn-secondary btn-sm"
            >
              <Pencil size={14} /> 编辑
            </button>
          )}
        </div>

        <EntryFilters
          search={search}
          onSearchChange={setSearch}
          showDisabled={showDisabled}
          onToggleDisabled={() => setShowDisabled(v => !v)}
        />

        <EntryList
          totalEntries={entries.length}
          filteredEntries={filtered}
          constant={grouped.constant}
          triggered={grouped.triggered}
          other={grouped.other}
          expandedIds={expandedIds}
          onToggle={toggleExpand}
        />
      </div>

      {engine && editorOpen && (
        <InGameWorldBookEditor
          key={worldId}
          engine={engine}
          worldId={worldId}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </>
  );
}
