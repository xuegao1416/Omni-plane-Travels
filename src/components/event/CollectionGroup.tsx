// ============================================================
// 合集分组 — 在 EventCenter（已安装）和 EventConfigPanel（游戏内）中使用
//   - 合集标题行：封面色块 + 图标 + 名称 + 成员数量 + 总开关 + 删除按钮
//   - 可折叠：点击标题展开/收起成员列表
//   - 成员列表复用 EventListRow 样式
//   - 支持 inGamePanel 模式（游戏内面板样式略有不同）
// ============================================================
import { useState } from 'react';
import {
  ChevronRight,
  Trash2,
  FolderPlus,
  Package,
  Boxes,
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
  type LucideIcon,
} from 'lucide-react';
import type { EventRegistryEntry } from '../../modules/schema';
import type { Collection } from '../../modules/schema';
import { textOn } from './colorUtils';
import EventSwitch from './EventSwitch';
import EventPackBadge from './EventPackBadge';
import { useIsPhone } from '../../hooks/useIsMobile';
import { isEventActive } from '../../modules/eventActivation';

// 图名 → Lucide 映射
const ICON_MAP: Record<string, LucideIcon> = {
  FolderPlus, Package, Boxes, Layers, Star, Zap, Shield, Crown,
  Heart, Gem, Compass, Feather, Globe, Map, Swords, Wand2,
};

function resolveCollectionIcon(iconName: string): LucideIcon {
  return ICON_MAP[iconName] ?? FolderPlus;
}

interface CollectionGroupProps {
  collection: Collection;
  memberEntries: EventRegistryEntry[];
  /** 合集总开关回调（批量开关成员的全局 enabled） */
  onToggleAll: (collectionId: string, enable: boolean) => void;
  onDelete: (collectionId: string) => void;
  onEnableMember: (id: string) => void | Promise<void>;
  onDisableMember: (id: string) => void | Promise<void>;
  onOpenMember?: (entry: EventRegistryEntry) => void;
  /** 游戏内面板模式（样式微调） */
  inGamePanel?: boolean;
}

export default function CollectionGroup({
  collection,
  memberEntries,
  onToggleAll,
  onDelete,
  onEnableMember,
  onDisableMember,
  onOpenMember,
  inGamePanel = false,
}: CollectionGroupProps) {
  const isPhone = useIsPhone();
  const [expanded, setExpanded] = useState(false);
  const Icon = resolveCollectionIcon(collection.icon);
  const coverText = textOn(collection.coverColor);

  // 合集总开关 = 所有成员都启用
  const allEnabled = memberEntries.length > 0 && memberEntries.every((e) => isEventActive(e.enabled));
  const someEnabled = memberEntries.some((e) => isEventActive(e.enabled));

  const handleToggleAll = (next: boolean) => {
    onToggleAll(collection.id, next);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* 合集标题行 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isPhone ? 'var(--space-2)' : 'var(--space-3)',
          padding: inGamePanel
            ? isPhone
              ? 'var(--space-3)'
              : 'var(--space-2) var(--space-3)'
            : isPhone
              ? 'var(--space-2) var(--space-3)'
              : 'var(--space-3) var(--space-4)',
          background: 'var(--bg-secondary)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded((o) => !o)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((o) => !o);
          }
        }}
      >
        {/* 展开箭头 */}
        <ChevronRight
          size={isPhone ? 16 : 18}
          style={{
            flexShrink: 0,
            color: 'var(--text-secondary)',
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform var(--duration-fast) var(--ease-out)',
          }}
        />

        {/* 封面色块 */}
        <div
          style={{
            width: inGamePanel ? (isPhone ? 36 : 28) : isPhone ? 40 : 48,
            height: inGamePanel ? (isPhone ? 36 : 28) : isPhone ? 40 : 48,
            borderRadius: 'var(--radius-md)',
            background: collection.coverColor,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: coverText,
          }}
        >
          <Icon size={inGamePanel ? (isPhone ? 18 : 15) : isPhone ? 18 : 22} strokeWidth={1.75} />
        </div>

        {/* 名称 + 成员数 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: inGamePanel ? 'var(--font-size-md)' : isPhone ? 'var(--font-size-sm)' : 'var(--font-size-md)',
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
              marginTop: inGamePanel ? 0 : 2,
            }}
          >
            {memberEntries.length} 个成员
          </div>
        </div>

        {/* 操作区（阻止冒泡） */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="btn-ghost btn-icon-sm"
            title="删除合集"
            style={{ color: 'var(--danger)', padding: isPhone ? 4 : undefined }}
            onClick={() => onDelete(collection.id)}
          >
            <Trash2 size={isPhone ? 14 : 15} />
          </button>
          <EventSwitch
            checked={allEnabled}
            onChange={handleToggleAll}
            label={allEnabled ? '全部启用' : '全部禁用'}
          />
        </div>
      </div>

      {/* 成员列表 */}
      {expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            padding: inGamePanel ? 'var(--space-2)' : 'var(--space-2) var(--space-3)',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-primary)',
          }}
        >
          {memberEntries.length === 0 ? (
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-muted)',
                textAlign: 'center',
                padding: 'var(--space-3)',
              }}
            >
              合集中暂无成员
            </div>
          ) : (
            memberEntries.map((entry) => (
              <MemberRow
                key={entry.meta.id}
                entry={entry}
                onEnable={onEnableMember}
                onDisable={onDisableMember}
                onOpen={onOpenMember}
                isPhone={isPhone}
                inGamePanel={inGamePanel}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── 成员行（复用 EventListRow 样式） ───

function MemberRow({
  entry,
  onEnable,
  onDisable,
  onOpen,
  isPhone,
  inGamePanel,
}: {
  entry: EventRegistryEntry;
  onEnable: (id: string) => void | Promise<void>;
  onDisable: (id: string) => void | Promise<void>;
  onOpen?: (entry: EventRegistryEntry) => void;
  isPhone: boolean;
  inGamePanel: boolean;
}) {
  const { meta } = entry;
  const isActive = isEventActive(entry.enabled);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isPhone ? 'var(--space-2)' : 'var(--space-3)',
        padding: inGamePanel
          ? isPhone
            ? 'var(--space-2) var(--space-3)'
            : 'var(--space-2) var(--space-3)'
          : isPhone
            ? 'var(--space-2) var(--space-3)'
            : 'var(--space-2) var(--space-3)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {/* 封面色块 */}
      <div
        style={{
          width: inGamePanel ? (isPhone ? 32 : 28) : isPhone ? 36 : 44,
          height: inGamePanel ? (isPhone ? 32 : 28) : isPhone ? 36 : 44,
          borderRadius: 'var(--radius-md)',
          background: meta.coverColor,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: textOn(meta.coverColor || '#333'),
        }}
      >
        <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>
          {meta.name.charAt(0)}
        </span>
      </div>

      {/* 信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-display)',
              fontSize: isPhone ? 'var(--font-size-xs)' : 'var(--font-size-sm)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {meta.name}
          </span>
          {!isPhone && !inGamePanel && <EventPackBadge packId={meta.id} />}
        </div>
        <div
          style={{
            fontSize: 'var(--font-size-xs)',
            color: 'var(--text-muted)',
          }}
        >
          v{meta.version}
        </div>
      </div>

      {/* 开关 */}
      <EventSwitch
        checked={isActive}
        onChange={(next) => (next ? onEnable(meta.id) : onDisable(meta.id))}
        label={`启用 ${meta.name}`}
      />
    </div>
  );
}
