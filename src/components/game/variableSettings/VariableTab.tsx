import { useMemo } from 'react';
import {
  ChevronDown, ChevronRight, Users,
} from 'lucide-react';
import type { GameState } from '../../../schema/variables';
import type { VariableSection } from '../../../engine/variableStructureDefs';
import { getVariableValue } from '../../../engine/variableStructureDefs';
import { resolveSectionIcon, displayValue } from './types';

interface NpcVariableEntry {
  npcId: string;
  npcName: string;
  path: string;
  displayName: string;
  sectionLabel: string;
  value: unknown;
}

export function VariableTab({
  sections, state, npcVariables, filter, onFilterChange,
  expandedSections, onToggleSection,
  expandedNpcs, onToggleNpc,
  editingVar, editValue, onStartEdit, onEditValueChange, onSaveEdit, onCancelEdit,
}: {
  sections: VariableSection[];
  state: GameState;
  npcVariables: NpcVariableEntry[];
  filter: string;
  onFilterChange: (v: string) => void;
  expandedSections: Set<string>;
  onToggleSection: (key: string) => void;
  expandedNpcs: Set<string>;
  onToggleNpc: (npcId: string) => void;
  editingVar: string | null;
  editValue: string;
  onStartEdit: (path: string, value: unknown) => void;
  onEditValueChange: (v: string) => void;
  onSaveEdit: (path: string) => void;
  onCancelEdit: () => void;
}) {
  const filterLower = filter.toLowerCase();

  const npcGroups = useMemo(() => {
    const groups = new Map<string, NpcVariableEntry[]>();
    for (const v of npcVariables) {
      const arr = groups.get(v.npcId) || [];
      arr.push(v);
      groups.set(v.npcId, arr);
    }
    return groups;
  }, [npcVariables]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        type="text"
        placeholder="搜索变量名、路径或值..."
        value={filter}
        onChange={e => onFilterChange(e.target.value)}
        style={{ maxWidth: 360, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', outline: 'none' }}
      />

      {/* 非 NPC 变量分组 */}
      {sections.map(section => {
        const filteredEntries = section.entries.filter(e => {
          if (!filterLower) return true;
          return (e.displayName ?? '').toLowerCase().includes(filterLower) || (e.canonicalPath ?? '').toLowerCase().includes(filterLower);
        });
        if (filteredEntries.length === 0) return null;
        const isExpanded = expandedSections.has(section.key);

        return (
          <div key={section.key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div onClick={() => onToggleSection(section.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-secondary)', cursor: 'pointer', borderBottom: isExpanded ? '1px solid var(--border)' : 'none' }}>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {(() => { const Icon = resolveSectionIcon(section.icon); return <Icon size={14} />; })()}
              <span style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-primary)' }}>{section.label}</span>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginLeft: 'auto' }}>{filteredEntries.length} 项</span>
            </div>
            {isExpanded && (
              <div style={{ padding: '4px 0' }}>
                {filteredEntries.map(entry => (
                  <VarRow
                    key={entry.id}
                    label={entry.displayName}
                    path={entry.canonicalPath}
                    value={getVariableValue(state, entry.canonicalPath)}
                    isEditing={editingVar === entry.canonicalPath}
                    editValue={editValue}
                    onStartEdit={onStartEdit}
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={() => onSaveEdit(entry.canonicalPath)}
                    onCancelEdit={onCancelEdit}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* NPC 分组 */}
      {npcGroups.size > 0 && (
        <div style={{ marginTop: 8, fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={14} /> NPC 人物档案
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>({npcGroups.size} 人)</span>
        </div>
      )}

      {Array.from(npcGroups.entries()).map(([npcId, entries]) => {
        const npcName = entries[0]?.npcName || npcId;
        const isExpanded = expandedNpcs.has(npcId);
        const filteredEntries = entries.filter(e => {
          if (!filterLower) return true;
          return (e.displayName ?? '').toLowerCase().includes(filterLower) || (e.path ?? '').toLowerCase().includes(filterLower) || (npcName ?? '').toLowerCase().includes(filterLower);
        });
        if (filteredEntries.length === 0) return null;

        return (
          <div key={npcId} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div onClick={() => onToggleNpc(npcId)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-secondary)', cursor: 'pointer', borderBottom: isExpanded ? '1px solid var(--border)' : 'none' }}>
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-primary)' }}>{npcName}</span>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>({npcId})</span>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginLeft: 'auto' }}>{filteredEntries.length} 项</span>
            </div>
            {isExpanded && (
              <div style={{ padding: '4px 0' }}>
                {filteredEntries.map((entry, i) => (
                  <VarRow
                    key={`${entry.path}-${i}`}
                    label={entry.displayName}
                    path={entry.path}
                    value={entry.value}
                    isEditing={editingVar === entry.path}
                    editValue={editValue}
                    onStartEdit={onStartEdit}
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={() => onSaveEdit(entry.path)}
                    onCancelEdit={onCancelEdit}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 单行变量（显示/编辑） */
function VarRow({
  label, path, value, isEditing, editValue, onStartEdit, onEditValueChange, onSaveEdit, onCancelEdit,
}: {
  label: string;
  path: string;
  value: unknown;
  isEditing: boolean;
  editValue: string;
  onStartEdit: (path: string, value: unknown) => void;
  onEditValueChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  const valueStr = displayValue(value);
  const isComplex = typeof value === 'object' && value !== null;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 14px 6px 36px', borderBottom: '1px dashed var(--border)' }}>
      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', minWidth: 120, flexShrink: 0, paddingTop: 2 }}>{label}</span>
      {isEditing ? (
        <div style={{ flex: 1, display: 'flex', gap: 6, flexDirection: 'column' }}>
          <textarea
            value={editValue}
            onChange={e => onEditValueChange(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%', minHeight: isComplex ? 80 : 28, padding: '4px 8px',
              border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)',
              fontFamily: isComplex ? "var(--font-mono, monospace)" : 'inherit', outline: 'none', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={onSaveEdit} style={{ padding: '3px 10px', border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: '#fff', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>保存</button>
            <button onClick={onCancelEdit} style={{ padding: '3px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      ) : (
        <span
          onClick={() => onStartEdit(path, value)}
          style={{
            flex: 1, fontSize: 'var(--font-size-sm)', color: isComplex ? 'var(--accent)' : 'var(--text-primary)',
            cursor: 'pointer', wordBreak: 'break-word', padding: '2px 4px', borderRadius: 'var(--radius-sm)', transition: 'background 0.15s',
            fontFamily: isComplex ? "var(--font-mono, monospace)" : 'inherit',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary, rgba(255,255,255,0.05))'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          title={`路径: ${path}\n点击编辑`}
        >
          {valueStr}
        </span>
      )}
    </div>
  );
}
