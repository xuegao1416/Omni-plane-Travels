import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FilePlus,
  FolderOpen,
  MoreHorizontal,
  PackageOpen,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { EventDetail, EventPackType, EventRegistryEntry } from '../../modules/schema';
import type { UseEventsResult } from './useEvents';
import EventSwitch from './EventSwitch';
import { resolveEventIcon } from './eventIcons';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import './event-archive.css';

interface EventArchiveWorkspaceProps {
  eventApi: UseEventsResult;
  tab: 'center' | 'library';
  selectedPackId: string | null;
  onSelectPack: (id: string | null) => void;
  onChangeTab: (tab: 'center' | 'library') => void;
  onBack: () => void;
  onImport: () => void;
  onNewPack: () => void;
  onNewRule: () => void;
  onAiGenerate: () => void;
  onOpenPack: (entry: EventRegistryEntry) => void;
  libraryContent: ReactNode;
}

const TYPE_LABEL: Record<EventPackType, string> = {
  card: '事件卡包',
  rule: '规则包',
  worldbook: '世界书',
  bundle: '混合包',
};

function formatDate(value?: string | null): string {
  if (!value) return '尚无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN');
}

function EventArchiveStatus({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="event-archive-status event-archive-status--error"><AlertTriangle size={16} />{error}</div>;
}

export default function EventArchiveWorkspace({
  eventApi,
  tab,
  selectedPackId,
  onSelectPack,
  onChangeTab,
  onBack,
  onImport,
  onNewPack,
  onNewRule,
  onAiGenerate,
  onOpenPack,
  libraryContent,
}: EventArchiveWorkspaceProps) {
  const [mobileDetail, setMobileDetail] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const selectedEntry = useMemo(
    () => eventApi.packs.find((entry) => entry.meta.id === selectedPackId) ?? null,
    [eventApi.packs, selectedPackId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!selectedPackId || tab !== 'center') {
      setDetail(null);
      return;
    }
    void eventApi.detail(selectedPackId).then((next) => {
      if (!cancelled) setDetail(next);
    });
    return () => { cancelled = true; };
  }, [eventApi, selectedPackId, tab]);

  const activeConflictCount = detail?.conflictStatus.filter((item) => item.active).length ?? 0;
  const ruleCount = detail?.rulesSummary.length ?? (selectedEntry?.meta.type === 'rule' ? 1 : 0);
  const cardCount = detail?.cardsSummary.length ?? (selectedEntry?.meta.type === 'card' ? 1 : 0);
  const showEmpty = eventApi.packs.length === 0;

  const selectPack = (id: string) => {
    onSelectPack(id);
    setMobileDetail(true);
  };

  return (
    <div className="entry-default-theme event-archive-screen">
      <div className="event-archive-backdrop" aria-hidden="true" />
      <div className="event-archive-shell-wrap">
        <DawnFrameV4 mode="panel" withFill className="event-archive-frame" ariaLabel="旅庭事件典藏室">
          <div className="event-archive-shell">
            <header className="event-archive-header">
              <button type="button" className="event-archive-back" onClick={onBack} aria-label="返回旅庭">
                <ArrowLeft size={17} /><span>返回旅庭</span>
              </button>
              <div className="event-archive-heading">
                <span className="event-archive-kicker">DAWN ARCHIVE · GLOBAL EVENTS</span>
                <h1>事件典藏</h1>
                <p>管理跨世界启用的事件包、规则与典藏来源。</p>
              </div>
              <div className="event-archive-header-spacer" />
            </header>

            <nav className="event-archive-tabs" aria-label="事件典藏分区" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'center'} onClick={() => { onChangeTab('center'); setMobileDetail(false); }}>
                <Archive size={16} />事件中心
              </button>
              <button type="button" role="tab" aria-selected={tab === 'library'} onClick={() => { onChangeTab('library'); setMobileDetail(false); }}>
                <BookOpen size={16} />事件库
              </button>
            </nav>

            <main className="event-archive-main">
              {tab === 'center' ? (
                <section className="event-archive-center" aria-label="事件中心总览">
                  <div className="event-archive-summary" aria-label="典藏摘要">
                    <span><strong>{eventApi.packs.length}</strong>事件包</span>
                    <span><strong>{eventApi.packs.filter((entry) => entry.enabled).length}</strong>全局启用</span>
                    <span><strong>{activeConflictCount || '—'}</strong>冲突状态</span>
                    <span><strong>{eventApi.collections.length}</strong>典藏集</span>
                  </div>

                  <div className="event-archive-toolbar">
                    <button type="button" className="event-archive-primary-action" onClick={onImport}><Upload size={16} />导入事件包</button>
                    <div className="event-archive-secondary-actions">
                      <button type="button" onClick={onNewPack}><Plus size={15} />新建事件包</button>
                      <button type="button" onClick={onNewRule}><FilePlus size={15} />新建工作流</button>
                      <button type="button" onClick={onAiGenerate}><Sparkles size={15} />AI生成</button>
                    </div>
                    <button type="button" className="event-archive-more" aria-label="更多事件操作" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
                      <MoreHorizontal size={18} />更多
                    </button>
                    {moreOpen && (
                      <div className="event-archive-more-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => { onNewPack(); setMoreOpen(false); }}><Plus size={15} />新建事件包</button>
                        <button type="button" role="menuitem" onClick={() => { onNewRule(); setMoreOpen(false); }}><FilePlus size={15} />新建工作流</button>
                        <button type="button" role="menuitem" onClick={() => { onAiGenerate(); setMoreOpen(false); }}><Sparkles size={15} />AI生成</button>
                      </div>
                    )}
                  </div>

                  <EventArchiveStatus error={eventApi.error} />

                  {showEmpty ? (
                    <EmptyArchive onImport={onImport} onNewPack={onNewPack} />
                  ) : (
                    <div className={`event-archive-list-detail${mobileDetail ? ' event-archive-list-detail--mobile-detail' : ''}`}>
                      <section className="event-archive-list-pane" aria-label="事件包列表">
                        <div className="event-archive-pane-heading"><div><span>COLLECTION INDEX</span><h2>典藏目录</h2></div><button type="button" aria-label="刷新事件目录" onClick={() => void eventApi.refresh()}><RefreshCw size={16} /></button></div>
                        <div className="event-archive-list" role="list">
                          {eventApi.packs.map((entry) => <ArchiveListItem key={entry.meta.id} entry={entry} selected={entry.meta.id === selectedPackId} onSelect={() => selectPack(entry.meta.id)} onEnable={eventApi.enable} onDisable={eventApi.disable} />)}
                        </div>
                      </section>
                      <section className="event-archive-detail-pane" aria-label="事件包详情">
                        <button type="button" className="event-archive-mobile-back" onClick={() => setMobileDetail(false)}><ChevronLeft size={16} />返回目录</button>
                        {selectedEntry ? (
                          <ArchiveDetail entry={selectedEntry} detail={detail} ruleCount={ruleCount} cardCount={cardCount} conflictCount={activeConflictCount} onOpen={() => onOpenPack(selectedEntry)} onExport={() => void eventApi.exportPack(selectedEntry.meta.id)} onDelete={() => void eventApi.uninstall(selectedEntry.meta.id)} />
                        ) : (
                          <div className="event-archive-detail-empty"><FolderOpen size={24} /><strong>选择一份事件包</strong><span>从左侧目录打开事件、规则或世界书详情。</span></div>
                        )}
                      </section>
                    </div>
                  )}
                </section>
              ) : (
                <section className="event-archive-library" aria-label="事件库">
                  {libraryContent}
                </section>
              )}
            </main>
          </div>
        </DawnFrameV4>
      </div>
    </div>
  );
}

function EmptyArchive({ onImport, onNewPack }: { onImport: () => void; onNewPack: () => void }) {
  return (
    <div className="event-archive-empty">
      <div className="event-archive-empty-icon"><PackageOpen size={28} /></div>
      <span className="event-archive-kicker">ARCHIVE ROOM · READY</span>
      <h2>事件典藏室尚为空</h2>
      <p>导入本地 .opt-event 事件包，或从第一份事件包开始编织全局规则。</p>
      <div className="event-archive-empty-actions"><button type="button" className="event-archive-primary-action" onClick={onImport}><Upload size={16} />导入事件包</button><button type="button" onClick={onNewPack}><Plus size={16} />新建第一个事件包</button></div>
    </div>
  );
}

function ArchiveListItem({ entry, selected, onSelect, onEnable, onDisable }: { entry: EventRegistryEntry; selected: boolean; onSelect: () => void; onEnable: (id: string) => void | Promise<void>; onDisable: (id: string) => void | Promise<void> }) {
  const Icon = resolveEventIcon(entry.meta.icon, entry.meta.type);
  return (
    <div className={`event-archive-list-item${selected ? ' is-selected' : ''}`} role="listitem">
      <button type="button" className="event-archive-list-select" onClick={onSelect} aria-current={selected ? 'true' : undefined}>
        <span className="event-archive-list-icon" style={{ background: entry.meta.coverColor }}><Icon size={18} /></span>
        <span className="event-archive-list-copy"><strong>{entry.meta.name}</strong><small>{TYPE_LABEL[entry.meta.type]} · v{entry.meta.version}</small><small>{entry.meta.author} · {formatDate(entry.registeredAt)}</small></span>
        <ChevronRight size={16} />
      </button>
      <div className="event-archive-list-toggle"><EventSwitch checked={entry.enabled} onChange={(next) => next ? onEnable(entry.meta.id) : onDisable(entry.meta.id)} label={`全局启用 ${entry.meta.name}`} /></div>
    </div>
  );
}

function ArchiveDetail({ entry, detail, ruleCount, cardCount, conflictCount, onOpen, onExport, onDelete }: { entry: EventRegistryEntry; detail: EventDetail | null; ruleCount: number; cardCount: number; conflictCount: number; onOpen: () => void; onExport: () => void; onDelete: () => void }) {
  const Icon = resolveEventIcon(entry.meta.icon, entry.meta.type);
  return (
    <div className="event-archive-detail">
      <div className="event-archive-detail-heading"><span className="event-archive-detail-icon" style={{ background: entry.meta.coverColor }}><Icon size={22} /></span><div><span className="event-archive-kicker">{TYPE_LABEL[entry.meta.type]}</span><h2>{entry.meta.name}</h2><p>{entry.meta.author} · v{entry.meta.version}</p></div><span className={`event-archive-enabled-badge${entry.enabled ? ' is-on' : ''}`}>{entry.enabled ? '全局启用' : '全局停用'}</span></div>
      <p className="event-archive-description">{entry.meta.description || '这份典藏尚未写下描述。打开编辑器补充它的世界规则与叙事入口。'}</p>
      <div className="event-archive-detail-stats"><span><strong>{cardCount}</strong>事件卡</span><span><strong>{ruleCount}</strong>规则</span><span><strong>{detail?.worldbookSummary?.length || 0}</strong>世界书</span><span><strong>{conflictCount || '—'}</strong>冲突</span></div>
      <div className="event-archive-detail-sections"><div><span>来源与兼容</span><strong>{entry.builtin ? '内置世界事件包' : '本地导入事件包'}</strong><small>schema v{entry.meta.schemaVersion} · 最低版本 {entry.meta.minAppVersion}</small></div><div><span>依赖状态</span><strong>{detail?.dependencyStatus?.filter((item) => !item.satisfied).length ? '有待处理依赖' : '依赖已满足'}</strong><small>{conflictCount ? '请打开规则编辑器检查冲突。' : '当前没有检测到活动冲突。'}</small></div></div>
      <div className="event-archive-detail-actions"><button type="button" className="event-archive-primary-action" onClick={onOpen}><ExternalLink size={16} />打开编辑</button><button type="button" onClick={onExport}><Download size={16} />导出</button>{!entry.builtin && <button type="button" className="event-archive-danger-action" onClick={onDelete}><Trash2 size={16} />卸载</button>}</div>
    </div>
  );
}
