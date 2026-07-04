import { Lock } from 'lucide-react';
import { parseKeywordInput } from '../../../utils/formatNormalize';
import type { EditModeEntry } from './types';

interface EntryEditorProps {
  entry: EditModeEntry;
  isGlobal: boolean;
  onUpdate: (uid: number, patch: Partial<EditModeEntry>) => void;
}

export function EntryEditor({ entry, isGlobal, onUpdate }: EntryEditorProps) {
  return (
    <div className="wbe-entry-body">
      {/* 标题 */}
      <label className="wbe-field">
        <span className="wbe-label">标题</span>
        <input
          className="wbe-input"
          value={entry.comment}
          onChange={e => onUpdate(entry.uid, { comment: e.target.value })}
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
          onChange={e => onUpdate(entry.uid, { content: e.target.value })}
          disabled={isGlobal}
        />
      </label>

      {/* 关键词 */}
      <label className="wbe-field">
        <span className="wbe-label">触发关键词（逗号分隔）</span>
        <input
          className="wbe-input"
          value={entry.key?.join(', ') ?? ''}
          onChange={e => onUpdate(entry.uid, {
            key: parseKeywordInput(e.target.value),
          })}
          disabled={isGlobal}
          placeholder={isGlobal ? '全局条目始终生效' : '输入触发关键词...'}
        />
      </label>

      {/* 选项行 */}
      <div className="wbe-options-row">
        <label className="wbe-field wbe-field-sm">
          <span className="wbe-label">类型</span>
          <select
            className="wbe-input"
            value={entry.constant ? 'constant' : 'trigger'}
            disabled={isGlobal}
            onChange={e => onUpdate(entry.uid, { constant: e.target.value === 'constant' })}
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
            onChange={e => onUpdate(entry.uid, { order: Number(e.target.value) || 0 })}
            disabled={isGlobal}
          />
        </label>
        <label className="wbe-field wbe-field-sm">
          <span className="wbe-label">位置</span>
          <select
            className="wbe-input"
            value={entry.position ?? 'after_char'}
            onChange={e => onUpdate(entry.uid, { position: e.target.value as 'before_char' | 'after_char' })}
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
            onChange={e => onUpdate(entry.uid, { depth: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="不限"
          />
        </label>
        <label className="wbe-field wbe-field-sm">
          <span className="wbe-label">触发概率%</span>
          <input
            className="wbe-input"
            type="number"
            min={0} max={100}
            value={entry.probability ?? ''}
            onChange={e => onUpdate(entry.uid, { probability: e.target.value ? Number(e.target.value) : undefined })}
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
  );
}
