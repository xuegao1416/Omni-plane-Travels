import { useState, useRef, useCallback } from 'react';
import type { GameEngine } from '../../../engine/types';
import { convertWorldBookDefsToEntries } from '../../../worldbook/index';
import { findWorldDef } from '../../../data/worldLoader';
import type { WorldBookEntryDef, WorldDef } from '../../../data/worlds-schema';
import type { EditEntry } from './inGameWorldBook/types';
import { persistWorldToStorage, loadDefs } from './inGameWorldBook/utils';
import { parseWorldBookImport, mergeWorldBookEntries } from '../../../utils/worldBookImport';
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
        // 兼容多种格式：worldBookEntries / entries（大小写不限，数组或对象均可）/ 角色卡内嵌
        const parsed = parseWorldBookImport(data);
        if (parsed.entries.length === 0) { setImportMsg('未找到有效的条目数据（支持 worldBookEntries / entries，数组或对象格式均可）'); return; }
        setEntries(prev => {
          const result = mergeWorldBookEntries(prev as WorldBookEntryDef[], parsed);
          setImportMsg(`导入完成：新增 ${result.added} 条，替换 ${result.replaced} 条`);
          return result.merged as EditEntry[];
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
    <div className={`${s.overlay} game-journey__nested-overlay`}>
      <div className={`${s.panel} game-journey__nested-panel`}>
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
