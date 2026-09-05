import { useRef, useCallback } from 'react';
import { Upload, Download, Plus, Save, AlertCircle } from 'lucide-react';
import type { WorldBookEntryDef } from '../../../data/worlds-schema';
import type { EditModeEntry } from './types';
import { cleanEntries } from './utils';
import { parseWorldBookImport, mergeWorldBookEntries } from '../../../utils/worldBookImport';

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
        // 兼容多种格式：worldBookEntries / entries（大小写不限，数组或对象均可）/ 角色卡内嵌
        const parsed = parseWorldBookImport(data);
        if (parsed.entries.length === 0) {
          onImportMsg('未找到有效的条目数据（支持 worldBookEntries / entries，数组或对象格式均可）');
          return;
        }
        onEntriesChange(prev => {
          const result = mergeWorldBookEntries(prev as WorldBookEntryDef[], parsed);
          onImportMsg(`导入完成：新增 ${result.added} 条，替换 ${result.replaced} 条`);
          return result.merged as EditModeEntry[];
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
