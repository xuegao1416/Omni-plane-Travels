import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowLeft, ArrowRight, Clock3, Download, MessageSquare, MoreHorizontal, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { GameSave, SaveMeta } from '../../storage/db';
import { loadGame as loadGameFromDb } from '../../storage/db';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { EntrySlicedButton } from './EntrySurface';

type ShardVariant = 'a' | 'b' | 'c';

const SHARD_VARIANTS: ShardVariant[] = ['a', 'b', 'c'];

function worldLabel(preview: string) {
  const parts = preview.split(' · ').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || '未标记世界');
}

function formatSaveTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

interface SaveArchiveViewProps {
  allSaves: SaveMeta[];
  currentSaveId: string | null;
  onClose: () => void;
  onLoadSave: (save: GameSave) => void;
  onCreateSave: () => void;
  onDeleteSave: (id: string) => void | Promise<void>;
  onImportSave: (file: File) => void | Promise<void>;
  onExportSave: (id: string) => void | Promise<void>;
  /** DEV preview hook; production continues to use the real DB loader. */
  loadGame?: (id: string) => Promise<GameSave | null>;
}

export default function SaveArchiveView({
  allSaves,
  currentSaveId,
  onClose,
  onLoadSave,
  onCreateSave,
  onDeleteSave,
  onImportSave,
  onExportSave,
  loadGame: loadGameOverride,
}: SaveArchiveViewProps) {
  const loadGame = loadGameOverride ?? (async (id: string) => (await loadGameFromDb(id)) ?? null);
  const firstId = currentSaveId && allSaves.some(save => save.id === currentSaveId)
    ? currentSaveId
    : allSaves[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const [loading, setLoading] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const mobileActionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedId(previous => {
      if (previous && allSaves.some(save => save.id === previous)) return previous;
      return currentSaveId && allSaves.some(save => save.id === currentSaveId)
        ? currentSaveId
        : allSaves[0]?.id ?? null;
    });
  }, [allSaves, currentSaveId]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!mobileActionsRef.current?.contains(event.target as Node)) {
        setMobileMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileMenuOpen(false);
      mobileActionsRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const selectedSave = useMemo(
    () => allSaves.find(save => save.id === selectedId) ?? null,
    [allSaves, selectedId],
  );
  const handleContinue = async () => {
    if (!selectedSave || loading) return;
    setLoading(true);
    try {
      const fullSave = await loadGame(selectedSave.id);
      if (fullSave) onLoadSave(fullSave);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void onImportSave(file);
    event.target.value = '';
  };

  const openImportPicker = () => {
    setMobileMenuOpen(false);
    importInputRef.current?.click();
  };

  const handleMobileExport = () => {
    if (!selectedSave) return;
    setMobileMenuOpen(false);
    void onExportSave(selectedSave.id);
  };

  const handleMobileDelete = () => {
    if (!selectedSave) return;
    setMobileMenuOpen(false);
    void onDeleteSave(selectedSave.id);
  };

  const renderShard = (save: SaveMeta) => {
    const displayIndex = allSaves.indexOf(save);
    const variant = SHARD_VARIANTS[displayIndex % SHARD_VARIANTS.length];
    const selected = save.id === selectedId;
    return (
      <button
        key={save.id}
        type="button"
        className={`entry-save-shard-card${selected ? ' is-selected' : ''}`}
        aria-pressed={selected}
        onClick={() => setSelectedId(save.id)}
        data-layout-id={`save.card.${save.id}`}
        data-layout-label={`${displayIndex % 2 === 0 ? '左' : '右'}侧存档卡 · ${save.name || '未命名旅程'}`}
        data-layout-editable="true"
        data-layout-container="save.body"
        data-layout-kind="frame"
      >
        <DawnFrameV4 mode="panel" withFill className="entry-save-shard-card__frame">
        <span className="entry-save-shard-card__art-wrap" aria-hidden="true">
          <img src={`/art/theme/saves/save-shard-${variant}.png`} alt="" className="entry-save-shard-card__art" />
          <span className="entry-save-shard-card__glow" />
        </span>
        <span className="entry-save-shard-card__copy">
          <span className="entry-save-shard-card__eyebrow">档案碎片 / {String(displayIndex + 1).padStart(2, '0')}</span>
          <strong>{save.name || '未命名旅程'}</strong>
          <span className="entry-save-shard-card__world">{worldLabel(save.preview)}</span>
          <span className="entry-save-shard-card__meta"><MessageSquare size={12} /> {save.messageCount ?? 0} 条记录</span>
          <span className="entry-save-shard-card__meta"><Clock3 size={12} /> {formatSaveTime(save.timestamp)}</span>
        </span>
        </DawnFrameV4>
      </button>
    );
  };

  return (
    <div className="entry-default-theme entry-archive-layer" role="presentation">
      <main className="entry-archive-space" aria-labelledby="entry-archive-title" data-layout-id="save.screen">
        <div className="entry-archive-space__backdrop" aria-hidden="true" data-layout-id="save.background" />
        <div className="entry-archive-space__veil" aria-hidden="true" data-layout-id="save.veil" />
        <header className="entry-archive-space__header">
          <div data-layout-id="save.title" data-layout-label="SAVE 标题区" data-layout-editable="true" data-layout-container="save.screen">
            <span className="entry-archive-space__kicker"><Archive size={14} /> 旅程档案 · SAVE INDEX</span>
            <h2 id="entry-archive-title">存档档案空间</h2>
            <p>{allSaves.length ? `已找到 ${allSaves.length} 个旅程切片` : '尚未记录可读取的旅程'}</p>
          </div>
          <div className="entry-archive-space__header-actions entry-archive-space__header-actions--desktop" aria-label="存档管理">
            {allSaves.length > 0 && <>
              <EntrySlicedButton frame="dawn-v4-compact" icon={Upload} onClick={() => importInputRef.current?.click()} aria-label="导入存档" data-layout-id="save.import" data-layout-label="导入存档" data-layout-editable="true" data-layout-container="save.screen" data-layout-kind="compact">导入存档</EntrySlicedButton>
              {selectedSave && <>
                <EntrySlicedButton frame="dawn-v4-compact" icon={Download} onClick={() => void onExportSave(selectedSave.id)} aria-label="导出存档" data-layout-id="save.export" data-layout-label="导出存档" data-layout-editable="true" data-layout-container="save.screen" data-layout-kind="compact">导出存档</EntrySlicedButton>
                <EntrySlicedButton frame="dawn-v4-compact" icon={Trash2} onClick={() => void onDeleteSave(selectedSave.id)} aria-label="删除存档" className="entry-sliced-button--danger" data-layout-id="save.delete" data-layout-label="删除存档" data-layout-editable="true" data-layout-container="save.screen" data-layout-kind="compact">删除存档</EntrySlicedButton>
              </>}
            </>}
          </div>
          <div ref={mobileActionsRef} className="entry-archive-space__mobile-actions" aria-label="移动端存档操作">
            {allSaves.length > 0 && (
              <div className="entry-archive-space__mobile-menu-wrap">
                <EntrySlicedButton
                  frame="dawn-v4-compact"
                  icon={MoreHorizontal}
                  className="entry-archive-space__mobile-icon-button"
                  onClick={() => setMobileMenuOpen(open => !open)}
                  aria-label="更多存档操作"
                  aria-haspopup="menu"
                  aria-expanded={mobileMenuOpen}
                  title="更多存档操作"
                >
                  更多存档操作
                </EntrySlicedButton>
                {mobileMenuOpen && (
                  <div className="entry-archive-space__mobile-menu" role="menu" aria-label="存档工具">
                    <button type="button" role="menuitem" onClick={openImportPicker}>
                      <Upload size={18} aria-hidden="true" />
                      <span>导入存档</span>
                    </button>
                    {selectedSave && (
                      <>
                        <button type="button" role="menuitem" onClick={handleMobileExport}>
                          <Download size={18} aria-hidden="true" />
                          <span>导出存档</span>
                        </button>
                        <button type="button" role="menuitem" className="is-danger" onClick={handleMobileDelete}>
                          <Trash2 size={18} aria-hidden="true" />
                          <span>删除存档</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {allSaves.length ? (
          <section className="entry-archive-space__body" aria-label="存档列表" data-layout-id="save.body">
            <div className="entry-save-rail entry-save-rail--all">{allSaves.map(renderShard)}</div>
            <div className="entry-archive-space__center">
              <div className="entry-archive-space__orbits" aria-hidden="true" />
              <button type="button" className="entry-hall-portal entry-archive-gate" aria-label="存档裂隙" onClick={onClose} data-layout-id="save.gate" data-layout-label="中央返回大厅 Gate" data-layout-editable="true" data-layout-container="save.screen">
                <span className="entry-hall-portal__halo" aria-hidden="true" />
                <span className="entry-hall-portal__core" aria-hidden="true"><Archive size={23} strokeWidth={1.2} /></span>
                <span className="entry-hall-portal__label">返回大厅</span>
              </button>
              <div className="entry-save-details" aria-live="polite" data-layout-id="save.details" data-layout-label="底部续程状态带" data-layout-editable="true" data-layout-container="save.body" data-layout-kind="frame">
                <DawnFrameV4 mode="panel" withFill className="entry-save-details__frame">
                {selectedSave ? (
                  <>
                    <span className="entry-save-details__eyebrow">已选旅程 · READY</span>
                    <strong>{selectedSave.name || '未命名旅程'}</strong>
                    <span>{worldLabel(selectedSave.preview)} · {selectedSave.messageCount ?? 0} 条记录</span>
                    <EntrySlicedButton frame="dawn-v4-compact" tone="primary" emblemSrc="/art/theme/emblems/emblem-20-v2.png" icon={ArrowRight} onClick={handleContinue} aria-label="继续旅程" disabled={loading}>
                      {loading ? '读取中…' : '继续旅程'}
                    </EntrySlicedButton>
                  </>
                ) : (
                  <span>选择一枚存档晶片继续</span>
                )}
                </DawnFrameV4>
              </div>
            </div>
          </section>
        ) : (
          <section className="entry-archive-empty" aria-label="空存档状态">
            <div className="entry-archive-empty__mark"><RotateCcw size={34} strokeWidth={1.1} /></div>
            <span className="entry-archive-space__kicker">NO JOURNEY RECORDED</span>
            <h3>这里还没有存档晶片</h3>
            <p>返回大厅选择一个世界，开启你的第一段旅程。</p>
            <div className="entry-archive-empty__actions">
              <EntrySlicedButton frame="dawn-v4-compact" emblemSrc="/art/theme/emblems/emblem-27-v2.png" icon={ArrowLeft} onClick={onClose}>返回大厅</EntrySlicedButton>
              <EntrySlicedButton frame="dawn-v4-compact" icon={Upload} onClick={() => importInputRef.current?.click()}>导入存档</EntrySlicedButton>
              <EntrySlicedButton frame="dawn-v4-compact" tone="primary" emblemSrc="/art/theme/emblems/emblem-20-v2.png" icon={Plus} onClick={onCreateSave}>创建新旅程</EntrySlicedButton>
            </div>
            <input ref={importInputRef} type="file" accept=".json,application/json" onChange={handleImport} hidden />
          </section>
        )}
        {allSaves.length > 0 && <input ref={importInputRef} type="file" accept=".json,application/json" onChange={handleImport} hidden />}
      </main>
    </div>
  );
}
