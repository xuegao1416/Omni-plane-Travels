import { useState, useEffect, useRef, useCallback } from 'react';
import type { Props, EditModeEntry } from './worldBookEditor/types';
import { cleanEntries, createNewEntry } from './worldBookEditor/utils';
import { ImportExport } from './worldBookEditor/ImportExport';
import { EntryList } from './worldBookEditor/EntryList';

export default function WorldBookEditor({ world, onSave }: Props) {
  const [entries, setEntries] = useState<EditModeEntry[]>(() =>
    (world.worldBookEntries || []).map(e => ({ ...e })),
  );
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [importMsg, setImportMsg] = useState('');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const nextUidRef = useRef(Date.now());

  // 世界切换时重置状态
  useEffect(() => {
    setEntries((world.worldBookEntries || []).map(e => ({ ...e })));
    setExpanded(new Set());
    setImportMsg('');
    nextUidRef.current = Date.now();
  }, [world.id]);

  const genUid = useCallback(() => ++nextUidRef.current, []);

  const toggleExpand = (uid: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const updateEntry = (uid: number, patch: Partial<EditModeEntry>) => {
    setEntries(prev => prev.map(e => e.uid === uid ? { ...e, ...patch, _dirty: true } : e));
  };

  const deleteEntry = (uid: number) => {
    setEntries(prev => prev.filter(e => {
      if (e.uid === uid) return !e.constant;
      return true;
    }));
  };

  const addEntry = () => {
    const uid = genUid();
    setEntries(prev => [...prev, createNewEntry(uid, prev.length + 1)]);
    setExpanded(prev => new Set(prev).add(uid));
  };

  const handleSave = () => {
    onSave({ ...world, worldBookEntries: cleanEntries(entries) });
    setSaveMsg('保存成功');
    setTimeout(() => setSaveMsg(null), 2000);
  };

  return (
    <div className="wbe-root">
      <ImportExport
        entries={entries}
        worldName={world.name}
        importMsg={importMsg}
        saveMsg={saveMsg}
        onImportMsg={setImportMsg}
        onEntriesChange={setEntries}
        onAdd={addEntry}
        onSave={handleSave}
      />
      <EntryList
        entries={entries}
        expanded={expanded}
        onToggleExpand={toggleExpand}
        onUpdate={updateEntry}
        onDelete={deleteEntry}
        onAdd={addEntry}
      />
    </div>
  );
}
