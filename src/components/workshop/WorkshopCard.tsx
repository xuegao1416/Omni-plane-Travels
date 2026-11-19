import { CheckCircle2, Download, Heart, Sparkles } from 'lucide-react';
import type { WorkshopItemSummary } from '../../workshop/protocol';
import { WORKSHOP_STATUS_LABELS } from '../../workshop/protocol';
import type { InstalledEntry } from '../../workshop/service';
import { Stars, formatCount, formatDate, typeMeta } from './shared';

interface Props {
  item: WorkshopItemSummary;
  installed?: InstalledEntry;
  onOpen: (id: string) => void;
  /** 作者视角：显示状态，不显示安装徽标。 */
  showStatus?: boolean;
}

export default function WorkshopCard({ item, installed, onOpen, showStatus }: Props) {
  const meta = typeMeta(item.type);
  const Icon = meta.icon;
  const cover = item.screenshots[0];
  const update = installed && installed.hasUpdate;
  return (
    <article className="ws-card">
      <button type="button" className="ws-card__hit" onClick={() => onOpen(item.id)} aria-label={`查看「${item.title}」详情`} />
      <div className={`ws-card__cover${cover ? '' : ' is-glyph'}`} aria-hidden="true">
        {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon size={30} />}
        {item.featured && <span className="ws-card__ribbon"><Sparkles size={11} />精选</span>}
      </div>
      <div className="ws-card__body">
        <div className="ws-card__kicker">
          <span className="ws-type"><Icon size={12} aria-hidden="true" />{meta.label}</span>
          {showStatus && item.status !== 'published' && <span className={`ws-status is-${item.status}`}>{WORKSHOP_STATUS_LABELS[item.status]}</span>}
          {!showStatus && installed && (
            <span className={`ws-installed${update ? ' has-update' : ''}`}>
              <CheckCircle2 size={11} aria-hidden="true" />{update ? `可更新到 v${installed.latestVersion}` : `已安装 v${installed.record.version}`}
            </span>
          )}
        </div>
        <strong className="ws-card__title">{item.title}</strong>
        <small className="ws-card__byline">{item.author.name} · v{item.version} · {formatDate(item.updatedAt)}</small>
        {item.description && <p className="ws-card__desc">{item.description}</p>}
        {item.tags.length > 0 && <div className="registry-workshop-tags">{item.tags.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div>}
        <div className="ws-card__stats">
          <Stars value={item.ratingAverage} count={item.ratingCount} size={12} />
          <span title="下载次数"><Download size={12} aria-hidden="true" />{formatCount(item.downloadCount)}</span>
          <span title="收藏人数"><Heart size={12} aria-hidden="true" />{formatCount(item.favoriteCount)}</span>
        </div>
      </div>
    </article>
  );
}
