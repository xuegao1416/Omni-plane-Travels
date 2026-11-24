/**
 * 右栏的小地图卡：当前位置附近的缩略地图，点击打开地图卷宗。
 */
import { Map as MapIcon } from 'lucide-react';
import type { MapViewModel } from '../../../../domains/map/viewModel';
import { LOCATION_KIND_LABELS } from '../../../../domains/map/types';
import Map2D from '../../../map/Map2D';

export default function MapCard({ view, onOpen }: { view: MapViewModel; onOpen?: () => void }) {
  const current = view.current;
  return (
    <div className="surface-card game-journey__status-card map-card" role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(); } }} aria-label="打开地图">
      <h4><MapIcon size={13} aria-hidden="true" style={{ marginRight: 4, verticalAlign: -2 }} />{view.title}</h4>
      <div className="map-card__stage"><Map2D view={view} compact focusId={current?.location.id} /></div>
      {current && (
        <div className="map-card__place"><b>{current.location.name}</b><span>{LOCATION_KIND_LABELS[current.location.kind]}{current.region ? ` · ${current.region.name}` : ''}</span></div>
      )}
      <div className="map-card__meta">已知 {view.stats.known}/{view.stats.total} 处 · 到过 {view.stats.visited} 处</div>
    </div>
  );
}
