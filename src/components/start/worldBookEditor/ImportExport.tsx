import { useRef, useCallback } from 'react';
import { Upload, Download, Plus, Save, AlertCircle } from 'lucide-react';
import type { WorldBookEntryDef } from '../../../data/worlds-schema';
import type { EditModeEntry } from './types';
import { cleanEntries } from './utils';

interface ImportExportProps {
  entries: EditModeEntry[];
  worldName: string;
  importMsg: string;
  saveMsg: string | null;
  onImportMsg: (msg: string) => void;
  onEntriesChange: (updater: (prev: EditModeEntry[]) => EditModeEntry[]) => void;
  onAdd: () => void;
  onSave: () => void;
}

export function ImportExport({
  entries, worldName, importMsg, saveMsg, onImportMsg, onEntriesChange, onAdd, onSave,
}: ImportExportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportEntries = useCallback(() => {
    const clean = cleanEntries(entries);
    const blob = new Blob([JSON.stringify({ worldBookEntries: clean }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${worldName}_entries.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries, worldName]);

  const importEntries = useCallback(() => fileInputRef.current?.click(), []);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        const incoming: WorldBookEntryDef[] = data.worldBookEntries || data.entries || [];
        if (!Array.isArray(incoming) || incoming.length === 0) {
          onImportMsg('未找到有效的条目数据');
          return;
        }
        onEntriesChange(prev => {
          const existingUids = new Set(prev.map(e => e.uid));
          const merged = [...prev];
          let added = 0, replaced = 0;
          for (const item of incoming) {
            if (existingUids.has(item.uid)) {
              merged[merged.findIndex(e => e.uid === item.uid)] = { ...item };
              replaced++;
            } else {
              merged.push({ ...item });
              added++;
            }
          }
          onImportMsg(`导入完成：新增 ${added} 条，替换 ${replaced} 条`);
          return merged;
        });
      } catch {
        onImportMsg('JSON 解析失败');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [onImportMsg, onEntriesChange]);

  return (
    <div className="wbe-toolbar">
      <div className="wbe-actions">
        <button className="wbe-btn wbe-btn-outline" onClick={importEntries} title="导入条目JSON">
          <Upload size={14} /> 导入
        </button>
        <button className="wbe-btn wbe-btn-outline" onClick={exportEntries} title="导出条目JSON">
          <Download size={14} /> 导出
        </button>
        <button className="wbe-btn wbe-btn-ghost" onClick={onAdd} title="新增触发式条目">
          <Plus size={14} /> 新增
        </button>
        <button className="wbe-btn wbe-btn-primary" onClick={onSave} title="保存编辑">
          <Save size={14} /> 保存
        </button>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />

      {importMsg && (
        <div className={`wbe-import-msg${importMsg.startsWith('导入完成') ? '' : ' wbe-import-msg-error'}`}>
          <AlertCircle size={14} /> {importMsg}
        </div>
      )}

      {saveMsg && (
        <div className="wbe-import-msg">
          <AlertCircle size={14} /> {saveMsg}
        </div>
      )}
    </div>
  );
}
