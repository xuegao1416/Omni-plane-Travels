import type { EditEntry } from './types';
import { EntryEditor } from './EntryEditor';
import s from './styles.module.css';

interface EntryListProps {
  entries: EditEntry[];
  expanded: Set<number>;
  onToggleExpand: (uid: number) => void;
  onUpdate: (uid: number, patch: Partial<EditEntry>) => void;
  onDelete: (uid: number) => void;
  onAdd: () => void;
}

export function EntryList({
  entries, expanded, onToggleExpand, onUpdate, onDelete, onAdd,
}: EntryListProps) {
  if (entries.length === 0) {
    return (
      <div className={s.entryList}>
        <div className={s.emptyState}>
          <p>暂无条目</p>
          <button className={`wbe-btn wbe-btn-outline ${s.addBtn}`} onClick={onAdd}>新增条目</button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.entryList}>
      {entries.map((entry, idx) => (
        <EntryEditor
          key={entry.uid}
          entry={entry}
          index={idx}
          isExpanded={expanded.has(entry.uid)}
          onToggleExpand={onToggleExpand}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
