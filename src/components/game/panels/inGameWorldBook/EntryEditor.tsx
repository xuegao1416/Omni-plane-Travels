import { Lock, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { parseKeywordInput } from '../../../../utils/formatNormalize';
import type { EditEntry } from './types';

interface EntryEditorProps {
  entry: EditEntry;
  index: number;
  isExpanded: boolean;
  onToggleExpand: (uid: number) => void;
  onUpdate: (uid: number, patch: Partial<EditEntry>) => void;
  onDelete: (uid: number) => void;
}

export function EntryEditor({
  entry, index, isExpanded, onToggleExpand, onUpdate, onDelete,
}: EntryEditorProps) {
  const isGlobal = entry.constant;
  const isEnabled = !entry.disable;
  const keys = entry.key ?? [];

  return (
    <div className={`wbe-entry${isGlobal ? ' wbe-entry-global' : ''}${isExpanded ? ' wbe-entry-expanded' : ''}`}>
      {/* 条目头部 */}
      <div className="wbe-entry-header" onClick={() => onToggleExpand(entry.uid)}>
        <div className="wbe-entry-left">
          <span className="wbe-entry-order">{index + 1}</span>
          {isGlobal ? (
            <span className="wbe-entry-lock" title="全局条目（只读）"><Lock size={13} /></span>
          ) : isEnabled ? (
            <span className="wbe-entry-type-dot" />
          ) : (
            <span className="wbe-entry-type-dot" style={{ background: 'var(--text-muted)' }} />
          )}
          <span className="wbe-entry-title">{entry.comment || '（无标题）'}</span>
        </div>
        <div className="wbe-entry-right">
          {isGlobal && <span className="wbe-tag-locked">受保护</span>}
          {!isGlobal && (
            <button
              className="wbe-entry-delete"
              onClick={e2 => { e2.stopPropagation(); onDelete(entry.uid); }}
              title="删除条目"
            >
              <Trash2 size={13} />
            </button>
          )}
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {/* 展开内容 */}
      {isExpanded && (
        <div className="wbe-entry-body">
          {/* 标题 */}
          <label className="wbe-field">
            <span className="wbe-label">标题</span>
            <input
              className="wbe-input"
              value={entry.comment}
              onChange={e2 => onUpdate(entry.uid, { comment: e2.target.value })}
              disabled={isGlobal}
            />
          </label>

          {/* 内容 */}
          <label className="wbe-field">
            <span className="wbe-label">内容</span>
            <textarea
              className="wbe-textarea"
              rows={6}
              value={entry.content}
              onChange={e2 => onUpdate(entry.uid, { content: e2.target.value })}
              disabled={isGlobal}
            />
          </label>

          {/* 关键词 */}
          <label className="wbe-field">
            <span className="wbe-label">触发关键词（逗号分隔）</span>
            <input
              className="wbe-input"
              value={keys.join(', ')}
              onChange={e2 => onUpdate(entry.uid, {
                key: parseKeywordInput(e2.target.value),
              })}
              disabled={isGlobal}
              placeholder={isGlobal ? '全局条目始终生效' : '输入触发关键词...'}
            />
          </label>

          {/* 选项行 */}
          <div className="wbe-options-row">
            <label className="wbe-field wbe-field-sm">
              <span className="wbe-label">启用</span>
              <select
                className="wbe-input"
                value={entry.disable ? 'disabled' : 'enabled'}
                disabled={isGlobal}
                onChange={e2 => onUpdate(entry.uid, { disable: e2.target.value === 'disabled' })}
              >
                <option value="enabled">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </label>
            <label className="wbe-field wbe-field-sm">
              <span className="wbe-label">类型</span>
              <select
                className="wbe-input"
                value={entry.constant ? 'constant' : 'trigger'}
                disabled={isGlobal}
                onChange={e2 => onUpdate(entry.uid, { constant: e2.target.value === 'constant' })}
              >
                <option value="trigger">触发式</option>
                <option value="constant">全局</option>
              </select>
            </label>
            <label className="wbe-field wbe-field-sm">
              <span className="wbe-label">排序</span>
              <input
                className="wbe-input"
                type="number"
                value={entry.order}
                onChange={e2 => onUpdate(entry.uid, { order: Number(e2.target.value) || 0 })}
                disabled={isGlobal}
              />
            </label>
            <label className="wbe-field wbe-field-sm">
              <span className="wbe-label">位置</span>
              <select
                className="wbe-input"
                value={entry.position ?? 'after_char'}
                onChange={e2 => onUpdate(entry.uid, { position: e2.target.value as 'before_char' | 'after_char' })}
                disabled={isGlobal}
              >
                <option value="after_char">角色定义后</option>
                <option value="before_char">角色定义前</option>
              </select>
            </label>
            <label className="wbe-field wbe-field-sm">
              <span className="wbe-label">深度</span>
              <input
                className="wbe-input"
                type="number"
                value={entry.depth ?? ''}
                onChange={e2 => onUpdate(entry.uid, { depth: e2.target.value ? Number(e2.target.value) : undefined })}
                placeholder="不限"
              />
            </label>
            <label className="wbe-field wbe-field-sm">
              <span className="wbe-label">概率%</span>
              <input
                className="wbe-input"
                type="number"
                min={0} max={100}
                value={entry.probability ?? ''}
                onChange={e2 => onUpdate(entry.uid, { probability: e2.target.value ? Number(e2.target.value) : undefined })}
                placeholder="100"
              />
            </label>
          </div>

          {isGlobal && (
            <div className="wbe-global-hint">
              <Lock size={12} /> 全局条目无法在此编辑。如需修改，请导出 → 编辑JSON → 重新导入。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
