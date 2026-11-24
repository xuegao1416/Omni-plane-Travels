import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Globe, Loader, PackageCheck, Palette, Power, RefreshCw, Trash2 } from 'lucide-react';
import { getWebEvent } from '../../modules/eventDb';
import { useWorkshopStore } from '../../stores/workshopStore';
import { forgetLocalTarget } from '../../workshop/installs';
import { WORKSHOP_STATUS_LABELS } from '../../workshop/protocol';
import { executeInstall, previewInstall, previewUninstall, setInstalledEventsEnabled, uninstall, type InstalledEntry } from '../../workshop/service';
import { VISUAL_THEME_CHANGED, activateVisualTheme, getActiveVisualThemeId } from '../../workshop/visualTheme';
import { getModuleWorldStatus } from '../../workshop/moduleWorlds';
import { EmptyState, FeedbackNotice, InlineConfirm, Notice, Spinner, formatDate, typeMeta, useWorkshopAction } from './shared';
import WorkshopModuleWorlds from './WorkshopModuleWorlds';

async function updateOne(itemId: string): Promise<string[]> {
  const preview = await previewInstall(itemId);
  if (preview.blockers.length) throw new Error(preview.blockers.join('；'));
  const result = await executeInstall(preview);
  return result.labels;
}

/** 已安装：来源、更新、启用、卸载。 */
export default function WorkshopInstalled({ onOpen }: { onOpen: (id: string) => void }) {
  const { installed, installedLoaded, installedOffline, refreshInstalled } = useWorkshopStore();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [activeTheme, setActiveTheme] = useState<string | null>(() => getActiveVisualThemeId());
  const [confirming, setConfirming] = useState<string | null>(null);
  /** 玩法模块：已在几个世界启用（undefined = 本机找不到模块）。 */
  const [moduleWorlds, setModuleWorlds] = useState<Record<string, number | undefined>>({});
  const [openModule, setOpenModule] = useState<string | null>(null);
  const { busy, feedback, setFeedback, run } = useWorkshopAction();

  useEffect(() => { void refreshInstalled(); }, [refreshInstalled]);
  useEffect(() => {
    const sync = () => setActiveTheme(getActiveVisualThemeId());
    window.addEventListener(VISUAL_THEME_CHANGED, sync);
    return () => window.removeEventListener(VISUAL_THEME_CHANGED, sync);
  }, []);

  const loadEnabled = useCallback(async () => {
    const next: Record<string, boolean> = {};
    for (const entry of installed) {
      const events = entry.record.targets.filter(target => target.kind === 'event');
      if (!events.length) continue;
      const records = await Promise.all(events.map(target => getWebEvent(target.id)));
      next[entry.record.itemId] = records.every(record => record?.enabled);
    }
    setEnabled(next);
  }, [installed]);
  useEffect(() => { void loadEnabled(); }, [loadEnabled]);

  const loadModuleWorlds = useCallback(async () => {
    const next: Record<string, number | undefined> = {};
    for (const entry of installed) {
      const moduleId = entry.record.targets.find(target => target.kind === 'module')?.id;
      if (entry.record.type !== 'gameplay_module' || !moduleId) continue;
      next[entry.record.itemId] = (await getModuleWorldStatus(moduleId))?.enabled.length;
    }
    setModuleWorlds(next);
  }, [installed]);
  useEffect(() => { void loadModuleWorlds(); }, [loadModuleWorlds]);

  const updates = installed.filter(entry => entry.hasUpdate);

  const updateAll = () => {
    void run('update-all', async () => {
      const labels: string[] = [];
      for (const entry of updates) labels.push(...await updateOne(entry.record.itemId));
      await refreshInstalled();
      return labels;
    }, labels => `已更新：${labels.join('、')}`);
  };

  const toggleEvents = (entry: InstalledEntry) => {
    const next = !enabled[entry.record.itemId];
    void run(`events-${entry.record.itemId}`, async () => {
      await setInstalledEventsEnabled(entry.record, next);
      await loadEnabled();
    }, () => (next ? `已启用「${entry.record.title}」，下一回合起生效` : `已停用「${entry.record.title}」`));
  };

  const toggleTheme = (entry: InstalledEntry) => {
    const id = entry.record.targets.find(target => target.kind === 'asset')?.id ?? null;
    const using = activeTheme !== null && activeTheme === id;
    void run(`theme-${entry.record.itemId}`, () => activateVisualTheme(using ? null : id), () => (using ? '已恢复默认色板' : `已使用主题「${entry.record.title}」`));
  };

  const forgetMissing = (entry: InstalledEntry) => {
    void run(`forget-${entry.record.itemId}`, async () => {
      for (const target of entry.missingTargets) await forgetLocalTarget(target.kind, target.id);
      await refreshInstalled();
    }, () => '已移除失效的安装记录');
  };

  const doUninstall = (entry: InstalledEntry) => {
    void run(`uninstall-${entry.record.itemId}`, async () => {
      const result = await uninstall(entry.record.itemId);
      setConfirming(null);
      await refreshInstalled();
      return result;
    }, result => `已卸载：${result.removed.join('、')}`);
  };

  if (!installedLoaded) return <Spinner label="正在读取已安装内容…" />;

  return (
    <section className="ws-section" aria-label="已安装">
      <div className="ws-section__head">
        <p>这里列出从创意工坊装到本机的内容。作为依赖被带进来的条目会标注“依赖”，卸载主条目时一起清理。</p>
        {updates.length > 1 && (
          <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" onClick={updateAll} disabled={busy !== null}>
            {busy === 'update-all' ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}全部更新（{updates.length}）
          </button>
        )}
      </div>
      {installedOffline && <Notice tone="info">暂时连不上创意工坊，无法检查更新；本地内容不受影响。</Notice>}
      <FeedbackNotice feedback={feedback} onDismiss={() => setFeedback(null)} />

      {installed.length === 0 && <EmptyState icon={PackageCheck} title="还没有从创意工坊安装过内容" />}

      <ul className="ws-list">
        {installed.map(entry => {
          const { record } = entry;
          const meta = typeMeta(record.type);
          const Icon = meta.icon;
          const hasEvents = record.targets.some(target => target.kind === 'event');
          const themeId = record.type === 'visual_theme' ? record.targets.find(target => target.kind === 'asset')?.id : undefined;
          const moduleId = record.type === 'gameplay_module' ? record.targets.find(target => target.kind === 'module')?.id : undefined;
          const moduleMissing = moduleId !== undefined && entry.missingTargets.some(target => target.kind === 'module' && target.id === moduleId);
          const worldCount = moduleWorlds[record.itemId];
          const removal = confirming === record.itemId ? previewUninstall(record.itemId, installed.map(item => item.record)) : null;
          const gone = entry.remoteStatus && entry.remoteStatus !== 'published' && entry.remoteStatus !== 'unlisted';
          return (
            <li key={record.itemId} className="ws-row">
              <div className="ws-row__main">
                <span className="ws-type"><Icon size={12} aria-hidden="true" />{meta.label}</span>
                {!record.explicit && <span className="ws-tag-soft">依赖</span>}
                <strong>{record.title}</strong>
                <small>v{record.version} · {record.authorName || '未知作者'} · 安装于 {formatDate(record.installedAt)}</small>
              </div>
              {entry.hasUpdate && <span className="ws-installed has-update">可更新到 v{entry.latestVersion}</span>}
              {gone && <span className="ws-status is-archived">作者端：{WORKSHOP_STATUS_LABELS[entry.remoteStatus!]}</span>}
              {moduleId && !moduleMissing && worldCount !== undefined && (worldCount > 0
                ? <span className="ws-installed">已在 {worldCount} 个世界启用</span>
                : <span className="ws-row__warn"><AlertTriangle size={13} aria-hidden="true" />还没有在任何世界启用，点「世界与存档」选择世界</span>)}
              {entry.missingTargets.length > 0 && (
                <span className="ws-row__warn"><AlertTriangle size={13} aria-hidden="true" />本地已删除：{entry.missingTargets.map(target => target.label).join('、')}</span>
              )}
              <div className="ws-row__actions registry-card-actions">
                {entry.hasUpdate && (
                  <button type="button" className="registry-action-primary" disabled={busy !== null} onClick={() => void run(`update-${record.itemId}`, async () => { const labels = await updateOne(record.itemId); await refreshInstalled(); return labels; }, labels => `已更新：${labels.join('、')}`)}>
                    {busy === `update-${record.itemId}` ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}更新
                  </button>
                )}
                {hasEvents && (
                  <button type="button" aria-pressed={Boolean(enabled[record.itemId])} disabled={busy !== null} onClick={() => toggleEvents(entry)}>
                    <Power size={14} />{enabled[record.itemId] ? '已启用' : '启用'}
                  </button>
                )}
                {moduleId && !moduleMissing && (
                  <button type="button" aria-expanded={openModule === record.itemId} disabled={busy !== null} onClick={() => setOpenModule(current => (current === record.itemId ? null : record.itemId))}>
                    <Globe size={14} />世界与存档
                  </button>
                )}
                {themeId && (
                  <button type="button" aria-pressed={activeTheme === themeId} disabled={busy !== null} onClick={() => toggleTheme(entry)}>
                    <Palette size={14} />{activeTheme === themeId ? '使用中 · 停用' : '使用主题'}
                  </button>
                )}
                {entry.missingTargets.length > 0 && entry.missingTargets.length === record.targets.length && (
                  <button type="button" disabled={busy !== null} onClick={() => forgetMissing(entry)}>移除记录</button>
                )}
                <button type="button" onClick={() => onOpen(record.itemId)} disabled={entry.remoteStatus === 'deleted'}><ChevronRight size={14} />详情</button>
                {(record.explicit || record.requiredBy.length === 0) && confirming !== record.itemId && (
                  <button type="button" className="registry-action-danger" disabled={busy !== null} onClick={() => setConfirming(record.itemId)}><Trash2 size={14} />卸载</button>
                )}
              </div>
              {moduleId && !moduleMissing && openModule === record.itemId && <WorkshopModuleWorlds moduleId={moduleId} onChanged={() => void loadModuleWorlds()} />}
              {removal && (removal.blockedBy.length ? (
                <Notice tone="error" onDismiss={() => setConfirming(null)}><p>「{removal.blockedBy.map(item => item.title).join('」「')}」依赖它，请先卸载它们。</p></Notice>
              ) : (
                <InlineConfirm
                  danger
                  busy={busy === `uninstall-${record.itemId}`}
                  confirmText="卸载"
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => doUninstall(entry)}
                  message={<><p>将删除这些内容写入本地的资产：</p><ul>{removal.records.map(item => <li key={item.itemId}>{item.title}{item.itemId === record.itemId ? '' : '（依赖）'}</li>)}</ul></>}
                />
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
