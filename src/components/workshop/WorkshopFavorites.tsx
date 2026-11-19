import { useEffect, useMemo } from 'react';
import { Heart } from 'lucide-react';
import { useWorkshopStore } from '../../stores/workshopStore';
import WorkshopCard from './WorkshopCard';
import { EmptyState, FeedbackNotice, Spinner } from './shared';

/** 收藏：只列出仍可安装的作品。 */
export default function WorkshopFavorites({ onOpen }: { onOpen: (id: string) => void }) {
  const { favorites, favoritesLoading, favoritesError, fetchFavorites, installed } = useWorkshopStore();
  useEffect(() => { void fetchFavorites(); }, [fetchFavorites]);
  const installedById = useMemo(() => new Map(installed.map(entry => [entry.record.itemId, entry])), [installed]);

  return (
    <section className="ws-section" aria-label="收藏">
      {favoritesError && <FeedbackNotice feedback={{ tone: 'error', message: favoritesError }} onDismiss={() => void fetchFavorites()} />}
      {favoritesLoading && favorites.length === 0 && <Spinner />}
      {!favoritesLoading && !favoritesError && favorites.length === 0 && (
        <EmptyState icon={Heart} title="还没有收藏的作品"><small>在作品详情里点“收藏”，之后可以在这里找到它。</small></EmptyState>
      )}
      {favorites.length > 0 && (
        <div className="ws-grid">
          {favorites.map(item => <WorkshopCard key={item.id} item={item} installed={installedById.get(item.id)} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}
