/**
 * 世界派生选择弹窗
 * - 展示 6 个内置世界，点击即派生（fork）为草稿并打开编辑器
 * - 草稿区域：点击继续编辑，× 删除
 * - 复用 entry-hall-empty-choice 结构（DawnFrameV4 + backdrop），星仪样式见 ui/screens/ritual-overlays.css
 */
import { useEffect,useState } from 'react';
import { Copy,Trash2,X,FileText } from 'lucide-react';
import type { WorldDef } from '../../data/worldLoader';
import { WORLDS,listWorldDrafts,type WorldDraft } from '../../data/worldLoader';
import { forkWorld } from '../../data/worldLoader';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { useDialog } from '../shared/Dialog';
import { resolveWorldIcon } from '../shared/worldIcons';
import '../../ui/screens/ritual-overlays.css';

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
        className="entry-hall-empty-choice world-fork-select"
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-fork-title"
        onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      >
        <div className="entry-hall-empty-choice__backdrop" aria-hidden="true" onClick={onClose} />
        <DawnFrameV4 mode="panel" withFill ariaLabel="选择世界" className="world-fork-select__frame">
          <div className="world-fork-select__content">
            <button type="button" className="world-fork-select__close" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>

            <header className="world-fork-select__header">
              <span className="world-fork-select__kicker">派生新世界 · FORK A PLANE</span>
              <h2 id="world-fork-title">基于世界创作</h2>
              <p>选择一个内置世界进行派生，或继续编辑已有草稿</p>
            </header>

            <div className="world-fork-select__grid">
              {builtins.map(world => {
                const Icon = resolveWorldIcon(world.icon);
                return (
                  <button
                    key={world.id}
                    type="button"
                    className="world-fork-select__world"
                    onClick={() => handleBuiltinClick(world)}
                    title={`基于「${world.name}」创作`}
                  >
                    <span className="world-fork-select__sigil" aria-hidden="true"><Icon size={18} strokeWidth={1.6} /></span>
                    <span className="world-fork-select__name">{world.name}</span>
                    {world.tags && world.tags.length > 0 && (
                      <span className="world-fork-select__tags">{world.tags.slice(0, 2).join(' · ')}</span>
                    )}
                    <Copy className="world-fork-select__fork" size={13} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            {draftsList.length > 0 && (
              <section className="world-fork-select__drafts" aria-label="草稿">
                <div className="world-fork-select__drafts-title">
                  <FileText size={13} strokeWidth={1.8} aria-hidden="true" />
                  <span>草稿 ({draftsList.length})</span>
                </div>
                <div className="world-fork-select__draft-list">
                  {draftsList.map(draft => (
                    <div key={draft.id} className="world-fork-select__draft">
                      <button type="button" className="world-fork-select__draft-open" onClick={() => onEditDraft(draft)}>
                        <span className="world-fork-select__draft-name">{draft.draftName}</span>
                        <span className="world-fork-select__draft-meta">
                          派生自 {WORLDS.find(w => w.id === draft.forkedFrom)?.name ?? draft.forkedFrom}
                          {' · '}{new Date(draft.draftUpdatedAt).toLocaleDateString('zh-CN')}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="world-fork-select__draft-delete"
                        onClick={e => handleDeleteDraft(e, draft.id)}
                        title="删除草稿"
                        aria-label={`删除草稿 ${draft.draftName}`}
                      >
                        <Trash2 size={13} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </DawnFrameV4>
      </div>
    </>
  );
}
