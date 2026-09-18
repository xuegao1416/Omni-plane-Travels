import { useEffect, useState } from 'react';
import type { CustomGameplayModuleDefinition } from '../../custom-modules/schema';
import { listSaveModuleCandidates, previewSaveModuleApplication, applySaveModuleApplication, listSaveModuleRecoveries, restoreSaveModuleRecovery } from '../../custom-modules/saveApplication';

type Candidate = Awaited<ReturnType<typeof listSaveModuleCandidates>>[number];
type Preview = Awaited<ReturnType<typeof previewSaveModuleApplication>>;
type Recovery = Awaited<ReturnType<typeof listSaveModuleRecoveries>>[number];
export function WorkshopSaveApplication({ worldId, module, disabled }: { worldId: string; module: CustomGameplayModuleDefinition; disabled: boolean }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [saveId, setSaveId] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [restoreId, setRestoreId] = useState('');
  useEffect(() => {
    let cancelled = false;
    void listSaveModuleCandidates(worldId).then(items => { if (!cancelled) { setCandidates(items); setSaveId(items[0]?.id ?? ''); } }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [worldId]);
  useEffect(() => {
    let cancelled = false;
    setPreview(undefined); setRecoveries([]); setRestoreId(''); setError(''); setNotice('');
    if (saveId) void listSaveModuleRecoveries(saveId).then(items => { if (!cancelled) setRecoveries(items); }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [saveId, module]);
  const run = async (action: () => Promise<void>) => {
    if (busy || disabled) return;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="mws-save-application"><p className="mws-footnote">已有存档固定使用原模块版本。先预览变更，再手动应用；应用前自动创建恢复点。</p>
    {!candidates.length ? <p className="mws-muted">这个世界还没有可应用的存档。</p> : <><label className="mws-compare">选择存档<select value={saveId} disabled={busy} onChange={event => setSaveId(event.target.value)}>{candidates.map(save => <option key={save.id} value={save.id}>{save.name}{save.active ? '（正在游戏中）' : ''}</option>)}</select></label><button type="button" className="mws-button" disabled={busy || disabled || !saveId} onClick={() => void run(async () => setPreview(await previewSaveModuleApplication(saveId, module)))}>预览应用影响</button></>}
    {preview && <section className="mws-application-preview"><h4>{preview.saveName} · 应用预览</h4>{preview.changes.length ? <ul>{preview.changes.map((change, index) => <li key={index}>{change}</li>)}</ul> : <p className="mws-muted">模块定义没有变化。</p>}{preview.conflicts.map((conflict, index) => <p className="mws-error" key={index}>{conflict}</p>)}<button type="button" className="mws-primary" disabled={disabled || busy || !!preview.conflicts.length} onClick={() => void run(async () => { await applySaveModuleApplication(preview); setPreview(undefined); setRecoveries(await listSaveModuleRecoveries(saveId)); setNotice('模块已应用，原存档已保存为恢复点。'); })}>创建恢复点并应用</button></section>}
    {recoveries.length > 0 && <section><h4>应用恢复点</h4>{recoveries.map(recovery => <article className="mws-recovery" key={recovery.id}><p>{recovery.moduleName} · {new Date(recovery.createdAt).toLocaleString()}</p>{restoreId === recovery.id ? <div className="mws-confirm"><p>将存档恢复为应用该模块之前的状态。</p><button className="mws-button" type="button" disabled={busy || disabled} onClick={() => void run(async () => { await restoreSaveModuleRecovery(recovery.id); setRestoreId(''); setPreview(undefined); setRecoveries(await listSaveModuleRecoveries(saveId)); setNotice('已恢复到应用前的存档。'); })}>确认恢复</button><button className="mws-button" type="button" onClick={() => setRestoreId('')}>取消</button></div> : <button className="mws-button" type="button" disabled={busy || disabled} onClick={() => setRestoreId(recovery.id)}>恢复应用前状态</button>}</article>)}</section>}
    {busy && <p className="mws-muted" role="status">正在处理存档…</p>}{error && <p className="mws-error" role="alert">{error}</p>}{notice && <p className="mws-notice" role="status">{notice}</p>}
  </div>;
}
