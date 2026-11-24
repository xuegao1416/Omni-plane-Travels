/**
 * 地图视图：2D / 3D 切换、缩放与定位按钮、全屏、图例、3D 下的地区飞行。
 * 游戏内卷宗、编辑器与世界档案共用。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Layers, LocateFixed, Map as MapIcon, Maximize2, Minimize2, Minus, Plus, Scan } from 'lucide-react';
import type { MapTheme } from '../../domains/map/types';
import { THEME_LABELS, routeKindLabel } from '../../domains/map/types';
import type { MapViewModel } from '../../domains/map/viewModel';
import Map2D, { type Map2DHandle, type MapEditHandlers } from './Map2D';
import Map3D, { type Map3DHandle } from './Map3D';
import '../../ui/screens/map.css';

export type MapCanvasMode = '2d' | '3d';
const MODE_KEY = 'omni.map.view.v1';

function storedMode(): MapCanvasMode {
  try { return localStorage.getItem(MODE_KEY) === '3d' ? '3d' : '2d'; } catch { return '2d'; }
}

interface MapViewProps {
  view: MapViewModel;
  theme?: MapTheme;
  initialMode?: MapCanvasMode;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  plan?: string[];
  edit?: MapEditHandlers;
  /** 工具栏右侧追加的内容（编辑器的画风切换等）。 */
  toolbar?: ReactNode;
  className?: string;
  /** 打开时把视野对准当前位置。 */
  focusCurrent?: boolean;
  allowFullscreen?: boolean;
}

export default function MapView({ view, theme: themeOverride, initialMode, selectedId, onSelect, plan, edit, toolbar, className, focusCurrent = true, allowFullscreen = true }: MapViewProps) {
  const theme = themeOverride ?? view.theme;
  const [mode, setMode] = useState<MapCanvasMode>(() => initialMode ?? storedMode());
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [legend, setLegend] = useState(false);
  const map2d = useRef<Map2DHandle>(null);
  const map3d = useRef<Map3DHandle>(null);
  // 编辑工具（添加、连路、放地区）只在 2D 画布上可用：选中它们时自动回到 2D。
  const editing = Boolean(edit) && edit?.tool !== 'select';
  const active = mode === '3d' && !unavailable && !editing ? '3d' : '2d';

  const choose = (next: MapCanvasMode) => {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* 存不下就只在本次生效 */ }
  };

  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  const zoom = (factor: number) => (active === '3d' ? map3d.current?.zoomBy(factor) : map2d.current?.zoomBy(factor));
  const locate = () => {
    const id = view.current?.location.id ?? selectedId;
    if (!id) { reset(); return; }
    if (active === '3d') map3d.current?.focus(id); else map2d.current?.focus(id);
  };
  const reset = () => (active === '3d' ? map3d.current?.reset() : map2d.current?.reset());
  const routeKinds = [...new Set(view.routes.filter(item => item.known).map(item => item.route.kind))];

  return (
    <div className={`map-view map-view--${theme}${expanded ? ' is-expanded' : ''}${className ? ` ${className}` : ''}`}>
      <div className="map-view__stage">
        {active === '3d'
          ? <Map3D ref={map3d} view={view} theme={theme} selectedId={selectedId} onSelect={onSelect} plan={plan} onUnavailable={() => setUnavailable(true)} />
          : <Map2D ref={map2d} view={view} theme={theme} selectedId={selectedId} onSelect={onSelect} plan={plan} edit={edit} focusId={focusCurrent ? view.current?.location.id : undefined} />}
      </div>

      <div className="map-view__bar map-view__bar--top" role="toolbar" aria-label="地图视图">
        <div className="map-view__segment" role="radiogroup" aria-label="2D / 3D">
          <button type="button" role="radio" aria-checked={active === '2d'} className={active === '2d' ? 'is-active' : ''} onClick={() => choose('2d')}><MapIcon size={14} aria-hidden="true" />2D</button>
          <button type="button" role="radio" aria-checked={active === '3d'} className={active === '3d' ? 'is-active' : ''} onClick={() => { setUnavailable(false); choose('3d'); }} disabled={editing} title={editing ? '编辑工具只在 2D 下可用' : undefined}>
            <Box size={14} aria-hidden="true" />3D
          </button>
        </div>
        <span className="map-view__theme">{THEME_LABELS[theme]}</span>
        {unavailable && mode === '3d' && <span className="map-view__notice" role="status">此设备无法显示 3D，已改用 2D</span>}
        <span className="map-view__spacer" />
        {toolbar}
      </div>

      <div className="map-view__bar map-view__bar--side" role="toolbar" aria-label="缩放与定位">
        <button type="button" onClick={() => zoom(1.4)} aria-label="放大" title="放大"><Plus size={16} /></button>
        <button type="button" onClick={() => zoom(1 / 1.4)} aria-label="缩小" title="缩小"><Minus size={16} /></button>
        <button type="button" onClick={locate} aria-label="回到当前位置" title="回到当前位置"><LocateFixed size={16} /></button>
        <button type="button" onClick={reset} aria-label="查看全图" title="查看全图"><Scan size={16} /></button>
        <button type="button" onClick={() => setLegend(value => !value)} aria-pressed={legend} aria-label="图例" title="图例"><Layers size={16} /></button>
        {allowFullscreen && (
          <button type="button" onClick={() => setExpanded(value => !value)} aria-pressed={expanded} aria-label={expanded ? '退出全屏' : '全屏'} title={expanded ? '退出全屏（Esc）' : '全屏'}>
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
      </div>

      {active === '3d' && view.regions.some(item => item.known) && (
        <div className="map-view__regions" role="group" aria-label="飞到地区">
          {view.regions.filter(item => item.known && item.region.terrain !== 'sea').slice(0, 8).map(({ region, accent }) => (
            <button type="button" key={region.id} onClick={() => map3d.current?.focusRegion(region.id)} style={{ '--map-accent': accent } as React.CSSProperties}>{region.name}</button>
          ))}
        </div>
      )}

      {legend && (
        <div className="map-view__legend" role="dialog" aria-label="图例">
          <strong>图例</strong>
          <ul>
            <li><i className="map-legend-dot is-current" />当前位置</li>
            <li><i className="map-legend-dot is-visited" />到过的地方</li>
            {view.mode === 'play' && view.config.fog !== false && <li><i className="map-legend-dot is-fog" />未探明的区域</li>}
            {routeKinds.map(kind => <li key={kind}><i className={`map-legend-line is-${kind}`} />{routeKindLabel(kind, theme)}</li>)}
            <li><i className="map-legend-line is-danger" />危险路段（3 级以上）</li>
          </ul>
          <small>{view.stats.known}/{view.stats.total} 处已知 · 到过 {view.stats.visited} 处</small>
        </div>
      )}
    </div>
  );
}
