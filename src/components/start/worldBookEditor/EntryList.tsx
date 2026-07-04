import { Lock, Trash2, Plus, ChevronDown, ChevronUp, Edit3 } from 'lucide-react';
import type { EditModeEntry } from './types';
import { EntryEditor } from './EntryEditor';

interface EntryListProps {
  entries: EditModeEntry[];
  expanded: Set<number>;
  onToggleExpand: (uid: number) => void;
  onUpdate: (uid: number, patch: Partial<EditModeEntry>) => void;
  onDelete: (uid: number) => void;
  onAdd: () => void;
}

export function EntryList({ entries, expanded, onToggleExpand, onUpdate, onDelete, onAdd }: EntryListProps) {
  const globalCount = entries.filter(e => e.constant).length;
  const triggerCount = entries.filter(e => !e.constant).length;

  return (
    <>
      {/* 统计信息 */}
      <div className="wbe-info" style={{ marginBottom: 8 }}>
        <span className="wbe-badge wbe-badge-global"><Lock size={12} /> 全局 {globalCount}</span>
        <span className="wbe-badge wbe-badge-trigger"><Edit3 size={12} /> 触发 {triggerCount}</span>
        <span className="wbe-hint">全局条目只读 · 触发条目可编辑</span>
      </div>

      {/* 条目列表 */}
      <div className="wbe-entries">
        {entries.length === 0 ? (
          <div className="wbe-empty">
            <p>暂无条目</p>
            <button className="wbe-btn wbe-btn-outline" onClick={onAdd}>新增条目</button>
          </div>
        ) : (
          entries.map((entry, idx) => {
            const isExpanded = expanded.has(entry.uid);
            const isGlobal = entry.constant;

            return (
              <div key={entry.uid} className={`wbe-entry${isGlobal ? ' wbe-entry-global' : ''}${isExpanded ? ' wbe-entry-expanded' : ''}`}>
                {/* 条目头部 */}
                <div className="wbe-entry-header" onClick={() => onToggleExpand(entry.uid)}>
                  <div className="wbe-entry-left">
                    <span className="wbe-entry-order">{idx + 1}</span>
                    {isGlobal ? (
                      <span className="wbe-entry-lock" title="全局条目（只读）"><Lock size={13} /></span>
                    ) : (
                      <span className="wbe-entry-type-dot" />
                    )}
                    <span className="wbe-entry-title">{entry.comment || '（无标题）'}</span>
                  </div>
                  <div className="wbe-entry-right">
                    {isGlobal && <span className="wbe-tag-locked">受保护</span>}
                    {!isGlobal && (
                      <button
                        className="wbe-entry-delete"
                        onClick={e => { e.stopPropagation(); onDelete(entry.uid); }}
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
                  <EntryEditor entry={entry} isGlobal={isGlobal} onUpdate={onUpdate} />
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
