import { AlertTriangle, X } from 'lucide-react';

interface Props {
  tabKey: string;
  text: string;
  saving: boolean;
  error: string;
  onTextChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/**
 * 原始 JSON 编辑器弹窗：显示 textarea、错误信息、保存/取消按钮。
 */
export function RawEditor({ tabKey, text, saving, error, onTextChange, onSave, onClose }: Props) {
  return (
    <div className="ms-editor-overlay" onClick={() => !saving && onClose()}>
      <div className="ms-editor-card" onClick={e => e.stopPropagation()}>
        <div className="ms-editor-header">
          <div>
            <div className="ms-editor-title">{tabKey} 原始内容</div>
            <div className="ms-editor-subtitle">直接编辑当前分类整组 JSON，保存后立即写回当前存档并刷新图谱。</div>
          </div>
          <button className="ms-editor-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="ms-editor-body">
          <div className="ms-editor-hint">
            请输入合法的 JSON {tabKey === 'scene' ? '对象' : '数组'}。保存后会立即覆盖当前存档中对应分类的数据。
          </div>
          <textarea
            className="ms-textarea"
            style={{ minHeight: 420 }}
            value={text}
            onChange={e => onTextChange(e.target.value)}
            spellCheck={false}
          />
          {error && (
            <div className="ms-editor-error"><AlertTriangle size={14} />{error}</div>
          )}
          <div className="ms-editor-actions">
            <button className="ms-btn-sm" disabled={saving} onClick={onClose}>
              取消
            </button>
            <button className="ms-btn-sm ms-editor-save" disabled={saving} onClick={onSave}>
              {saving ? '保存中...' : '保存并刷新图谱'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
