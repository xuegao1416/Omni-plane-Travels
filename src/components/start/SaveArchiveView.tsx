import { useEffect,useMemo,useRef,useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowLeft,ArrowRight,Clock3,Download,Eye,Lock,MessageSquare,Plus,Trash2,Upload } from 'lucide-react';
import type { SaveMeta } from '../../storage/db';
import type { WorldDef } from '../../data/worldLoader';
import { SAVE_FILE_ACCEPT } from '../../storage/saveFileCodec';
import OverlayPortal from '../shared/OverlayPortal';
import { getWorldVisual } from './orrery/worldVisuals';
import { useEntryLexicon } from '../../ui/dawn/entryLexicon';

function worldLabel(preview: string) {
  const parts = preview.split(' · ').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '未标记世界');
}

function formatSaveTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function relativeTime(timestamp: number) {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} 天前` : formatSaveTime(timestamp);
}

interface SaveArchiveViewProps {
  allSaves: SaveMeta[];
  allWorlds?: WorldDef[];
  currentSaveId: string | null;
  onClose: () => void;
  onLoadSave: (saveId: string) => Promise<void>;
  onCreateSave: () => void;
  onDeleteSave: (id: string) => void | Promise<void>;
  onImportSave: (file: File) => void | Promise<void>;
  onExportSave: (id: string) => void | Promise<void>;
}

/** Voyage log: every save is an entry on a timeline; the selected one is shown as a page. */
export default function SaveArchiveView({
  allSaves,
  allWorlds = [],
  currentSaveId,
  onClose,
  onLoadSave,
  onCreateSave,
  onDeleteSave,
  onImportSave,
  onExportSave,
}: SaveArchiveViewProps) {
  const lex = useEntryLexicon();
  const sortedSaves = useMemo(() => [...allSaves].sort((a, b) => b.timestamp - a.timestamp), [allSaves]);
  const pickDefault = () => (currentSaveId && allSaves.some(save => save.id === currentSaveId) ? currentSaveId : sortedSaves[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(pickDefault);
  const [loading, setLoading] = useState(false);
  const [transfer, setTransfer] = useState<'import' | 'export' | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSelectedId(previous => (previous && allSaves.some(save => save.id === previous) ? previous : pickDefault()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSaves, currentSaveId]);

  const selectedSave = useMemo(() => allSaves.find(save => save.id === selectedId) ?? null, [allSaves, selectedId]);
  const busy = loading || transfer !== null;
  const ended = selectedSave?.lifecycle === 'ended';

  const worldForSave = (save: SaveMeta) => {
    const label = worldLabel(save.preview);
    return allWorlds.find(world => world.name === label || save.preview.includes(world.name));
  };
  const selectedWorld = selectedSave ? worldForSave(selectedSave) : undefined;
  const selectedVisual = selectedWorld ? getWorldVisual(selectedWorld) : null;

  const handleOpen = async () => {
    if (!selectedSave || busy) return;
    setLoading(true);
    try { await onLoadSave(selectedSave.id); } finally { setLoading(false); }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setTransfer('import');
    try { await onImportSave(file); } finally { setTransfer(null); }
  };

  const openImportPicker = () => { if (!busy) importInputRef.current?.click(); };

  const handleExport = async () => {
    if (!selectedSave || busy) return;
    setTransfer('export');
    try { await onExportSave(selectedSave.id); } finally { setTransfer(null); }
  };

  const status = transfer === 'import' ? '正在导入存档…' : transfer === 'export' ? '正在压缩导出完整存档…' : '支持旧 JSON 和压缩存档 ZIP，导出包含自建世界和存档历史。';

  return (
    <OverlayPortal className="pl-log" ariaLabelledBy="pl-log-title" onClose={onClose} closeOnBackdrop={false}>
      <div className="pl-log__sky" aria-hidden="true">
        {selectedVisual && <img key={selectedVisual.scene} src={selectedVisual.scene} alt="" />}
      </div>
      <header className="pl-log__top">
        <button type="button" className="pl-chip pl-back" aria-label={lex.back} onClick={onClose}><ArrowLeft size={14} aria-hidden="true" /><span className="pl-back__text">{lex.back}</span></button>
        <div className="pl-log__title">
          <span className="pl-kicker">{lex.logKicker}</span>
          <h2 id="pl-log-title">{lex.log}</h2>
          <p>{allSaves.length ? `共 ${allSaves.length} 段旅程` : '尚未记录任何旅程'}</p>
        </div>
        <div className="pl-log__tools">
          <button type="button" className="pl-chip" onClick={openImportPicker} disabled={busy} aria-label="导入存档"><Upload size={14} aria-hidden="true" />{transfer === 'import' ? '导入中…' : '导入存档'}</button>
        </div>
      </header>
      <p className="pl-log__status" role="status">{status}</p>

      {sortedSaves.length ? (
        <div className="pl-log__body">
          <ol className="pl-log__track" aria-label="存档列表">
            {sortedSaves.map((save, index) => {
              const world = worldForSave(save);
              const visual = world ? getWorldVisual(world) : null;
              const selected = save.id === selectedId;
              return (
                <li key={save.id} style={{ '--i': index, '--accent': visual?.accent ?? '#c9a86a' } as CSSProperties}>
                  <button type="button" className={`pl-entry${selected ? ' is-selected' : ''}${save.lifecycle === 'ended' ? ' is-ended' : ''}`} aria-pressed={selected} onClick={() => setSelectedId(save.id)}>
                    <span className="pl-entry__node" aria-hidden="true">
                      {visual ? <img src={visual.scene} alt="" loading="lazy" /> : <span />}
                    </span>
                    <span className="pl-entry__text">
                      <strong>{save.name || '未命名旅程'}</strong>
                      <span>{worldLabel(save.preview)}</span>
                    </span>
                    <span className="pl-entry__meta">
                      {save.lifecycle === 'ended' && <Lock size={12} aria-label="已封存" />}
                      {save.id === currentSaveId && <span className="pl-tag is-accent">当前</span>}
                      <time dateTime={new Date(save.timestamp).toISOString()}>{relativeTime(save.timestamp)}</time>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <section className="pl-log__page" aria-live="polite" style={{ '--accent': selectedVisual?.accent ?? '#c9a86a' } as CSSProperties}>
            {selectedSave ? (
              <>
                <span className="pl-kicker">{ended ? '只读封存' : '已选旅程 · READY'}</span>
                <h3>{selectedSave.name || '未命名旅程'}</h3>
                <p className="pl-log__world">{worldLabel(selectedSave.preview)}</p>
                <dl className="pl-stats">
                  <div><dt><MessageSquare size={13} aria-hidden="true" />记录</dt><dd>{selectedSave.messageCount ?? 0} 条</dd></div>
                  <div><dt><Clock3 size={13} aria-hidden="true" />最后停泊</dt><dd>{formatSaveTime(selectedSave.timestamp)}</dd></div>
                </dl>
                {ended && <p className="pl-note" role="status">{selectedSave.endReason || '炼狱战斗中玩家死亡，存档已封存为只读。可查看或导出。'}</p>}
                <div className="pl-log__actions">
                  <button
                    type="button"
                    className="pl-button pl-button--primary pl-button--lg"
                    onClick={handleOpen}
                    disabled={busy}
                    aria-label={ended ? '查看回顾' : '继续旅程'}
                  >
                    {loading ? '读取中…' : ended ? <><Eye size={17} aria-hidden="true" />查看回顾</> : <>继续旅程<ArrowRight size={17} aria-hidden="true" /></>}
                  </button>
                  <button type="button" className="pl-button" onClick={handleExport} disabled={busy} title="完整压缩存档（.save.zip）" aria-label="导出存档"><Download size={15} aria-hidden="true" />{transfer === 'export' ? '导出中…' : '导出'}</button>
                  <button type="button" className="pl-button pl-button--danger" onClick={() => void onDeleteSave(selectedSave.id)} disabled={busy} aria-label="删除存档"><Trash2 size={15} aria-hidden="true" />删除</button>
                </div>
              </>
            ) : <p className="pl-lead">选择一段旅程继续。</p>}
          </section>
        </div>
      ) : (
        <section className="pl-log__empty" aria-label="空存档状态">
          <span className="pl-log__empty-mark" aria-hidden="true" />
          <h3>日志还是空白的</h3>
          <p>{lex.logEmpty}</p>
          <div className="pl-log__actions">
            <button type="button" className="pl-button" onClick={onClose}><ArrowLeft size={15} aria-hidden="true" />{lex.back}</button>
            <button type="button" className="pl-button" onClick={openImportPicker} disabled={busy}><Upload size={15} aria-hidden="true" />{transfer === 'import' ? '导入中…' : '导入存档'}</button>
            <button type="button" className="pl-button pl-button--primary" onClick={onCreateSave}><Plus size={15} aria-hidden="true" />创建新旅程</button>
          </div>
        </section>
      )}
      <input ref={importInputRef} type="file" accept={SAVE_FILE_ACCEPT} onChange={handleImport} disabled={busy} hidden />
    </OverlayPortal>
  );
}
