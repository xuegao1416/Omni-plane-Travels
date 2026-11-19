/**
 * 创意工坊（旅者登记所的一个分区）：发现、已安装、我的发布、收藏，管理员另有举报处理。
 * 流程与数据见 src/workshop/（api / service / installers / publish）。
 */
import { useEffect, useState } from 'react';
import { Compass, Heart, PackageCheck, RefreshCw, ShieldAlert, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWorkshopStore } from '../../stores/workshopStore';
import WorkshopBrowse from '../workshop/WorkshopBrowse';
import WorkshopInstalled from '../workshop/WorkshopInstalled';
import WorkshopMine from '../workshop/WorkshopMine';
import WorkshopFavorites from '../workshop/WorkshopFavorites';
import WorkshopAdmin from '../workshop/WorkshopAdmin';
import WorkshopDetail from '../workshop/WorkshopDetail';
import '../../ui/screens/workshop.css';

export type WorkshopSection = 'browse' | 'installed' | 'mine' | 'favorites' | 'admin';
type Section = WorkshopSection;

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'browse', label: '发现', icon: Compass },
  { id: 'installed', label: '已安装', icon: PackageCheck },
  { id: 'mine', label: '我的发布', icon: Upload },
  { id: 'favorites', label: '收藏', icon: Heart },
  { id: 'admin', label: '举报处理', icon: ShieldAlert },
];

interface Props {
  initialSection?: WorkshopSection;
  /** 打开时直接显示某个作品的详情。 */
  initialDetailId?: string;
}

export default function WorkshopSettingsTab({ initialSection = 'browse', initialDetailId }: Props = {}) {
  const user = useAuthStore(state => state.user);
  const { installed, refreshInstalled, setQuery, loading } = useWorkshopStore();
  const [section, setSection] = useState<Section>(initialSection);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(initialDetailId ?? null);
  const updates = installed.filter(entry => entry.hasUpdate).length;
  const sections = SECTIONS.filter(entry => entry.id !== 'admin' || user?.workshopAdmin);

  // 已安装列表决定卡片上的“已安装 / 可更新”标记，进入工坊时先读一次。
  useEffect(() => { void refreshInstalled(); }, [refreshInstalled]);

  // 各分区挂载时自己加载数据，刷新即重新挂载当前分区。
  const refresh = () => setReloadKey(key => key + 1);

  return (
    <div className="registry-settings-page registry-workshop-page ws-page">
      <div className="registry-settings-title-row">
        <h3>创意工坊</h3>
        <div className="registry-title-actions">
          <button type="button" className="pk-btn pk-btn--secondary pk-btn--sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />刷新
          </button>
        </div>
      </div>

      <nav className="ws-sections" role="tablist" aria-label="创意工坊分区">
        {sections.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => setSection(id)}>
            <Icon size={15} aria-hidden="true" />{label}
            {id === 'installed' && updates > 0 && <span className="ws-badge" aria-label={`${updates} 个可更新`}>{updates}</span>}
          </button>
        ))}
      </nav>

      <div role="tabpanel" className="ws-panel" key={`${section}-${reloadKey}`}>
        {section === 'browse' && <WorkshopBrowse onOpen={setDetailId} />}
        {section === 'installed' && <WorkshopInstalled onOpen={setDetailId} />}
        {section === 'mine' && <WorkshopMine onOpen={setDetailId} />}
        {section === 'favorites' && <WorkshopFavorites onOpen={setDetailId} />}
        {section === 'admin' && user?.workshopAdmin && <WorkshopAdmin onOpen={setDetailId} />}
      </div>

      {detailId && (
        <WorkshopDetail
          itemId={detailId}
          onClose={() => setDetailId(null)}
          onOpen={setDetailId}
          onFilterAuthor={(author) => {
            setDetailId(null);
            setSection('browse');
            void setQuery({ author: author.id, authorName: author.name });
          }}
        />
      )}
    </div>
  );
}
