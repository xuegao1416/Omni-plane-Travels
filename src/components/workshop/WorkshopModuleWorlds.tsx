import { useCallback, useEffect, useState } from 'react';
import { Loader, Power, RotateCcw } from 'lucide-react';
import {
  applySaveModuleApplication, listSaveModuleRecoveries, previewSaveModuleApplication, restoreSaveModuleRecovery,
  type SaveModuleApplicationPreview, type SaveModuleRecovery,
} from '../../custom-modules/saveApplication';
import {
  disableModuleInWorld, enableModuleInWorld, getModuleWorldStatus, listModuleSaveOptions,
  type ModuleSaveOption, type ModuleWorldStatus,
} from '../../workshop/moduleWorlds';
import { FeedbackNotice, InlineConfirm, Notice, Spinner, useWorkshopAction } from './shared';

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * 已安装的玩法模块：在哪些世界启用（之后新开的游戏会带上它），以及应用到已有存档。
 * 已有存档固定使用开局时的模块，应用走「预览 → 创建恢复点并应用 → 需要时恢复」。
 */
export default function WorkshopModuleWorlds({ moduleId, onChanged }: { moduleId: string; onChanged?: () => void }) {
  const [status, setStatus] = useState<ModuleWorldStatus | null | undefined>(undefined);
  const [worldChoice, setWorldChoice] = useState('');
  const [saves, setSaves] = useState<ModuleSaveOption[]>([]);
  const [saveId, setSaveId] = useState('');
  const [preview, setPreview] = useState<SaveModuleApplicationPreview | null>(null);
  const [recoveries, setRecoveries] = useState<SaveModuleRecovery[]>([]);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const { busy, feedback, setFeedback, run } = useWorkshopAction();

  const reload = useCallback(async () => {
    const next = await getModuleWorldStatus(moduleId);
    setStatus(next ?? null);
    setWorldChoice(current => (next?.available.some(world => world.id === current) ? current : next?.available[0]?.id ?? ''));
    const options = next ? await listModuleSaveOptions(moduleId) : [];
    setSaves(options);
    setSaveId(current => (options.some(option => option.saveId === current) ? current : options[0]?.saveId ?? ''));
  }, [moduleId]);
  useEffect(() => { void reload(); }, [reload]);

  const loadRecoveries = useCallback(async (id: string) => {
    setRecoveries(id ? (await listSaveModuleRecoveries(id)).filter(item => item.moduleId === moduleId) : []);
  }, [moduleId]);
  useEffect(() => {
    setPreview(null);
    setRestoreId(null);
    void loadRecoveries(saveId);
  }, [saveId, loadRecoveries]);

  if (status === undefined) return <Spinner label="正在读取模块的世界与存档…" />;
  if (status === null) return <Notice tone="error">本机找不到这个模块，可能已在本地资产里删除。重新安装后才能启用。</Notice>;

  const selected = saves.find(option => option.saveId === saveId);
  const worldName = (id: string) => status.available.find(world => world.id === id)?.name ?? status.enabled.find(world => world.id === id)?.name ?? id;

  const enable = () => {
    const id = worldChoice;
    if (!id) return;
    void run(`module-enable-${id}`, async () => { await enableModuleInWorld(moduleId, id); await reload(); onChanged?.(); },
      () => `已在「${worldName(id)}」启用。这个世界之后新开的游戏会带上它；已有存档可以在下面应用。`);
  };
  const disable = (id: string) => {
    const name = worldName(id);
    void run(`module-disable-${id}`, async () => { await disableModuleInWorld(moduleId, id); await reload(); onChanged?.(); },
      () => `已在「${name}」停用。之后新开的游戏不再带上它，已有存档不受影响。`);
  };
  const doPreview = () => {
    if (!selected) return;
    void run(`module-preview-${selected.saveId}`, async () => { setPreview(await previewSaveModuleApplication(selected.saveId, selected.module)); });
  };
  const doApply = () => {
    if (!preview) return;
    void run(`module-apply-${preview.saveId}`, async () => {
      await applySaveModuleApplication(preview);
      setPreview(null);
      await loadRecoveries(preview.saveId);
    }, () => `已应用到「${preview.saveName}」，应用前的存档保存为恢复点。`);
  };
  const doRestore = (recovery: SaveModuleRecovery) => {
    void run(`module-restore-${recovery.id}`, async () => {
      await restoreSaveModuleRecovery(recovery.id);
      setRestoreId(null);
      await loadRecoveries(recovery.saveId);
    }, () => `「${recovery.saveName}」已恢复到应用这个模块之前。`);
  };

  return (
    <div className="ws-module-worlds">
      <section className="ws-module-worlds__block" aria-label="在哪些世界启用">
        <h5>在这些世界启用</h5>
        {status.enabled.length ? (
          <ul className="ws-module-worlds__chips">
            {status.enabled.map(world => (
              <li key={world.id}>
                <span>{world.name}{world.missing ? '（世界已删除）' : ''}</span>
                <button type="button" disabled={busy !== null} onClick={() => disable(world.id)}>
                  {busy === `module-disable-${world.id}` && <Loader size={12} className="animate-spin" aria-hidden="true" />}停用
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="ws-module-worlds__hint">还没有在任何世界启用。启用后，这个世界之后新开的游戏会带上它。</p>}
        {status.available.length > 0 && (
          <div className="ws-inline-input">
            <select className="pk-input" aria-label="选择要启用的世界" value={worldChoice} disabled={busy !== null} onChange={event => setWorldChoice(event.target.value)}>
              {status.available.map(world => <option key={world.id} value={world.id}>{world.name}</option>)}
            </select>
            <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" disabled={busy !== null || !worldChoice} onClick={enable}>
              {busy?.startsWith('module-enable-') ? <Loader size={14} className="animate-spin" aria-hidden="true" /> : <Power size={14} aria-hidden="true" />}启用
            </button>
          </div>
        )}
      </section>

      {status.enabled.length > 0 && (
        <section className="ws-module-worlds__block" aria-label="应用到已有存档">
          <h5>应用到已有存档</h5>
          <p className="ws-module-worlds__hint">已有存档固定使用开局时的模块。先预览，再应用；应用前会自动创建恢复点。</p>
          {saves.length === 0 ? <p className="ws-module-worlds__hint">启用的世界里还没有可应用的存档。</p> : (
            <div className="ws-inline-input">
              <select className="pk-input" aria-label="选择存档" value={saveId} disabled={busy !== null} onChange={event => setSaveId(event.target.value)}>
                {saves.map(option => <option key={option.saveId} value={option.saveId}>{option.saveName} · {option.worldName}{option.active ? '（正在游戏中）' : ''}</option>)}
              </select>
              <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm" disabled={busy !== null || !selected || selected.active} onClick={doPreview}>
                {busy?.startsWith('module-preview-') && <Loader size={14} className="animate-spin" aria-hidden="true" />}预览
              </button>
            </div>
          )}
          {selected?.active && <p className="ws-module-worlds__hint">这个存档正在游戏中，请先回到主菜单再应用。</p>}
          {preview && preview.saveId === saveId && (
            <div className="ws-module-worlds__preview">
              <p>「{preview.saveName}」应用后：</p>
              <ul>{preview.changes.map(change => <li key={change}>{change}</li>)}</ul>
              {preview.conflicts.length > 0 && <Notice tone="error"><p>不能应用：</p><ul>{preview.conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}</ul></Notice>}
              <div className="ws-row-actions">
                <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" disabled={busy !== null} onClick={() => setPreview(null)}>取消</button>
                <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" disabled={busy !== null || preview.conflicts.length > 0} onClick={doApply}>
                  {busy?.startsWith('module-apply-') && <Loader size={14} className="animate-spin" aria-hidden="true" />}创建恢复点并应用
                </button>
              </div>
            </div>
          )}
          {recoveries.length > 0 && (
            <ul className="ws-module-worlds__recoveries" aria-label="恢复点">
              {recoveries.map(recovery => (
                <li key={recovery.id}>
                  <span>{formatTime(recovery.createdAt)} 应用前的存档</span>
                  {recovery.restoredAt ? <small>已恢复</small> : restoreId === recovery.id ? (
                    <InlineConfirm
                      danger
                      busy={busy === `module-restore-${recovery.id}`}
                      confirmText="恢复"
                      onCancel={() => setRestoreId(null)}
                      onConfirm={() => doRestore(recovery)}
                      message={<p>把「{recovery.saveName}」恢复成应用这个模块之前的样子。应用后这个存档有过新的进度时不能恢复。</p>}
                    />
                  ) : (
                    <button type="button" disabled={busy !== null} onClick={() => setRestoreId(recovery.id)}><RotateCcw size={13} aria-hidden="true" />恢复应用前状态</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <FeedbackNotice feedback={feedback} onDismiss={() => setFeedback(null)} />
    </div>
  );
}
