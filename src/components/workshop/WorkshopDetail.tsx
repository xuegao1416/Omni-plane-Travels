import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Download, Eye, EyeOff, Flag, Heart, History, ListOrdered, Loader, RefreshCw, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import OverlayPortal from '../shared/OverlayPortal';
import PlanarFrame from '../../ui/planar/PlanarFrame';
import { useAuthStore } from '../../stores/authStore';
import { useWorkshopStore } from '../../stores/workshopStore';
import { describeWorkshopError, workshopApi } from '../../workshop/api';
import type { ConflictPolicy } from '../../workshop/installers';
import type { InstallTargetKind } from '../../workshop/installs';
import {
  WORKSHOP_REPORT_REASONS,
  WORKSHOP_REPORT_REASON_LABELS,
  WORKSHOP_STATUS_LABELS,
  type WorkshopAuthor,
  type WorkshopItemDetail,
  type WorkshopReportReason,
  type WorkshopVersionInfo,
  type WorkshopViewerState,
} from '../../workshop/protocol';
import { executeInstall, previewInstall, previewUninstall, uninstall, type InstallAction, type InstallPreview } from '../../workshop/service';
import { FeedbackNotice, InlineConfirm, Notice, Spinner, Stars, formatDate, formatSize, typeMeta, useWorkshopAction } from './shared';

const ACTION_LABELS: Record<InstallAction, string> = {
  install: '将安装',
  update: '将更新',
  reinstall: '重新安装',
  skip: '已安装，保留现有版本',
};

const KIND_LABELS: Record<InstallTargetKind, string> = {
  world: '世界',
  module: '玩法模块',
  event: '事件包',
  npc: 'NPC 模板',
  asset: '资产',
};

const AFTER_INSTALL_HINTS: Partial<Record<string, string>> = {
  world_package: '新游戏时可以在世界列表里选择它。',
  gameplay_module: '单独安装的模块需要在世界的玩法模块设置里启用。',
  event_pack: '事件包装好后默认停用，可在「已安装」里一键启用。',
  workflow_pack: '工作流包装好后默认停用，可在「已安装」里一键启用。',
  adventure_pack: '冒险包作为事件卡出现，装好后默认停用，可在「已安装」里一键启用。',
  visual_theme: '可在「已安装」里使用这个主题。',
  npc_template: '创建 NPC 时可以从模板导入。',
};

interface Props {
  itemId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
  onFilterAuthor: (author: WorkshopAuthor) => void;
}

function viewerOf(detail: WorkshopItemDetail): WorkshopViewerState {
  return detail.viewer ?? { isOwner: false, rating: null, favorited: false, reported: false };
}

export default function WorkshopDetail({ itemId, onClose, onOpen, onFilterAuthor }: Props) {
  const { user, isAuthenticated } = useAuthStore();
  const installed = useWorkshopStore(state => state.installed);
  const refreshInstalled = useWorkshopStore(state => state.refreshInstalled);
  const patchItem = useWorkshopStore(state => state.patchItem);
  const [detail, setDetail] = useState<WorkshopItemDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, ConflictPolicy>>({});
  const [versions, setVersions] = useState<WorkshopVersionInfo[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState<WorkshopReportReason>('spam');
  const [reportDetail, setReportDetail] = useState('');
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const { busy, feedback, setFeedback, run } = useWorkshopAction();

  const loadPreview = useCallback(async () => {
    setPreviewError(null);
    try {
      setPreview(await previewInstall(itemId));
    } catch (error) {
      setPreview(null);
      setPreviewError(describeWorkshopError(error));
    }
  }, [itemId]);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setLoadError(null);
    setPreview(null);
    setVersions(null);
    setShowVersions(false);
    setReporting(false);
    setConfirmUninstall(false);
    setConflicts({});
    setFeedback(null);
    workshopApi.get(itemId)
      .then(item => { if (!cancelled) setDetail(item); })
      .catch(error => { if (!cancelled) setLoadError(describeWorkshopError(error)); });
    void loadPreview();
    return () => { cancelled = true; };
  }, [itemId, loadPreview, setFeedback]);

  const installedEntry = installed.find(entry => entry.record.itemId === itemId);
  const removal = useMemo(() => (installedEntry ? previewUninstall(itemId, installed.map(entry => entry.record)) : null), [installed, installedEntry, itemId]);
  const root = preview?.entries.find(entry => entry.role === 'root');
  const blockers = preview?.blockers ?? [];

  const refreshDetail = async () => {
    const fresh = await workshopApi.get(itemId);
    setDetail(fresh);
    patchItem(itemId, { ratingAverage: fresh.ratingAverage, ratingCount: fresh.ratingCount, favoriteCount: fresh.favoriteCount, featured: fresh.featured, status: fresh.status });
    return fresh;
  };

  if (loadError || !detail) {
    return (
      <OverlayPortal className="pk-dialog-overlay" ariaLabel="工坊条目详情" onClose={onClose}>
        <PlanarFrame className="pk-dialog registry-workshop-detail ws-detail" onClick={event => event.stopPropagation()}>
          {loadError ? <Notice tone="error">{loadError}</Notice> : <Spinner label="正在读取条目…" />}
          <div className="pk-dialog__actions"><button type="button" className="pk-btn pk-btn--ghost" onClick={onClose}><ArrowLeft />返回</button></div>
        </PlanarFrame>
      </OverlayPortal>
    );
  }

  const meta = typeMeta(detail.type);
  const viewer = viewerOf(detail);
  const canInteract = isAuthenticated && !viewer.isOwner && (detail.status === 'published' || detail.status === 'unlisted');
  const installLabel = blockers.length ? '无法安装' : root?.action === 'update' ? `更新到 v${root.item.version}` : root?.action === 'reinstall' ? '重新安装' : '安装';

  const install = () => {
    if (!preview) return;
    void run('install', async () => {
      const result = await executeInstall(preview, { conflicts });
      await refreshInstalled();
      await loadPreview();
      return result;
    }, result => ({
      tone: 'ok',
      message: `已安装：${result.labels.join('、')}`,
      details: [...result.warnings, ...(AFTER_INSTALL_HINTS[detail.type] ? [AFTER_INSTALL_HINTS[detail.type]!] : [])],
    }));
  };

  const doUninstall = () => {
    void run('uninstall', async () => {
      const result = await uninstall(itemId);
      setConfirmUninstall(false);
      await refreshInstalled();
      await loadPreview();
      return result;
    }, result => `已卸载：${result.removed.join('、')}`);
  };

  const rate = (score: number) => {
    void run('rate', async () => {
      await workshopApi.rate(itemId, score);
      await refreshDetail();
    }, () => `已评 ${score} 星，谢谢反馈`);
  };

  const clearRating = () => {
    void run('rate', async () => {
      await workshopApi.clearRating(itemId);
      await refreshDetail();
    }, () => '已清除你的评分');
  };

  const toggleFavorite = () => {
    const next = !viewer.favorited;
    void run('favorite', async () => {
      await workshopApi.favorite(itemId, next);
      await refreshDetail();
    }, () => (next ? '已加入收藏' : '已取消收藏'));
  };

  const submitReport = () => {
    void run('report', async () => {
      const result = await workshopApi.report(itemId, reportReason, reportDetail.trim() || undefined);
      setReporting(false);
      setReportDetail('');
      setDetail(current => current && { ...current, viewer: { ...viewerOf(current), reported: true } });
      return result;
    }, result => (result.hidden ? '已收到举报。举报人数已达上限，条目已暂时下架，等待管理员复核。' : '已收到举报，管理员会尽快处理。'));
  };

  const adminPatch = (patch: { featured?: boolean; status?: 'published' | 'hidden' }) => {
    void run('admin', async () => {
      await workshopApi.admin.updateItem(itemId, patch);
      await refreshDetail();
    }, () => '已更新条目的管理状态');
  };

  const toggleVersions = () => {
    setShowVersions(open => !open);
    if (versions) return;
    workshopApi.versions(itemId).then(setVersions).catch(error => setFeedback({ tone: 'error', message: describeWorkshopError(error) }));
  };

  return (
    <OverlayPortal className="pk-dialog-overlay" ariaLabel={`${detail.title}详情`} onClose={onClose}>
      <PlanarFrame className="pk-dialog registry-workshop-detail ws-detail" onClick={event => event.stopPropagation()}>
        <header className="registry-workshop-detail__head">
          <small className="pk-kicker">{meta.label}{detail.featured ? ' · 编辑精选' : ''}</small>
          <h2 className="pk-title">{detail.title}</h2>
          <p className="ws-detail__byline">
            <button type="button" className="ws-link" onClick={() => onFilterAuthor(detail.author)} title="只看这位作者的作品">{detail.author.name}</button>
            <span>v{detail.version}</span>
            <span>更新于 {formatDate(detail.updatedAt)}</span>
            <span>{formatSize(detail.dataSize)}</span>
            <span><Download size={12} aria-hidden="true" />{detail.downloadCount}</span>
          </p>
          {detail.status !== 'published' && <span className={`ws-status is-${detail.status}`}>{WORKSHOP_STATUS_LABELS[detail.status]}</span>}
        </header>

        <div className="registry-workshop-detail__body">
          <div className="ws-detail__social">
            <div className="ws-detail__rating">
              <Stars value={detail.ratingAverage} count={detail.ratingCount} />
              {canInteract && (
                <span className="ws-detail__mine">
                  <span>我的评分</span>
                  <Stars value={null} mine={viewer.rating} onRate={rate} disabled={busy !== null} />
                  {viewer.rating !== null && <button type="button" className="ws-link" onClick={clearRating} disabled={busy !== null}>清除</button>}
                </span>
              )}
            </div>
            <div className="ws-detail__social-actions">
              {canInteract && (
                <button type="button" className={`pk-btn pk-btn--sm ${viewer.favorited ? 'pk-btn--secondary' : 'pk-btn--ghost'}`} aria-pressed={viewer.favorited} onClick={toggleFavorite} disabled={busy !== null}>
                  <Heart aria-hidden="true" />{viewer.favorited ? '已收藏' : '收藏'} · {detail.favoriteCount}
                </button>
              )}
              {canInteract && (viewer.reported
                ? <span className="ws-muted"><Flag size={13} aria-hidden="true" />已举报，等待处理</span>
                : <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" aria-expanded={reporting} onClick={() => setReporting(open => !open)}><Flag aria-hidden="true" />举报</button>)}
              {viewer.isOwner && <span className="ws-muted">这是你的作品，可在「我的发布」里管理</span>}
            </div>
          </div>

          {reporting && (
            <section className="ws-report" aria-label="举报">
              <label className="registry-field"><span>理由</span>
                <select className="pk-input" value={reportReason} onChange={event => setReportReason(event.target.value as WorkshopReportReason)}>
                  {WORKSHOP_REPORT_REASONS.map(reason => <option key={reason} value={reason}>{WORKSHOP_REPORT_REASON_LABELS[reason]}</option>)}
                </select>
              </label>
              <label className="registry-field"><span>补充说明（可选）</span>
                <textarea className="pk-input" rows={2} maxLength={500} value={reportDetail} onChange={event => setReportDetail(event.target.value)} placeholder="哪里有问题？" />
              </label>
              <div className="ws-row-actions">
                <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" onClick={() => setReporting(false)}>取消</button>
                <button type="button" className="pk-btn pk-btn--sm ws-btn-danger" onClick={submitReport} disabled={busy !== null}>{busy === 'report' && <Loader size={14} className="animate-spin" />}提交举报</button>
              </div>
            </section>
          )}

          <FeedbackNotice feedback={feedback} onDismiss={() => setFeedback(null)} />

          {detail.screenshots.length > 0 && (
            <div className="registry-workshop-shots">
              {detail.screenshots.map((src, index) => <img key={src} src={src} alt={`${detail.title} 截图 ${index + 1}`} loading="lazy" />)}
            </div>
          )}
          <p className="registry-workshop-detail__prose">{detail.description || '作者没有写说明。'}</p>
          {detail.tags.length > 0 && <div className="registry-workshop-tags">{detail.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}

          {detail.changelog && (
            <section className="ws-block">
              <strong>v{detail.version} 更新内容</strong>
              <p>{detail.changelog}</p>
            </section>
          )}

          <section className="ws-block">
            <button type="button" className="ws-block__toggle" aria-expanded={showVersions} onClick={toggleVersions}><History size={14} aria-hidden="true" />版本历史</button>
            {showVersions && (versions === null ? <Spinner label="正在读取版本…" /> : (
              <ol className="ws-versions">
                {versions.map(version => (
                  <li key={version.version}>
                    <b>v{version.version}</b><small>{formatDate(version.createdAt)} · {formatSize(version.dataSize)}</small>
                    {version.changelog && <p>{version.changelog}</p>}
                  </li>
                ))}
              </ol>
            ))}
          </section>

          <section className="ws-plan" aria-label="安装计划">
            <strong><ListOrdered aria-hidden="true" />安装计划</strong>
            {previewError && <span className="is-error"><AlertTriangle size={13} />{previewError}<button type="button" className="ws-link" onClick={() => void loadPreview()}>重试</button></span>}
            {!preview && !previewError && <Spinner label="正在解析依赖…" />}
            {preview && (
              <ol className="ws-plan__list">
                {preview.entries.map(entry => (
                  <li key={entry.item.id} className={`ws-plan__item is-${entry.action}`}>
                    <div className="ws-plan__row">
                      <b>{entry.item.title}</b>
                      <small>{typeMeta(entry.item.type).label} · v{entry.item.version}</small>
                      <span className="ws-plan__action">{ACTION_LABELS[entry.action]}{entry.action === 'update' && entry.installedVersion ? `（当前 v${entry.installedVersion}）` : ''}</span>
                      {entry.role === 'dependency' && <button type="button" className="ws-link" onClick={() => onOpen(entry.item.id)}>查看</button>}
                    </div>
                    {entry.conflict && (
                      <fieldset className="ws-conflict">
                        <legend>
                          本地已有 id 为「{entry.conflict.id}」的{KIND_LABELS[entry.conflict.kind]}
                          {entry.conflict.ownerTitle ? `（来自已安装的「${entry.conflict.ownerTitle}」）` : ''}
                        </legend>
                        {entry.conflict.builtin ? <span>它和内置内容同名，会另存为副本，内置内容不受影响。</span> : (
                          <>
                            <label><input type="radio" name={`conflict-${entry.item.id}`} checked={(conflicts[entry.item.id] ?? 'copy') === 'copy'} onChange={() => setConflicts(current => ({ ...current, [entry.item.id]: 'copy' }))} />另存为副本（保留本地版本）</label>
                            <label><input type="radio" name={`conflict-${entry.item.id}`} checked={conflicts[entry.item.id] === 'replace'} onChange={() => setConflicts(current => ({ ...current, [entry.item.id]: 'replace' }))} />用工坊版本覆盖本地版本</label>
                          </>
                        )}
                      </fieldset>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {blockers.map(blocker => <span key={blocker} className="is-error"><AlertTriangle size={13} />{blocker}</span>)}
            {preview?.plan.recommendations.map(recommendation => (
              <span key={`recommend-${recommendation.id}`} className="ws-plan__recommendation">
                推荐搭配：{recommendation.title ?? recommendation.id}{recommendation.reason ? ` · ${recommendation.reason}` : ''}
                {recommendation.available ? <button type="button" className="ws-link" onClick={() => onOpen(recommendation.id)}>查看</button> : <small>（暂不可用）</small>}
              </span>
            ))}
          </section>

          {user?.workshopAdmin && (
            <section className="ws-block ws-admin-strip" aria-label="管理">
              <strong><ShieldAlert size={14} aria-hidden="true" />管理</strong>
              <div className="ws-row-actions">
                <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" onClick={() => adminPatch({ featured: !detail.featured })} disabled={busy !== null}><Sparkles aria-hidden="true" />{detail.featured ? '取消精选' : '设为精选'}</button>
                {detail.status === 'hidden'
                  ? <button type="button" className="pk-btn pk-btn--ghost pk-btn--sm" onClick={() => adminPatch({ status: 'published' })} disabled={busy !== null}><Eye aria-hidden="true" />恢复上架</button>
                  : <button type="button" className="pk-btn pk-btn--sm ws-btn-danger" onClick={() => adminPatch({ status: 'hidden' })} disabled={busy !== null}><EyeOff aria-hidden="true" />下架</button>}
              </div>
            </section>
          )}
        </div>

        {confirmUninstall && removal && (removal.blockedBy.length ? (
          <Notice tone="error" onDismiss={() => setConfirmUninstall(false)}>
            <p>「{removal.blockedBy.map(record => record.title).join('」「')}」依赖它，请先卸载它们。</p>
          </Notice>
        ) : (
          <InlineConfirm
            danger
            busy={busy === 'uninstall'}
            confirmText="卸载"
            onCancel={() => setConfirmUninstall(false)}
            onConfirm={doUninstall}
            message={<><p>将删除这些内容写入本地的资产：</p><ul>{removal.records.map(record => <li key={record.itemId}>{record.title}{record.itemId === itemId ? '' : '（不再被其他内容需要的依赖）'}</li>)}</ul></>}
          />
        ))}

        <div className="pk-dialog__actions">
          <button type="button" className="pk-btn pk-btn--ghost" onClick={onClose}><ArrowLeft />返回</button>
          {installedEntry && !confirmUninstall && (
            <button type="button" className="pk-btn ws-btn-danger-ghost" onClick={() => setConfirmUninstall(true)} disabled={busy !== null}><Trash2 />卸载</button>
          )}
          <button type="button" className="pk-btn pk-btn--primary" onClick={install} disabled={!preview || blockers.length > 0 || busy !== null}>
            {busy === 'install' ? <Loader className="animate-spin" /> : root?.action === 'update' || root?.action === 'reinstall' ? <RefreshCw /> : <Download />}{installLabel}
          </button>
        </div>
      </PlanarFrame>
    </OverlayPortal>
  );
}
