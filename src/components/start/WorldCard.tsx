import { Pencil, Trash2, Plus, ExternalLink } from 'lucide-react';
import type { WorldDef } from '../../data/worldLoader';
import { resolveWorldIcon } from '../shared/worldIcons';

export function getWorldIcon(world: WorldDef) {
  return resolveWorldIcon(world.icon);
}

/** 难度配置 */
const DIFFICULTY_CONFIG: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: '#22c55e' },
  medium: { label: '中等', color: '#f59e0b' },
  hard: { label: '困难', color: '#ef4444' },
};

interface WorldCardProps {
  world: WorldDef;
  selected: boolean;
  onSelect: () => void;
  onEdit?: (e: React.MouseEvent) => void;
  onDelete?: () => void;
  isCustom?: boolean;
}

/** 世界卡片 — 质感卡片：图标区域 + 名称 + 难度 + 操作按钮 */
export default function WorldCard({ world, selected, onSelect, onEdit, onDelete, isCustom }: WorldCardProps) {
  const Icon = getWorldIcon(world);
  const difficulty = DIFFICULTY_CONFIG[world.difficulty ?? 'medium'];
  const hasActions = isCustom && (onEdit || onDelete);
  return (
    <div
      className={`world-card${selected ? ' selected' : ''}${hasActions ? ' has-actions' : ''}`}
      onClick={onSelect}
      style={{ '--cover-color': world.coverColor ?? 'var(--accent)' } as React.CSSProperties}
    >
      <div className="world-card-icon">
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="world-card-body">
        <span className="world-card-name">
          {world.name}
          {world.source === 'external' && (
            <span className="world-card-external-badge"><ExternalLink size={9} /> 外部</span>
          )}
        </span>
        <div className="world-card-meta">
          {hasActions && (
            <div className="world-card-actions">
              {onEdit && (
                <button className="world-card-edit" onClick={e => { e.stopPropagation(); onEdit(e); }} title="编辑">
                  <Pencil size={10} />
                </button>
              )}
              {onDelete && (
                <button className="world-card-delete" onClick={e => { e.stopPropagation(); onDelete(); }} title="删除">
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          )}
          {difficulty && (
            <span className="world-card-difficulty" style={{ '--diff-color': difficulty.color } as React.CSSProperties}>
              {difficulty.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** 新建世界卡片 */
export function CreateWorldCard({ onClick }: { onClick: () => void }) {
  return (
    <div className="world-card create" onClick={onClick}>
      <Plus size={16} strokeWidth={1.5} />
      <span>新建世界</span>
    </div>
  );
}
