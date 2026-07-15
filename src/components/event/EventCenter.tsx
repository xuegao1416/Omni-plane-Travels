import { useMemo, useState } from 'react';
import { Upload, FilePlus, Loader2, AlertTriangle, BookOpen } from 'lucide-react';
import type { EventRegistryEntry } from '../../modules/schema';
import type { UseEventsResult } from './useEvents';
import { isTauri } from '../../utils/nativeFetch';
import EventListRow from './EventListRow';
import { EmptyState } from './EmptyState';
import { useIsPhone } from '../../hooks/useIsMobile';

type CenterTab = 'installed' | 'worldbook';

interface EventCenterProps {
  eventApi: UseEventsResult;
  onOpenMod: (entry: EventRegistryEntry) => void;
  onNewMod: () => void;
  onNewRulePack: () => void;
  onGoImport: () => void;
}

export default function EventCenter({ eventApi, onOpenMod, onNewMod, onNewRulePack, onGoImport }: EventCenterProps) {
  const { mods, loading, error, enable, disable, uninstall, exportMod, importMod } = eventApi;
  const [tab, setTab] = useState<CenterTab>('installed');
  const isPhone = useIsPhone();

  const total = mods.length;
  const enabledCount = mods.filter((m) => m.enabled).length;

  const visible = useMemo(() => {
    if (tab === 'worldbook') return mods.filter((m) => m.meta.type === 'worldbook');
    return mods;
  }, [tab, mods]);

  const tabs: { id: CenterTab; label: string }[] = [
    { id: 'installed', label: '已安装' },
    { id: 'worldbook', label: '世界书' },
  ];

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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button className="btn-secondary" onClick={onNewMod}>
          <FilePlus size={16} /> 新建事件包
        </button>
        <button className="btn-secondary" onClick={onNewRulePack}>
          <FilePlus size={16} /> 新建规则包
        </button>
        <button
          className="btn-primary"
          onClick={() => (isTauri() ? importMod() : onGoImport())}
        >
          <Upload size={16} /> 导入 .opt-event
        </button>
      </div>

      {/* 统计条 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
        <StatCard label="总计" value={total} />
        <StatCard label="已启用" value={enabledCount} />
        <StatCard label="冲突" value={'未计算'} />
      </div>

      {/* 选项卡 */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-4)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: 'var(--space-2) var(--space-1)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--font-size-md)',
              fontWeight: 600,
              color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: '-1px',
              transition: 'color var(--duration-fast) var(--ease-out)',
            }}
          >
            {t.label}
          </button>
        ))}
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
      ) : visible.length === 0 ? (
        <EmptyState
          icon={tab === 'worldbook' ? BookOpen : Upload}
          title={tab === 'worldbook' ? '尚未创建任何世界书' : '尚未安装任何事件'}
          description={
            tab === 'worldbook'
              ? '世界书条目来自各内置世界，不可在此新建；要在事件中引用，请在大纲编辑器的卡片块里使用「世界书」选择器。'
              : '从本地导入 .opt-event 包，或创建你的第一个事件。'
          }
          action={
            <button className="btn-primary" onClick={() => (isTauri() ? importMod() : onGoImport())}>
              <Upload size={16} /> 导入 .opt-event
            </button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {visible.map((m) => (
            <EventListRow
              key={m.meta.id}
              entry={m}
              onEnable={enable}
              onDisable={disable}
              onUninstall={uninstall}
              onExport={exportMod}
              onOpen={onOpenMod}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3) var(--space-4)',
      }}
    >
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: 'var(--font-size-xl)',
          fontWeight: 700,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          marginTop: 4,
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
