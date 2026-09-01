/**
 * 世界派生选择弹窗
 * - 展示 6 个内置世界，点击即派生（fork）为草稿并打开编辑器
 * - 草稿区域：点击继续编辑，× 删除
 * - 复用 entry-hall-empty-choice 结构（DawnFrameV4 + backdrop）
 */
import { useEffect, useState } from 'react';
import { Copy, Trash2, X, FileText } from 'lucide-react';
import type { WorldDef } from '../../data/worldLoader';
import { WORLDS, listWorldDrafts, type WorldDraft } from '../../data/worldLoader';
import { forkWorld } from '../../data/worldLoader';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { useConfigStore } from '../../stores/configStore';
import { useDialog } from '../shared/Dialog';

const BUILTIN_ORDER = [
  'japanese_school',
  'desire_metropolis',
  'wuxia_world',
  'wasteland_apocalypse',
  'stranded_island',
  'border_trade',
] as const;

interface WorldForkSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 点击内置世界 → 派生为草稿 → 打开编辑器 */
  onFork: (draft: WorldDraft) => void;
  /** 点击草稿 → 继续编辑 */
  onEditDraft: (draft: WorldDraft) => void;
  /** 删除草稿 */
  onDeleteDraft: (draftId: string) => void;
}

export default function WorldForkSelectModal({
  isOpen,
  onClose,
  onFork,
  onEditDraft,
  onDeleteDraft,
}: WorldForkSelectModalProps) {
  const t = useConfigStore(s => s.t);
  const dialog = useDialog();
  // Local state so deletion immediately updates the list without needing parent re-render
  const [draftsList, setDraftsList] = useState<WorldDraft[]>(listWorldDrafts);

  // Re-read drafts each time the modal opens
  useEffect(() => {
    if (isOpen) setDraftsList(listWorldDrafts());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const builtins = BUILTIN_ORDER.map(id => WORLDS.find(w => w.id === id)).filter(Boolean) as WorldDef[];

  const handleBuiltinClick = (world: WorldDef) => {
    // 生成草稿名："日式校园 - 草稿 1"
    const baseName = world.name ?? world.id;
    const existingCount = draftsList.filter(d => d.forkedFrom === world.id).length;
    const draftName = existingCount > 0
      ? `${baseName} - 草稿 ${existingCount + 1}`
      : `${baseName} - 草稿 1`;
    const draft = forkWorld(world, draftName);
    onFork(draft);
  };

  const handleDeleteDraft = async (e: React.MouseEvent, draftId: string) => {
    e.stopPropagation();
    const confirmed = await dialog.confirm('确定要删除这个草稿吗？删除后无法恢复。', {
      danger: true,
      confirmText: '删除',
      cancelText: '取消',
    });
    if (!confirmed) return;
    onDeleteDraft(draftId);
    setDraftsList(prev => prev.filter(d => d.id !== draftId));
  };

  if (!isOpen) return null;

  return (
    <>
      {dialog.DialogUI}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-fork-title"
        onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      >
        <div className="entry-hall-empty-choice__backdrop" aria-hidden="true" onClick={onClose} />
        <DawnFrameV4 mode="panel" withFill ariaLabel="选择世界" style={{ width: 'min(600px, calc(100vw - 48px))', minHeight: 480, maxHeight: 'calc(100dvh - 48px)' }}>
          <div className="entry-hall-empty-choice__content" style={{ paddingTop: 46, paddingBottom: 38 }}>
            {/* 关闭按钮 */}
            <button type="button" className="entry-hall-empty-choice__close" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>

            {/* 标题区 */}
            <span className="entry-hall-empty-choice__kicker">NEW WORLD SLOT</span>
            <h2 id="world-fork-title" style={{ margin: '0 0 4px' }}>基于世界创作</h2>
            <p style={{ margin: '0 0 18px' }}>选择一个内置世界进行派生，或继续编辑已有草稿</p>

          {/* 内置世界网格 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            width: '100%',
            marginBottom: draftsList.length > 0 ? 18 : 0,
          }}>
            {builtins.map(world => (
              <button
                key={world.id}
                type="button"
                onClick={() => handleBuiltinClick(world)}
                title={`基于「${world.name}」创作`}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: '10px 6px',
                  border: '1px solid rgba(169,141,83,.38)',
                  borderRadius: 8,
                  background: 'rgba(224,235,226,.55)',
                  color: '#29424a',
                  transition: 'background .15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(236,244,237,.88)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(224,235,226,.55)')}
              >
                <Copy size={16} strokeWidth={1.8} style={{ color: 'rgba(169,141,83,.8)', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', lineHeight: 1.3, wordBreak: 'break-all' }}>
                  {world.name}
                </span>
              </button>
            ))}
          </div>

          {/* 草稿区 */}
          {draftsList.length > 0 && (
            <div style={{ width: '100%' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 8,
                paddingLeft: 2,
              }}>
                <FileText size={13} strokeWidth={1.8} style={{ color: '#657a7f', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: '#657a7f' }}>
                  草稿 ({draftsList.length})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {draftsList.map(draft => (
                  <div
                    key={draft.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      border: '1px solid rgba(169,141,83,.28)',
                      borderRadius: 7,
                      background: 'rgba(224,235,226,.38)',
                    }}
                  >
                    {/* 左：点击区域 */}
                    <button
                      type="button"
                      onClick={() => onEditDraft(draft)}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#29424a' }}>
                        {draft.draftName}
                      </span>
                      <span style={{ fontSize: 11, color: '#657a7f' }}>
                        派生自 {WORLDS.find(w => w.id === draft.forkedFrom)?.name ?? draft.forkedFrom}
                        · {new Date(draft.draftUpdatedAt).toLocaleDateString('zh-CN')}
                      </span>
                    </button>
                    {/* 右：删除 */}
                    <button
                      type="button"
                      onClick={e => handleDeleteDraft(e, draft.id)}
                      title="删除草稿"
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                        width: 28,
                        height: 28,
                        border: '1px solid rgba(78,108,98,.22)',
                        borderRadius: 6,
                        color: '#657a7f',
                        flexShrink: 0,
                        transition: 'color .15s, border-color .15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger, #a45454)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--danger, #a45454)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#657a7f'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(78,108,98,.22)'; }}
                    >
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DawnFrameV4>
    </div>
    </>
  );
}
