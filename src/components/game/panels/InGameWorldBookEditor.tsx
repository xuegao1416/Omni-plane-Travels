import { useState, useRef, useCallback } from 'react';
import type { GameEngine } from '../../../engine/types';
import { convertWorldBookDefsToEntries } from '../../../worldbook/index';
import { findWorldDef } from '../../../data/worldLoader';
import type { WorldBookEntryDef, WorldDef } from '../../../data/worlds-schema';
import type { EditEntry } from './inGameWorldBook/types';
import { persistWorldToStorage, loadDefs } from './inGameWorldBook/utils';
import { Toolbar } from './inGameWorldBook/Toolbar';
import { EntryList } from './inGameWorldBook/EntryList';
import s from './inGameWorldBook/styles.module.css';

interface Props {
  engine: GameEngine;
  worldId: string;
  onClose: () => void;
}

export default function InGameWorldBookEditor({ engine, worldId, onClose }: Props) {
  const [entries, setEntries] = useState<EditEntry[]>(() => loadDefs(worldId));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [importMsg, setImportMsg] = useState('');
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextUidRef = useRef(Date.now());
  const genUid = useCallback(() => --nextUidRef.current, []);

  const toggleExpand = (uid: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };
  const updateEntry = (uid: number, patch: Partial<EditEntry>) => {
    setEntries(prev => prev.map(e => e.uid === uid ? { ...e, ...patch, _dirty: true } : e));
  };
  const deleteEntry = (uid: number) => {
    setEntries(prev => prev.filter(e => e.uid === uid ? !e.constant : true));
  };
  const addEntry = () => {
    const uid = genUid();
    setEntries(prev => [...prev, {
      uid, key: [], comment: '新条目', content: '',
      constant: false, order: prev.length + 1, position: 'after_char', _dirty: true,
    }]);
    setExpanded(prev => new Set(prev).add(uid));
  };
  const exportEntries = () => {
    const clean = entries.map(({ _dirty, ...rest }) => rest);
    const blob = new Blob([JSON.stringify({ worldBookEntries: clean }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${worldId}_entries.json`; a.click();
    URL.revokeObjectURL(url);
  };
  const importEntries = () => fileInputRef.current?.click();

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const incoming: WorldBookEntryDef[] = data.worldBookEntries || data.entries || [];
        if (!Array.isArray(incoming) || incoming.length === 0) { setImportMsg('未找到有效的条目数据'); return; }
        setEntries(prev => {
          const existingUids = new Set(prev.map(e => e.uid));
          const merged = [...prev]; let added = 0; let replaced = 0;
          for (const item of incoming) {
            if (existingUids.has(item.uid)) { merged[merged.findIndex(e => e.uid === item.uid)] = { ...item }; replaced++; }
            else { merged.push({ ...item }); added++; }
          }
          setImportMsg(`导入完成：新增 ${added} 条，替换 ${replaced} 条`);
          return merged;
        });
      } catch { setImportMsg('JSON 解析失败'); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const handleSave = () => {
    if (!engine.worldBook) { setSaveMsg({ type: 'error', text: '世界书引擎未初始化' }); setTimeout(() => setSaveMsg(null), 3000); return; }
    const clean: WorldBookEntryDef[] = entries.map(({ _dirty, ...rest }) => rest);
    try {
      const world = findWorldDef(worldId);
      if (world) { persistWorldToStorage({ ...world, worldBookEntries: clean }); }
      else { setSaveMsg({ type: 'error', text: `未找到世界定义: ${worldId}` }); setTimeout(() => setSaveMsg(null), 3000); return; }
    } catch (err) { console.error('[世界书保存] 持久化失败:', err); setSaveMsg({ type: 'error', text: '持久化失败' }); setTimeout(() => setSaveMsg(null), 3000); return; }
    engine.worldBook.clearWorldEntries();
    engine.worldBook.addEntries(convertWorldBookDefsToEntries(clean));
    setSaveMsg({ type: 'success', text: '保存成功' });
    setTimeout(() => { setSaveMsg(null); onClose(); }, 800);
  };

  return (
    <div className={s.overlay}>
      <div className={s.panel}>
        <Toolbar
          worldId={worldId} entries={entries} importMsg={importMsg} saveMsg={saveMsg}
          onClose={onClose} onImport={importEntries} onExport={exportEntries} onAdd={addEntry} onSave={handleSave}
        />
        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
        <EntryList
          entries={entries} expanded={expanded}
          onToggleExpand={toggleExpand} onUpdate={updateEntry} onDelete={deleteEntry} onAdd={addEntry}
        />
      </div>
    </div>
  );
}
