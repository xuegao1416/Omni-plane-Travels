// ============================================================
// 合集卡片 — 在 EventLibrary（合集库）中显示
//   - 封面色块 + 图标 + 名称 + 成员数量 + 作者
//   - 操作：编辑、删除按钮
//   - 点击展开显示成员列表（复用 EventListRow 样式）
// ============================================================
import { useState } from 'react';
import {
  ChevronRight,
  Pencil,
  Trash2,
  Package,
  FolderPlus,
  Layers,
  Star,
  Zap,
  Shield,
  Crown,
  Heart,
  Gem,
  Compass,
  Feather,
  Globe,
  Map,
  Swords,
  Wand2,
  Boxes,
  type LucideIcon,
} from 'lucide-react';
import type { EventRegistryEntry } from '../../modules/schema';
import type { Collection } from '../../modules/schema';
import { textOn } from './colorUtils';
import EventSwitch from './EventSwitch';
import { useIsPhone } from '../../hooks/useIsMobile';

// 图名 → Lucide 映射（与 CollectionCreateDialog 一致）
const ICON_MAP: Record<string, LucideIcon> = {
  FolderPlus, Package, Boxes, Layers, Star, Zap, Shield, Crown,
  Heart, Gem, Compass, Feather, Globe, Map, Swords, Wand2,
};

function resolveCollectionIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? FolderPlus;
}

interface CollectionCardProps {
  collection: Collection;
  memberEntries: EventRegistryEntry[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onEnableMember: (id: string) => void | Promise<void>;
  onDisableMember: (id: string) => void | Promise<void>;
  onOpenMember?: (entry: EventRegistryEntry) => void;
}

export default function CollectionCard({
  collection,
  memberEntries,
  onEdit,
  onDelete,
  onEnableMember,
  onDisableMember,
  onOpenMember,
}: CollectionCardProps) {
  const isPhone = useIsPhone();
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const Icon = resolveCollectionIcon(collection.icon);
  const coverText = textOn(collection.coverColor);

  return (
    <div
      className="event-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderColor: hovered ? 'var(--accent)' : 'var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: hovered ? 'var(--shadow-md)' : 'none',
        transition:
          'box-shadow var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 主行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* 展开/收起 */}
        <button
          type="button"
          className="btn-ghost btn-icon-sm"
          onClick={() => setExpanded((o) => !o)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起成员' : '展开成员'}
          style={{ flexShrink: 0, color: 'var(--text-secondary)' }}
        >
          <ChevronRight
            size={18}
            style={{
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform var(--duration-fast) var(--ease-out)',
            }}
          />
        </button>

        {/* 封面色块 */}
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-md)',
            background: collection.coverColor,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: coverText,
          }}
        >
          <Icon size={22} strokeWidth={1.75} />
        </div>

        {/* 信息 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {collection.name}
          </div>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--text-muted)',
              marginTop: 2,
            }}
          >
            {memberEntries.length} 个成员
          </div>
        </div>

        {/* 操作 */}
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          <button
            className="btn-ghost btn-icon-sm"
            title="编辑"
            onClick={() => onEdit(collection.id)}
          >
            <Pencil size={15} />
          </button>
          <button
            className="btn-ghost btn-icon-sm"
            title="删除"
            style={{ color: 'var(--danger)' }}
            onClick={() => onDelete(collection.id)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* 展开的成员列表 */}
      {expanded && memberEntries.length > 0 && (
        <div
          style={{
            marginLeft: 'var(--space-8)',
            paddingLeft: 'var(--space-3)',
            borderLeft: '2px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {memberEntries.map((entry) => (
            <MemberRow
              key={entry.meta.id}
              entry={entry}
              onEnable={onEnableMember}
              onDisable={onDisableMember}
              onOpen={onOpenMember}
              isPhone={isPhone}
            />
          ))}
        </div>
      )}

      {expanded && memberEntries.length === 0 && (
        <div
          style={{
            marginLeft: 'var(--space-8)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-muted)',
            padding: 'var(--space-2)',
          }}
        >
          合集中暂无成员
        </div>
      )}
    </div>
  );
}

// ─── 成员行（简化版 EventListRow） ───

function MemberRow({
  entry,
  onEnable,
  onDisable,
  onOpen,
  isPhone,
}: {
  entry: EventRegistryEntry;
  onEnable: (id: string) => void | Promise<void>;
  onDisable: (id: string) => void | Promise<void>;
  onOpen?: (entry: EventRegistryEntry) => void;
  isPhone: boolean;
}) {
  const { meta } = entry;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isPhone ? 'var(--space-2)' : 'var(--space-3)',
        padding: isPhone ? 'var(--space-2) var(--space-3)' : 'var(--space-2) var(--space-3)',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div
        style={{
          width: isPhone ? 32 : 36,
          height: isPhone ? 32 : 36,
          borderRadius: 'var(--radius-md)',
          background: meta.coverColor,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: textOn(meta.coverColor || '#333'),
          fontSize: 'var(--font-size-xs)',
          fontWeight: 600,
        }}
      >
        {meta.name.charAt(0)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: isPhone ? 'var(--font-size-xs)' : 'var(--font-size-sm)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {meta.name}
        </div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          v{meta.version}
        </div>
      </div>
      {onOpen && (
        <button
          className="btn-ghost btn-icon-sm"
          title="打开"
          onClick={() => onOpen(entry)}
          style={{ flexShrink: 0 }}
        >
          <ChevronRight size={14} />
        </button>
      )}
      <EventSwitch
        checked={entry.enabled}
        onChange={(next) => (next ? onEnable(meta.id) : onDisable(meta.id))}
        label={`启用 ${meta.name}`}
      />
    </div>
  );
}
