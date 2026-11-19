import { useEffect, useState } from 'react';
import { ChevronRight, Download, Heart, Loader, PenLine, Plus, Trash2, Upload, UserPen } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWorkshopStore } from '../../stores/workshopStore';
import { workshopApi } from '../../workshop/api';
import { OWNER_SETTABLE_STATUSES, WORKSHOP_LIMITS, WORKSHOP_STATUS_LABELS, type OwnerSettableStatus, type WorkshopItemSummary } from '../../workshop/protocol';
import WorkshopPublishForm, { type PublishMode } from './WorkshopPublishForm';
import { EmptyState, FeedbackNotice, InlineConfirm, Spinner, Stars, formatCount, formatDate, typeMeta, useWorkshopAction } from './shared';

/** 我的发布：作者昵称、发布新作品、编辑信息、发新版本、切换可见性、删除。 */
export default function WorkshopMine({ onOpen }: { onOpen: (id: string) => void }) {
  const user = useAuthStore(state => state.user);
  const setDisplayName = useAuthStore(state => state.setDisplayName);
  const { mine, mineLoading, mineError, fetchMine } = useWorkshopStore();
  const [form, setForm] = useState<{ mode: PublishMode; item?: WorkshopItemSummary } | null>(null);
  const [name, setName] = useState(user?.displayName ?? '');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const { busy, feedback, setFeedback, run } = useWorkshopAction();

  useEffect(() => { void fetchMine(); }, [fetchMine]);
  useEffect(() => { setName(user?.displayName ?? ''); }, [user?.displayName]);

  const saveName = () => {
    void run('name', () => setDisplayName(name), saved => (saved ? `作者昵称已改为「${saved}」` : '已清除昵称，作品将显示为“旅者”加编号'));
  };

  const changeStatus = (item: WorkshopItemSummary, status: OwnerSettableStatus) => {
    void run(`status-${item.id}`, async () => {
      await workshopApi.setStatus(item.id, status);
      await fetchMine();
    }, () => `「${item.title}」已设为${WORKSHOP_STATUS_LABELS[status]}`);
  };

  const remove = (item: WorkshopItemSummary) => {
    void run(`delete-${item.id}`, async () => {
      await workshopApi.remove(item.id);
      setConfirmDelete(null);
      await fetchMine();
    }, () => `已删除「${item.title}」`);
  };

  return (
    <section className="ws-section" aria-label="我的发布">
      <div className="ws-author">
        <label className="registry-field">
          <span><UserPen size={12} aria-hidden="true" /> 作者昵称</span>
          <div className="ws-inline-input">
            <input className="pk-input" value={name} maxLength={WORKSHOP_LIMITS.displayName} onChange={event => setName(event.target.value)} placeholder="未设置时显示为“旅者”加编号，不会显示邮箱" />
            <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm" onClick={saveName} disabled={busy !== null || name.trim() === (user?.displayName ?? '')}>
              {busy === 'name' && <Loader size={14} className="animate-spin" />}保存
            </button>
          </div>
        </label>
        {!form && <button type="button" className="pk-btn pk-btn--primary pk-btn--sm" onClick={() => setForm({ mode: 'create' })}><Plus size={14} />发布新作品</button>}
      </div>

      <FeedbackNotice feedback={feedback} onDismiss={() => setFeedback(null)} />

      {form && (
        <WorkshopPublishForm
          key={`${form.mode}-${form.item?.id ?? 'new'}`}
          mode={form.mode}
          item={form.item}
          onCancel={() => setForm(null)}
          onDone={(message) => {
            setForm(null);
            setFeedback({ tone: 'ok', message });
            void fetchMine();
          }}
        />
      )}

      {mineError && <FeedbackNotice feedback={{ tone: 'error', message: mineError }} onDismiss={() => void fetchMine()} />}
      {mineLoading && mine.length === 0 && <Spinner />}
      {!mineLoading && !mineError && mine.length === 0 && !form && (
        <EmptyState icon={Upload} title="你还没有发布过作品">
          <small>可以在这里发布，也可以在「本地资产」里点“发布到工坊”。</small>
        </EmptyState>
      )}

      <ul className="ws-list">
        {mine.map(item => {
          const meta = typeMeta(item.type);
          const Icon = meta.icon;
          const hidden = item.status === 'hidden';
          return (
            <li key={item.id} className="ws-row">
              <div className="ws-row__main">
                <span className="ws-type"><Icon size={12} aria-hidden="true" />{meta.label}</span>
                <span className={`ws-status is-${item.status}`}>{WORKSHOP_STATUS_LABELS[item.status]}</span>
                <strong>{item.title}</strong>
                <small>v{item.version} · 更新于 {formatDate(item.updatedAt)}</small>
              </div>
              <div className="ws-row__stats">
                <Stars value={item.ratingAverage} count={item.ratingCount} size={12} />
                <span><Download size={12} aria-hidden="true" />{formatCount(item.downloadCount)}</span>
                <span><Heart size={12} aria-hidden="true" />{formatCount(item.favoriteCount)}</span>
              </div>
              {hidden && <small className="ws-row__warn">该作品被举报后已暂时下架，等待管理员复核；期间仍可修改内容。</small>}
              <div className="ws-row__actions registry-card-actions">
                <button type="button" onClick={() => onOpen(item.id)}><ChevronRight size={14} />详情</button>
                <button type="button" onClick={() => setForm({ mode: 'edit', item })} disabled={busy !== null}><PenLine size={14} />编辑信息</button>
                <button type="button" className="registry-action-primary" onClick={() => setForm({ mode: 'version', item })} disabled={busy !== null}><Upload size={14} />发布新版本</button>
                <label className="ws-status-select">
                  <select className="pk-input" aria-label="可见性" value={hidden ? 'hidden' : item.status} disabled={hidden || busy !== null} onChange={event => changeStatus(item, event.target.value as OwnerSettableStatus)}>
                    {hidden && <option value="hidden">{WORKSHOP_STATUS_LABELS.hidden}</option>}
                    {OWNER_SETTABLE_STATUSES.map(status => <option key={status} value={status}>{WORKSHOP_STATUS_LABELS[status]}</option>)}
                  </select>
                </label>
                {confirmDelete !== item.id && <button type="button" className="registry-action-danger" onClick={() => setConfirmDelete(item.id)} disabled={busy !== null}><Trash2 size={14} />删除</button>}
              </div>
              {confirmDelete === item.id && (
                <InlineConfirm
                  danger
                  busy={busy === `delete-${item.id}`}
                  confirmText="删除作品"
                  onCancel={() => setConfirmDelete(null)}
                  onConfirm={() => remove(item)}
                  message={<p>删除后作品从工坊消失，内容和历史版本一并清除。已经安装的玩家保留本地副本但收不到更新；依赖它的作品会提示依赖已删除。只想暂停新安装的话，可以改为“已归档”。</p>}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
