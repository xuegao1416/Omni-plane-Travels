import { useMemo } from 'react';
import { Upload, FilePlus, Loader2, AlertTriangle } from 'lucide-react';
import type { EventRegistryEntry } from '../../modules/schema';
import type { UseEventsResult } from './useEvents';
import { isTauri } from '../../utils/nativeFetch';
import EventListRow from './EventListRow';
import CollectionGroup from './CollectionGroup';
import { EmptyState } from './EmptyState';
import { useIsPhone, useBreakpoint } from '../../hooks/useIsMobile';

interface EventCenterProps {
  eventApi: UseEventsResult;
  onOpenPack: (entry: EventRegistryEntry) => void;
  onNewPack: () => void;
  onNewRule: () => void;
  onGoImport: () => void;
}

export default function EventCenter({ eventApi, onOpenPack, onNewPack, onNewRule, onGoImport }: EventCenterProps) {
  const { packs, loading, error, enable, disable, uninstall, exportPack, importPack, collections, deleteCollection } = eventApi;
  const isPhone = useIsPhone();
  const breakpoint = useBreakpoint();
  const isSmallPhone = breakpoint === 'xs' || breakpoint === 'sm';

  const total = packs.length;
  const enabledCount = packs.filter((m) => m.enabled).length;

  // 合集分组：收集所有合集成员 id，剩余为独立包
  const { collectionGroups, ungroupedPacks } = useMemo(() => {
    const entryById = new Map(packs.map((p) => [p.meta.id, p]));
    const ms = new Set<string>();
    const groups = collections.map((col) => {
      const members = col.memberIds
        .map((id) => entryById.get(id))
        .filter((e): e is EventRegistryEntry => !!e);
      col.memberIds.forEach((id) => ms.add(id));
      return { collection: col, members };
    });
    const ungrouped = packs.filter((p) => !ms.has(p.meta.id));
    return { collectionGroups: groups, ungroupedPacks: ungrouped };
  }, [collections, packs]);

  return (
    <div
      className="event-fade-in"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        padding: isPhone ? 'var(--space-4)' : 'var(--space-6)',
      }}
    >
      {/* 操作行：新建空白 / 新建周期 / 导入 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: isPhone ? 'var(--space-1)' : 'var(--space-2)', flexWrap: 'wrap' }}>
        <button className="btn-secondary" onClick={onNewPack} style={{ minHeight: isPhone ? 36 : undefined, fontSize: isPhone ? 'var(--font-size-xs)' : undefined, padding: isPhone ? '4px 8px' : undefined }}>
          <FilePlus size={14} /> {isPhone ? '事件包' : '新建事件包'}
        </button>
        <button className="btn-secondary" onClick={onNewRule} style={{ minHeight: isPhone ? 36 : undefined, fontSize: isPhone ? 'var(--font-size-xs)' : undefined, padding: isPhone ? '4px 8px' : undefined }}>
          <FilePlus size={14} /> {isPhone ? '规则' : '新建规则'}
        </button>
        <button
          className="btn-primary"
          onClick={() => (isTauri() ? importPack() : onGoImport())}
          style={{ minHeight: isPhone ? 36 : undefined, fontSize: isPhone ? 'var(--font-size-xs)' : undefined, padding: isPhone ? '4px 8px' : undefined }}
        >
          <Upload size={14} /> {isPhone ? '导入' : '导入 .opt-event'}
        </button>
      </div>

      {/* 统计条 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isPhone ? 'var(--space-2)' : 'var(--space-3)' }}>
        <StatCard label="总计" value={total} compact={isPhone} />
        <StatCard label="已启用" value={enabledCount} compact={isPhone} />
        <StatCard label="冲突" value={'未计算'} compact={isPhone} />
      </div>

      {/* 错误横幅 */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--danger-bg-soft)',
            color: 'var(--danger)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* 内容 */}
      {loading ? (
        <LoadingBlock />
      ) : packs.length === 0 && collectionGroups.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="尚未安装任何事件"
          description="从本地导入 .opt-event 包，或创建你的第一个事件。"
          action={
            <button className="btn-primary" onClick={() => (isTauri() ? importPack() : onGoImport())}>
              <Upload size={16} /> 导入 .opt-event
            </button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* 合集分组 */}
          {collectionGroups.map(({ collection, members }) => (
            <CollectionGroup
              key={collection.id}
              collection={collection}
              memberEntries={members}
              onToggleAll={(colId, enableAll) => {
                // 批量开关成员的全局 enabled
                for (const m of members) {
                  if (enableAll) {
                    void enable(m.meta.id);
                  } else {
                    void disable(m.meta.id);
                  }
                }
              }}
              onDelete={deleteCollection}
              onEnableMember={enable}
              onDisableMember={disable}
              onOpenMember={onOpenPack}
            />
          ))}
          {/* 独立包（不属于任何合集） */}
          {ungroupedPacks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {ungroupedPacks.map((m) => (
                <EventListRow
                  key={m.meta.id}
                  entry={m}
                  onEnable={enable}
                  onDisable={disable}
                  onUninstall={uninstall}
                  onExport={exportPack}
                  onOpen={onOpenPack}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, compact }: { label: string; value: number | string; compact?: boolean }) {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: compact ? 'var(--space-2) var(--space-3)' : 'var(--space-3) var(--space-4)',
      }}
    >
      <div style={{ fontSize: compact ? 'var(--font-size-xs)' : 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: compact ? 'var(--font-size-lg)' : 'var(--font-size-xl)',
          fontWeight: 700,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          marginTop: compact ? 2 : 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 'var(--space-8)',
        color: 'var(--text-muted)',
      }}
    >
      <Loader2 size={18} className="event-spin" /> 加载中…
    </div>
  );
}
