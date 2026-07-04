import { Lock, Plus, Save, Upload, Download, AlertCircle, X, Pencil } from 'lucide-react';
import type { EditEntry } from './types';
import s from './styles.module.css';

interface ToolbarProps {
  worldId: string;
  entries: EditEntry[];
  importMsg: string;
  saveMsg: { type: 'success' | 'error'; text: string } | null;
  onClose: () => void;
  onImport: () => void;
  onExport: () => void;
  onAdd: () => void;
  onSave: () => void;
}

export function Toolbar({
  worldId, entries, importMsg, saveMsg,
  onClose, onImport, onExport, onAdd, onSave,
}: ToolbarProps) {
  const globalCount = entries.filter(e => e.constant).length;
  const triggerCount = entries.filter(e => !e.constant).length;

  return (
    <>
      {/* 头部 */}
      <div className={s.header}>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>
          编辑世界书
        </h2>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {worldId} · {entries.length} 条
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} className="btn-ghost btn-icon-sm" title="关闭">
          <X size={20} />
        </button>
      </div>

      {/* 提示信息 */}
      <div className={s.infoBar}>
        <span
          className={s.badge}
          style={{ background: 'color-mix(in srgb, var(--warning) 12%, transparent)', color: 'var(--warning)' }}
        >
          <Lock size={12} /> 全局 {globalCount}（只读）
        </span>
        <span
          className={s.badge}
          style={{ background: 'color-mix(in srgb, var(--success) 12%, transparent)', color: 'var(--success)' }}
        >
          <Pencil size={12} /> 触发 {triggerCount}（可编辑）
        </span>
        <span className={s.infoHint}>
          保存后立即生效于当前游戏
        </span>
      </div>

      {/* 工具栏按钮 */}
      <div className={s.toolbar}>
        <button className="wbe-btn wbe-btn-outline" onClick={onImport} title="导入条目JSON">
          <Upload size={14} /> 导入
        </button>
        <button className="wbe-btn wbe-btn-outline" onClick={onExport} title="导出条目JSON">
          <Download size={14} /> 导出
        </button>
        <button className="wbe-btn wbe-btn-ghost" onClick={onAdd} title="新增触发式条目">
          <Plus size={14} /> 新增
        </button>
        <button className="wbe-btn wbe-btn-primary" onClick={onSave} title="保存并应用到当前游戏">
          <Save size={14} /> 保存
        </button>
      </div>

      {/* 导入提示 */}
      {importMsg && (
        <div
          className={s.importMsg}
          style={{
            background: importMsg.startsWith('导入完成')
              ? 'color-mix(in srgb, var(--success) 8%, transparent)'
              : 'color-mix(in srgb, var(--warning) 8%, transparent)',
            color: importMsg.startsWith('导入完成') ? 'var(--success)' : 'var(--warning)',
          }}
        >
          <AlertCircle size={14} /> {importMsg}
        </div>
      )}

      {/* 保存提示 */}
      {saveMsg && (
        <div
          className={s.importMsg}
          style={{
            background: saveMsg.type === 'success'
              ? 'color-mix(in srgb, var(--success) 8%, transparent)'
              : 'color-mix(in srgb, var(--danger) 8%, transparent)',
            color: saveMsg.type === 'success' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          <AlertCircle size={14} /> {saveMsg.text}
        </div>
      )}
    </>
  );
}
