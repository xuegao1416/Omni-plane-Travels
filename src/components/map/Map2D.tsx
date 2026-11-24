/**
 * 2D 地图：地形底图 + 矢量层 + 地点与路线，三种画风（古卷 / 测绘 / 星图）。
 * 支持拖拽平移、滚轮与双指缩放、点击选中；编辑模式下可拖动地点与地区、点击添加、连线。
 */
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { sampleTerrainGrid, type TerrainGrid } from '../../domains/map/terrain';
import type { MapLocation, MapRoute, MapTheme } from '../../domains/map/types';
import type { MapLocationView, MapViewModel } from '../../domains/map/viewModel';
import { paintTerrain } from './map2d/raster';
import { buildMapGeometry, type MapGeometry } from './map2d/geometry';
import { AncientPlace, AncientTerrainGlyph, INK, ModernPlace, PAPER, ScifiPlace, SelectionMark, VERMILION, isSettlement } from './map2d/glyphs';
import { Cartouche, Compass, Frame, MapDefs, ScaleBar } from './map2d/decor';
import { FeatureLabels, FeatureShapes } from './map2d/features';
import { hasFeatures, paintsFlat, pointAlong, routeLine, smoothLine } from '../../domains/map/features';

export type MapEditTool = 'select' | 'add' | 'connect' | 'region';

export interface MapEditHandlers {
  tool: MapEditTool;
  onMoveLocation?: (id: string, x: number, y: number) => void;
  onMoveRegion?: (id: string, x: number, y: number) => void;
  onResizeRegion?: (id: string, radius: number) => void;
  onAddLocation?: (x: number, y: number) => void;
  onAddRegion?: (x: number, y: number) => void;
  onConnect?: (from: string, to: string) => void;
  selectedRegionId?: string | null;
  onSelectRegion?: (id: string | null) => void;
  selectedRouteId?: string | null;
  onSelectRoute?: (id: string | null) => void;
}

export interface Map2DHandle {
  zoomBy(factor: number): void;
  reset(): void;
  focus(locationId: string, zoom?: number): void;
}

interface Map2DProps {
  view: MapViewModel;
  theme?: MapTheme;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** 规划中的路线（地点 id 序列）。 */
  plan?: string[];
  compact?: boolean;
  edit?: MapEditHandlers;
  /** 开局把视野对准这个地点。 */
  focusId?: string;
  className?: string;
}

interface ViewState { k: number; tx: number; ty: number }

const GRID_FULL: [number, number] = [361, 253];
const GRID_COMPACT: [number, number] = [201, 141];

function routeKey(route: MapRoute): number {
  let hash = 0;
  for (let index = 0; index < route.id.length; index++) hash = (hash * 31 + route.id.charCodeAt(index)) | 0;
  return hash;
}

const STRAIGHT = new Set<MapRoute['kind']>(['rail', 'highway', 'warp']);

/** 路线曲线：有途经点时沿途经点平滑连线；否则是两端点间的二次贝塞尔，偏移量按路线 id 决定（每次都一样）。 */
function routePath(route: MapRoute, a: MapLocation, b: MapLocation): { d: string; mx: number; my: number } {
  const line = routeLine(route, a, b);
  if (line) {
    const smooth = smoothLine(line, 3);
    const mid = pointAlong(smooth, 0.5);
    return { d: `M${smooth.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}`, mx: mid.x, my: mid.y };
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const sign = routeKey(route) & 1 ? 1 : -1;
  const bend = route.kind === 'sea' ? 0.2 : route.kind === 'air' ? 0.24 : STRAIGHT.has(route.kind) ? 0.03 : 0.09;
  const cx = (a.x + b.x) / 2 - (dy / length) * length * bend * sign;
  const cy = (a.y + b.y) / 2 + (dx / length) * length * bend * sign;
  return { d: `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`, mx: (a.x + 2 * cx + b.x) / 4, my: (a.y + 2 * cy + b.y) / 4 };
}

interface RouteStyle { stroke: string; width: number; dash?: string; casing?: { stroke: string; width: number }; opacity?: number; cap?: 'round' | 'butt'; flow?: boolean }

function routeStyle(theme: MapTheme, route: MapRoute, authored = false): RouteStyle {
  const danger = route.danger ?? 0;
  // 网页地图风格：街道、铁路已经画成要素，路线只用细虚线标出「能走的连接」，走过、规划时再高亮。
  if (theme === 'modern' && authored) {
    const color = route.kind === 'secret' ? '#d64a3e' : route.kind === 'sea' || route.kind === 'river' ? '#2f83d9' : route.kind === 'trail' || route.kind === 'mountain' ? '#8f7c63' : '#5f7590';
    return { stroke: color, width: 1.25, dash: route.kind === 'trail' || route.kind === 'mountain' || route.kind === 'secret' ? '1.6 2.2' : '4 2.6', cap: 'round', opacity: 0.85 };
  }
  if (theme === 'ancient') {
    switch (route.kind) {
      case 'trail': return { stroke: INK, width: 1.1, dash: '0.2 3', cap: 'round', opacity: 0.85 };
      case 'mountain': return { stroke: INK, width: 1.15, dash: '5 2 1.2 2', opacity: 0.85 };
      case 'river': return { stroke: '#355f6c', width: 1.4, dash: '7 3', opacity: 0.9 };
      case 'sea': return { stroke: '#355f6c', width: 1.3, dash: '0.2 4.2', cap: 'round', opacity: 0.9 };
      case 'secret': return { stroke: VERMILION, width: 1.1, dash: '2 3', opacity: 0.85 };
      case 'air': case 'warp': return { stroke: '#5a3f7a', width: 1.1, dash: '4 4', opacity: 0.8 };
      default: return { stroke: INK, width: 1.45, dash: danger >= 3 ? '4 2.6' : '6 3', opacity: 0.88 };
    }
  }
  if (theme === 'modern') {
    switch (route.kind) {
      case 'highway': return { stroke: '#f7c65a', width: 3.4, casing: { stroke: '#d39a2b', width: 5.4 }, cap: 'round' };
      case 'rail': return { stroke: '#ffffff', width: 1.4, dash: '4 4', casing: { stroke: '#6d7884', width: 3.2 } };
      case 'trail': return { stroke: '#8c7b6a', width: 1.3, dash: '3 2.4', cap: 'round' };
      case 'mountain': return { stroke: '#a08a6e', width: 1.4, dash: '2 2' };
      case 'river': return { stroke: '#6fb3e6', width: 2.2, cap: 'round' };
      case 'sea': return { stroke: '#2f83d9', width: 1.5, dash: '4 3.5', cap: 'round' };
      case 'air': case 'warp': return { stroke: '#8e5bd6', width: 1.4, dash: '6 4', cap: 'round' };
      case 'secret': return { stroke: '#d64a3e', width: 1.4, dash: '2 3', cap: 'round' };
      default: return { stroke: '#ffffff', width: 2.6, casing: { stroke: danger >= 2 ? '#e0a49c' : '#c5bfb2', width: 4.2 }, cap: 'round' };
    }
  }
  const color = danger >= 3 ? '#ff6b7a' : route.kind === 'secret' ? '#ff5cdc' : route.kind === 'air' ? '#8aff6b' : route.kind === 'warp' ? '#3ee8ff' : '#7fd8ff';
  return { stroke: color, width: route.kind === 'warp' ? 1.3 : 1.1, dash: route.kind === 'air' ? '2 4' : '7 9', flow: true, opacity: 0.9 };
}

const TERRAIN_LABEL_CLASS: Record<MapTheme, string> = { ancient: 'map2d-region map2d-region--ancient', modern: 'map2d-region map2d-region--modern', scifi: 'map2d-region map2d-region--scifi' };

/** 静态层（地形与地貌）：只随地图与画风变化，平移缩放不重绘。 */
const TerrainLayers = memo(function TerrainLayers({ id, theme, view, grid, geometry, raster }: { id: string; theme: MapTheme; view: MapViewModel; grid: TerrainGrid; geometry: MapGeometry; raster: string }) {
  const { width, height } = view.config;
  const space = grid.space;
  return (
    <g className="map2d-terrain">
      <clipPath id={`${id}-sheetclip`}><rect x={0} y={0} width={width} height={height} /></clipPath>
      <rect x={0} y={0} width={width} height={height} className="map2d-sheet" filter={theme === 'scifi' ? undefined : `url(#${id}-sheet)`} />
      <g clipPath={`url(#${id}-sheetclip)`}>
      {raster && <image href={raster} x={0} y={0} width={width} height={height} preserveAspectRatio="none" />}
      {theme === 'ancient' && geometry.ripples.map((ripple, index) => <path key={`r${index}`} d={ripple.d} className="map2d-ripple" opacity={ripple.opacity} />)}
      <FeatureShapes id={id} theme={theme} config={view.config} />
      {theme === 'modern' && geometry.urban.map((d, index) => (
        <g key={`u${index}`}>
          <clipPath id={`${id}-urban-${index}`}><path d={d} /></clipPath>
          <rect x={0} y={0} width={width} height={height} fill={`url(#${id}-streets-${index % 3})`} clipPath={`url(#${id}-urban-${index})`} opacity={0.62} />
        </g>
      ))}
      {theme === 'scifi' && !space && <rect x={0} y={0} width={width} height={height} fill={`url(#${id}-hex)`} />}
      {theme === 'scifi' && geometry.urban.map((d, index) => <path key={`u${index}`} d={d} className="map2d-urban-glow" />)}
      {geometry.contours.map((contour, index) => <path key={`c${index}`} d={contour.d} className={`map2d-contour${contour.level >= 0.5 ? ' is-major' : ''}`} />)}
      {theme === 'ancient' && geometry.coast.map((d, index) => <path key={`cb${index}`} d={d} className="map2d-coast-back" />)}
      {geometry.coast.map((d, index) => <path key={`co${index}`} d={d} className="map2d-coast" />)}
      {geometry.rivers.map((river, index) => <path key={`rv${index}`} d={river.d} className="map2d-river" strokeWidth={river.width * (theme === 'modern' ? 1.4 : 1)} />)}
      {geometry.borders.map((d, index) => <path key={`b${index}`} d={d} className="map2d-border" />)}
      {theme === 'ancient' && <g className="map2d-glyphs">{geometry.glyphs.map((glyph, index) => <AncientTerrainGlyph key={index} glyph={glyph} />)}</g>}
      {theme === 'modern' && <g className="map2d-glyphs">{geometry.glyphs.map((glyph, index) => <circle key={index} cx={glyph.x} cy={glyph.y} r={glyph.size} className="map2d-park" />)}</g>}
      {theme === 'scifi' && <g className="map2d-glyphs">{geometry.glyphs.map((glyph, index) => {
        const s = glyph.size;
        const jag = (glyph.variant % 3) * 0.12;
        return (
          <path key={index} transform={`translate(${glyph.x.toFixed(1)},${glyph.y.toFixed(1)}) rotate(${glyph.variant * 41})`}
            d={`M${-s},${s * 0.1} L${-s * (0.45 + jag)},${-s * 0.8} L${s * 0.35},${-s * (0.9 - jag)} L${s},${-s * 0.15} L${s * (0.6 + jag)},${s * 0.75} L${-s * 0.3},${s * 0.85} Z`}
            className={`map2d-asteroid${s > 2.6 ? ' is-large' : ''}`} />
        );
      })}</g>}
      {space && view.regions.map(({ region, accent }) => region.terrain === 'void'
        ? <circle key={region.id} cx={region.x} cy={region.y} r={region.radius * 0.8} fill="none" stroke={accent} strokeOpacity={0.35} strokeWidth={0.8} strokeDasharray="3 6" />
        : null)}
      </g>
    </g>
  );
});

function labelFont(theme: MapTheme, kind: MapLocation['kind']): number {
  const base = theme === 'scifi' ? 10 : 11;
  if (kind === 'capital') return base + 4.5;
  if (kind === 'city') return base + 2;
  if (isSettlement(kind)) return base;
  return base - 0.5;
}

function importance(view: MapLocationView): number {
  const kind = view.location.kind;
  const base = kind === 'capital' ? 6 : kind === 'city' ? 5 : kind === 'town' || kind === 'port' ? 4 : kind === 'village' || kind === 'home' ? 2.5 : 3;
  return base + (view.status === 'current' ? 10 : 0) + (view.quests.length ? 2 : 0);
}

interface PlacedLabel { id: string; x: number; y: number; anchor: 'start' | 'end' | 'middle'; size: number; text: string; emphasis: boolean }

/** 地名摆放：依次试右、左、下、上，避开已放的地名与符号；放不下的次要地名先隐藏。 */
function placeLabels(locations: MapLocationView[], theme: MapTheme, markerScale: number, labelScale: number, forced: Set<string>, compact: boolean): PlacedLabel[] {
  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const out: PlacedLabel[] = [];
  const glyphHalf = (theme === 'ancient' ? 12 : 8) * markerScale;
  for (const view of locations) {
    const { x, y } = view.location;
    placed.push({ x0: x - glyphHalf, y0: y - glyphHalf * 1.6, x1: x + glyphHalf, y1: y + glyphHalf * 0.5 });
  }
  const sorted = [...locations].sort((a, b) => importance(b) - importance(a));
  for (const view of sorted) {
    const { location } = view;
    const emphasis = view.status === 'current' || forced.has(location.id);
    if (compact && !emphasis && location.kind !== 'capital' && location.kind !== 'city') continue;
    const size = labelFont(theme, location.kind) * labelScale;
    const width = location.name.length * size * 1.04 + size * 0.4;
    const height = size * 1.15;
    const gap = glyphHalf + size * 0.35;
    const lift = theme === 'ancient' ? -glyphHalf * 0.5 : theme === 'modern' && !isSettlement(location.kind) ? -glyphHalf * 1.1 : 0;
    const candidates: Array<{ x: number; y: number; anchor: PlacedLabel['anchor']; box: [number, number, number, number] }> = [
      { x: location.x + gap, y: location.y + lift + size * 0.36, anchor: 'start', box: [location.x + gap, location.y + lift - height / 2, location.x + gap + width, location.y + lift + height / 2] },
      { x: location.x - gap, y: location.y + lift + size * 0.36, anchor: 'end', box: [location.x - gap - width, location.y + lift - height / 2, location.x - gap, location.y + lift + height / 2] },
      { x: location.x, y: location.y + glyphHalf * 0.6 + size, anchor: 'middle', box: [location.x - width / 2, location.y + glyphHalf * 0.6, location.x + width / 2, location.y + glyphHalf * 0.6 + height] },
      { x: location.x, y: location.y - glyphHalf * 2 - size * 0.2, anchor: 'middle', box: [location.x - width / 2, location.y - glyphHalf * 2 - height, location.x + width / 2, location.y - glyphHalf * 2] },
    ];
    const free = candidates.find(candidate => !placed.some(box => !(candidate.box[2] < box.x0 || candidate.box[0] > box.x1 || candidate.box[3] < box.y0 || candidate.box[1] > box.y1)));
    const chosen = free ?? (emphasis || location.kind === 'capital' ? candidates[0] : undefined);
    if (!chosen) continue;
    placed.push({ x0: chosen.box[0], y0: chosen.box[1], x1: chosen.box[2], y1: chosen.box[3] });
    out.push({ id: location.id, x: chosen.x, y: chosen.y, anchor: chosen.anchor, size, text: location.name, emphasis });
  }
  return out;
}

function CurrentMarker({ theme, scale }: { theme: MapTheme; scale: number }) {
  if (theme === 'ancient') {
    return (
      <g transform={`scale(${scale})`} className="map2d-current map2d-current--ancient">
        <circle r={16} className="map2d-pulse" />
        <circle r={9.5} fill="none" stroke={VERMILION} strokeWidth={1.1} strokeDasharray="2 2.2" />
        <path d="M0,-30 C-6,-30 -9,-25.5 -9,-21.5 C-9,-15.5 0,-8.5 0,-8.5 C0,-8.5 9,-15.5 9,-21.5 C9,-25.5 6,-30 0,-30 Z" fill={VERMILION} stroke={INK} strokeWidth={0.8} />
        <text y={-18.4} textAnchor="middle" className="map2d-seal-text">此</text>
      </g>
    );
  }
  if (theme === 'modern') {
    return (
      <g transform={`scale(${scale})`} className="map2d-current map2d-current--modern">
        <circle r={17} className="map2d-pulse" />
        <circle r={12} fill="rgba(26,115,232,.16)" />
        <circle r={6.4} fill="#1a73e8" stroke="#ffffff" strokeWidth={2.6} filter="drop-shadow(0 1px 2px rgba(0,0,0,.3))" />
      </g>
    );
  }
  return (
    <g transform={`scale(${scale})`} className="map2d-current map2d-current--scifi">
      <circle r={18} className="map2d-pulse" />
      <circle r={13} fill="none" stroke="#ff5cdc" strokeWidth={1.2} />
      <g className="map2d-spin"><circle r={17} fill="none" stroke="#ff5cdc" strokeWidth={0.9} strokeDasharray="4 6" /></g>
      {[0, 90, 180, 270].map(angle => <line key={angle} x1={0} y1={-20} x2={0} y2={-15} stroke="#ff5cdc" strokeWidth={1.4} transform={`rotate(${angle})`} />)}
    </g>
  );
}

const Map2D = forwardRef<Map2DHandle, Map2DProps>(function Map2D({ view, theme: themeOverride, selectedId, onSelect, plan, compact = false, edit, focusId, className }, ref) {
  const theme = themeOverride ?? view.theme;
  const config = view.config;
  const hostRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const idRef = useRef(`map2d-${Math.random().toString(36).slice(2, 8)}`);
  const id = idRef.current;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const viewRef = useRef<ViewState>({ k: 1, tx: 0, ty: 0 });
  const fitRef = useRef(1);
  const [grid, setGrid] = useState<TerrainGrid | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  // 地形网格放到首帧之后再算，打开面板不卡顿。
  useEffect(() => {
    let alive = true;
    const [cols, rows] = compact ? GRID_COMPACT : GRID_FULL;
    const handle = window.setTimeout(() => { if (alive) setGrid(sampleTerrainGrid(config, cols, rows)); }, 16);
    return () => { alive = false; window.clearTimeout(handle); };
  }, [config, compact]);

  const visible = useMemo(() => view.locations.filter(item => item.status !== 'unknown'), [view.locations]);
  const byId = useMemo(() => new Map(view.locations.map(item => [item.location.id, item] as const)), [view.locations]);
  const knownRoutes = useMemo(() => view.routes.filter(item => item.known && byId.get(item.route.from)?.status !== 'unknown' && byId.get(item.route.to)?.status !== 'unknown'), [view.routes, byId]);
  const routeSegments = useMemo(() => knownRoutes.flatMap(({ route }) => {
    const a = byId.get(route.from)!.location;
    const b = byId.get(route.to)!.location;
    const line = routeLine(route, a, b);
    if (!line) return [{ ax: a.x, ay: a.y, bx: b.x, by: b.y }];
    return line.slice(1).map((point, index) => ({ ax: line[index]![0], ay: line[index]![1], bx: point[0], by: point[1] }));
  }), [knownRoutes, byId]);
  const geometry = useMemo(() => grid ? buildMapGeometry(config, grid, theme, view.locations.map(item => item.location), view.mode === 'atlas' ? routeSegments : routeSegments) : null, [grid, config, theme, view.locations, view.mode, routeSegments]);
  const raster = useMemo(() => grid ? paintTerrain({
    config, grid, theme, regionColors: view.regions.map(item => item.accent),
    key: `${config.seed}|${theme}|${grid.cols}|${JSON.stringify(config.regions)}|${config.locations.map(item => `${item.x},${item.y},${item.kind}`).join(';')}|${config.landform}|${config.features?.length ?? 0}`,
    flat: paintsFlat(config, theme),
  }) : '', [grid, config, theme, view.regions]);

  const apply = useCallback(() => {
    const { k, tx, ty } = viewRef.current;
    groupRef.current?.setAttribute('transform', `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${k.toFixed(4)})`);
  }, []);

  const clamp = useCallback((state: ViewState): ViewState => {
    if (!size) return state;
    const fit = fitRef.current;
    const k = Math.min(fit * 7, Math.max(fit * 0.8, state.k));
    const w = config.width * k;
    const h = config.height * k;
    const marginX = Math.min(size.width * 0.45, w * 0.5);
    const marginY = Math.min(size.height * 0.45, h * 0.5);
    const tx = Math.min(size.width - marginX, Math.max(marginX - w, state.tx));
    const ty = Math.min(size.height - marginY, Math.max(marginY - h, state.ty));
    return { k, tx, ty };
  }, [size, config.width, config.height]);

  const commit = useCallback((next: ViewState) => {
    viewRef.current = clamp(next);
    apply();
    const fit = fitRef.current || 1;
    setZoom(Math.round((viewRef.current.k / fit) * 100) / 100);
  }, [apply, clamp]);

  const fitView = useCallback((target?: { x: number; y: number }, factor = 1, cover = false) => {
    if (!size) return;
    const pad = compact ? 0.98 : 0.94;
    const fit = Math.min(size.width / config.width, size.height / config.height) * pad;
    fitRef.current = fit;
    // cover：铺满画布（游戏内对准当前位置时用），否则整张图放得下。
    const k = (cover ? Math.max(size.width / config.width, size.height / config.height) : fit) * factor;
    const cx = target?.x ?? config.width / 2;
    const cy = target?.y ?? config.height / 2;
    commit({ k, tx: size.width / 2 - cx * k, ty: size.height / 2 - cy * k });
  }, [size, config.width, config.height, compact, commit]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize(previous => previous && Math.abs(previous.width - rect.width) < 1 && Math.abs(previous.height - rect.height) < 1 ? previous : { width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const focusTarget = focusId ? byId.get(focusId)?.location : undefined;
  useEffect(() => {
    if (!size) return;
    if (focusTarget && compact) fitView(focusTarget, 2.1);
    else if (focusTarget) fitView({ x: focusTarget.x * 0.6 + config.width * 0.2, y: focusTarget.y * 0.6 + config.height * 0.2 }, 1.08, true);
    else fitView();
    // 只在尺寸或地图变化时重新取景。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, compact ? focusTarget?.id : undefined]);

  useImperativeHandle(ref, () => ({
    zoomBy: factor => {
      if (!size) return;
      const { k, tx, ty } = viewRef.current;
      const cx = size.width / 2;
      const cy = size.height / 2;
      const next = k * factor;
      commit({ k: next, tx: cx - ((cx - tx) / k) * next, ty: cy - ((cy - ty) / k) * next });
    },
    reset: () => fitView(),
    focus: (locationId, factor = 2.2) => {
      const target = byId.get(locationId)?.location;
      if (target) fitView(target, factor);
    },
  }), [size, commit, fitView, byId]);

  // ── Pointer gestures ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'pinch' | 'location' | 'region' | 'radius'; id?: string; startX: number; startY: number; view: ViewState; distance?: number; moved: boolean } | null>(null);
  const frame = useRef(0);

  const toMap = useCallback((clientX: number, clientY: number) => {
    const rect = hostRef.current!.getBoundingClientRect();
    const { k, tx, ty } = viewRef.current;
    return { x: (clientX - rect.left - tx) / k, y: (clientY - rect.top - ty) / k };
  }, []);

  const onWheel = useCallback((event: WheelEvent) => {
    if (compact) return;
    event.preventDefault();
    const rect = hostRef.current!.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const { k, tx, ty } = viewRef.current;
    const next = k * Math.exp(-event.deltaY * 0.0016);
    commit({ k: next, tx: px - ((px - tx) / k) * next, ty: py - ((py - ty) / k) * next });
  }, [compact, commit]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const beginGesture = (event: ReactPointerEvent, kind: 'pan' | 'location' | 'region' | 'radius', targetId?: string) => {
    if (compact && kind === 'pan') return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && !compact) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', startX: (a!.x + b!.x) / 2, startY: (a!.y + b!.y) / 2, view: { ...viewRef.current }, distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), moved: true };
      return;
    }
    gesture.current = { kind, ...(targetId ? { id: targetId } : {}), startX: event.clientX, startY: event.clientY, view: { ...viewRef.current }, moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    if (current.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const rect = hostRef.current!.getBoundingClientRect();
      const cx = (a!.x + b!.x) / 2 - rect.left;
      const cy = (a!.y + b!.y) / 2 - rect.top;
      const next = current.view.k * (distance / (current.distance || distance));
      const sx = current.startX - rect.left;
      const sy = current.startY - rect.top;
      commit({ k: next, tx: cx - ((sx - current.view.tx) / current.view.k) * next, ty: cy - ((sy - current.view.ty) / current.view.k) * next });
      return;
    }
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 4) return;
    if (!current.moved) { current.moved = true; setMoving(true); }
    // 非编辑模式下按住地点拖动等于平移地图。
    if (current.kind !== 'pan' && (!edit || edit.tool !== 'select')) current.kind = 'pan';
    if (current.kind === 'pan') {
      viewRef.current = clamp({ ...current.view, tx: current.view.tx + dx, ty: current.view.ty + dy });
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(apply);
      return;
    }
    const point = toMap(event.clientX, event.clientY);
    const x = Math.round(Math.min(config.width, Math.max(0, point.x)));
    const y = Math.round(Math.min(config.height, Math.max(0, point.y)));
    if (current.kind === 'location' && current.id) edit?.onMoveLocation?.(current.id, x, y);
    else if (current.kind === 'region' && current.id) edit?.onMoveRegion?.(current.id, x, y);
    else if (current.kind === 'radius' && current.id) {
      const region = config.regions.find(item => item.id === current.id);
      if (region) edit?.onResizeRegion?.(current.id, Math.round(Math.max(30, Math.hypot(point.x - region.x, point.y - region.y))));
    }
  };

  const endGesture = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    const current = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    setMoving(false);
    if (!current || current.moved) {
      if (current?.kind === 'pan') commit(viewRef.current);
      return;
    }
    // 点击（没有拖动）
    if (current.kind === 'location' && current.id) {
      if (edit?.tool === 'connect') {
        if (connectFrom && connectFrom !== current.id) { edit.onConnect?.(connectFrom, current.id); setConnectFrom(null); }
        else setConnectFrom(current.id);
        return;
      }
      onSelect?.(current.id);
      return;
    }
    if (current.kind === 'region' && current.id) { edit?.onSelectRegion?.(current.id); return; }
    if (current.kind === 'pan') {
      const point = toMap(event.clientX, event.clientY);
      if (point.x < 0 || point.y < 0 || point.x > config.width || point.y > config.height) { onSelect?.(null); return; }
      if (edit?.tool === 'add') edit.onAddLocation?.(Math.round(point.x), Math.round(point.y));
      else if (edit?.tool === 'region') edit.onAddRegion?.(Math.round(point.x), Math.round(point.y));
      else { onSelect?.(null); edit?.onSelectRegion?.(null); edit?.onSelectRoute?.(null); setConnectFrom(null); }
    }
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    if (compact || edit?.tool === 'add' || edit?.tool === 'region') return;
    const rect = hostRef.current!.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const { k, tx, ty } = viewRef.current;
    const next = k * 1.8;
    commit({ k: next, tx: px - ((px - tx) / k) * next, ty: py - ((py - ty) / k) * next });
  };

  // ── Derived per-zoom sizes ──
  const fit = fitRef.current || 1;
  const k = fit * zoom;
  const markerScale = Math.min(3.2, Math.max(0.55, Math.pow(1.1 / k, 0.72))) * (compact ? 0.85 : 1) * (theme === 'ancient' ? 1.22 : 1.08);
  const labelScale = Math.min(3.4, Math.max(0.5, Math.pow(1.1 / k, 0.88)));
  const forced = useMemo(() => new Set([selectedId, hover, ...(plan ?? [])].filter(Boolean) as string[]), [selectedId, hover, plan]);
  const regionAccents = useMemo(() => new Map(view.regions.map(item => [item.region.id, item.accent] as const)), [view.regions]);
  const labels = useMemo(() => placeLabels(visible, theme, markerScale, labelScale, forced, compact), [visible, theme, markerScale, labelScale, forced, compact]);
  const planPairs = useMemo(() => {
    const pairs = new Set<string>();
    for (let index = 1; index < (plan?.length ?? 0); index++) pairs.add([plan![index - 1], plan![index]].sort().join('|'));
    return pairs;
  }, [plan]);
  const fog = view.mode === 'play' && config.fog !== false && !edit;
  const authoredRoads = useMemo(() => hasFeatures(config, 'road') || hasFeatures(config, 'rail'), [config]);
  const current = view.current?.location;

  const routeLayer: ReactNode = knownRoutes.map(({ route, walked }) => {
    const a = byId.get(route.from)!.location;
    const b = byId.get(route.to)!.location;
    const { d, mx, my } = routePath(route, a, b);
    const style = routeStyle(theme, route, authoredRoads);
    const selected = edit?.selectedRouteId === route.id;
    const planned = planPairs.has([route.from, route.to].sort().join('|'));
    const width = style.width * (theme === 'modern' ? Math.max(0.7, Math.min(1.6, markerScale)) : 1);
    return (
      <g key={route.id} className={`map2d-route map2d-route--${route.kind}${route.hidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}`}
        onPointerDown={edit ? event => { event.stopPropagation(); edit.onSelectRoute?.(route.id); } : undefined}>
        {edit && <path d={d} stroke="transparent" strokeWidth={10} fill="none" />}
        {style.casing && <path d={d} fill="none" stroke={style.casing.stroke} strokeWidth={style.casing.width * (width / style.width)} strokeLinecap={style.cap ?? 'butt'} />}
        {walked && <path d={d} fill="none" className="map2d-walked" strokeWidth={width + (theme === 'modern' ? 2.2 : 1.6)} />}
        <path d={d} fill="none" stroke={style.stroke} strokeWidth={width} strokeDasharray={style.dash} strokeLinecap={style.cap ?? 'butt'} opacity={style.opacity ?? 1}
          className={style.flow ? 'map2d-flow' : undefined} filter={theme === 'scifi' && !moving ? `url(#${id}-glow)` : undefined} />
        {planned && <path d={d} fill="none" className="map2d-planned" strokeWidth={width + 2.4} />}
        {(route.danger ?? 0) >= 3 && !compact && (
          <g transform={`translate(${mx.toFixed(1)},${my.toFixed(1)}) scale(${markerScale})`} className="map2d-danger">
            {theme === 'ancient'
              ? <path d="M-3.4,-3.4 L3.4,3.4 M3.4,-3.4 L-3.4,3.4" stroke={VERMILION} strokeWidth={1.4} strokeLinecap="round" />
              : theme === 'modern'
                ? <><path d="M0,-4.6 L4.6,3.4 H-4.6 Z" fill="#e0483d" stroke="#ffffff" strokeWidth={0.9} /><path d="M0,-1.6 V0.9" stroke="#fff" strokeWidth={1} /></>
                : <path d="M0,-4 L4,0 L0,4 L-4,0 Z" fill="none" stroke="#ff6b7a" strokeWidth={1.1} />}
          </g>
        )}
        {selected && <path d={d} fill="none" className="map2d-route-selected" strokeWidth={width + 4} />}
      </g>
    );
  });

  const markerLayer: ReactNode = visible.map(item => {
    const { location } = item;
    const isSelected = selectedId === location.id;
    const isHover = hover === location.id;
    const scale = markerScale * (isHover ? 1.12 : 1) * (location.kind === 'capital' ? 1.08 : 1);
    return (
      <g key={location.id} transform={`translate(${location.x.toFixed(1)},${location.y.toFixed(1)})`}
        className={`map2d-place map2d-place--${item.status}${isSelected ? ' is-selected' : ''}${connectFrom === location.id ? ' is-linking' : ''}`}
        onPointerDown={event => { event.stopPropagation(); beginGesture(event, 'location', location.id); }}
        onPointerEnter={() => setHover(location.id)} onPointerLeave={() => setHover(previous => previous === location.id ? null : previous)}
        role="button" aria-label={location.name}>
        <circle r={14 * markerScale} fill="transparent" />
        <g transform={`scale(${scale})`}>
          {(isSelected || connectFrom === location.id) && <SelectionMark theme={theme} kind={location.kind} linking={connectFrom === location.id} />}
          {theme === 'ancient' ? <AncientPlace kind={location.kind} /> : theme === 'modern' ? <ModernPlace kind={location.kind} /> : <ScifiPlace kind={location.kind} />}
        </g>
        {item.quests.length > 0 && !compact && (
          <g transform={`translate(${10 * markerScale},${-16 * markerScale}) scale(${markerScale})`} className="map2d-quest">
            <circle r={4.6} /><text y={2.4} textAnchor="middle">!</text>
          </g>
        )}
        {item.people.length > 0 && !compact && (
          <g transform={`translate(${-11 * markerScale},${-14 * markerScale}) scale(${markerScale})`} className="map2d-people">
            <circle r={4.4} /><text y={2.2} textAnchor="middle">{Math.min(9, item.people.length)}</text>
          </g>
        )}
      </g>
    );
  });

  const regionHandles = edit ? config.regions.map(region => {
    const selected = edit.selectedRegionId === region.id;
    const accent = regionAccents.get(region.id) ?? '#c89b4b';
    const size = (selected ? 7.4 : 6) * markerScale;
    return (
      <g key={region.id} className={`map2d-region-handle${selected ? ' is-selected' : ''}`} style={{ '--region': accent } as CSSProperties}>
        <circle cx={region.x} cy={region.y} r={region.radius} className="map2d-region-ring" />
        <g transform={`translate(${region.x.toFixed(1)},${region.y.toFixed(1)})`} className="map2d-region-center"
          onPointerDown={event => { event.stopPropagation(); beginGesture(event, 'region', region.id); }}>
          <title>{`${region.name}：拖动移动`}</title>
          <circle r={size * 2.1} fill="transparent" />
          {selected && <circle r={size * 1.75} className="map2d-region-center__glow" />}
          <path d={`M0,${-size} L${size},0 L0,${size} L${-size},0 Z`} className="map2d-region-center__diamond" />
          <circle r={size * 0.32} className="map2d-region-center__pip" />
        </g>
        {selected && (
          <g transform={`translate(${(region.x + region.radius).toFixed(1)},${region.y.toFixed(1)})`} className="map2d-region-radius"
            onPointerDown={event => { event.stopPropagation(); beginGesture(event, 'radius', region.id); }}>
            <title>拖动调整范围</title>
            <circle r={9 * markerScale} fill="transparent" />
            <circle r={5.2 * markerScale} className="map2d-region-radius__knob" />
            <path d={`M${-2.6 * markerScale},${-1.9 * markerScale} L${-4 * markerScale},0 L${-2.6 * markerScale},${1.9 * markerScale} M${2.6 * markerScale},${-1.9 * markerScale} L${4 * markerScale},0 L${2.6 * markerScale},${1.9 * markerScale}`} className="map2d-region-radius__arrows" />
          </g>
        )}
      </g>
    );
  }) : null;

  const fogMask = fog ? (
    <mask id={`${id}-fog`} maskUnits="userSpaceOnUse" x={0} y={0} width={config.width} height={config.height}>
      <rect x={0} y={0} width={config.width} height={config.height} fill="#fff" />
      <g filter={`url(#${id}-soft)`}>
        {visible.map(item => <circle key={item.location.id} cx={item.location.x} cy={item.location.y} r={item.status === 'known' ? 62 : 96} fill="#000" />)}
      </g>
    </mask>
  ) : null;

  const scaleFor = (value: number) => (value * labelScale).toFixed(2);
  return (
    <div ref={hostRef} className={`map2d map2d--${theme}${compact ? ' map2d--compact' : ''}${moving ? ' is-moving' : ''}${edit ? ` is-editing tool-${edit.tool}` : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={event => beginGesture(event, 'pan')} onPointerMove={onPointerMove} onPointerUp={endGesture} onPointerCancel={endGesture}
      onDoubleClick={onDoubleClick}>
      <svg className="map2d__svg" width="100%" height="100%" role="img" aria-label={view.title}>
        <MapDefs id={id} theme={theme} />
        {fogMask && <defs>{fogMask}</defs>}
        <g ref={groupRef}>
          {grid && geometry ? <TerrainLayers id={id} theme={theme} view={view} grid={grid} geometry={geometry} raster={raster} /> : (
            <rect x={0} y={0} width={config.width} height={config.height} className="map2d-sheet map2d-sheet--loading" />
          )}
          {geometry && !compact && geometry.regionLabels.filter(label => view.regions.find(item => item.region.id === label.id)?.known).map(label => (
            <g key={label.id} className={`${TERRAIN_LABEL_CLASS[theme]}${label.water ? ' is-water' : ''}`}>
              <path id={`${id}-arc-${label.id}`} d={label.arc} fill="none" />
              <text fontSize={label.size} style={{ letterSpacing: `${label.size * (theme === 'modern' ? 0.32 : 0.55)}px` }}>
                <textPath href={`#${id}-arc-${label.id}`} startOffset="50%" textAnchor="middle">{theme === 'scifi' ? `◇ ${label.name}` : label.name}</textPath>
              </text>
            </g>
          ))}
          {!compact && <FeatureLabels id={id} theme={theme} config={config} labelScale={labelScale} />}
          <g className="map2d-routes">{routeLayer}</g>
          {fog && <rect x={0} y={0} width={config.width} height={config.height} mask={`url(#${id}-fog)`} className="map2d-fog" />}
          {fog && <rect x={0} y={0} width={config.width} height={config.height} mask={`url(#${id}-fog)`} fill={`url(#${id}-hatch)`} pointerEvents="none" />}
          {regionHandles}
          <g className="map2d-places">{markerLayer}</g>
          {current && (
            <g transform={`translate(${current.x.toFixed(1)},${current.y.toFixed(1)})`} pointerEvents="none">
              <CurrentMarker theme={theme} scale={markerScale} />
            </g>
          )}
          <g className="map2d-labels" pointerEvents="none">
            {labels.map(label => (
              <text key={label.id} x={label.x} y={label.y} textAnchor={label.anchor} fontSize={label.size}
                className={`map2d-label map2d-label--${byId.get(label.id)?.location.kind}${label.emphasis ? ' is-emphasis' : ''}${view.current?.location.id === label.id ? ' is-current' : ''}`}>
                {label.text}
              </text>
            ))}
          </g>
          {!compact && theme !== 'modern' && <rect x={0} y={0} width={config.width} height={config.height} fill={`url(#${id}-vignette)`} pointerEvents="none" />}
          {theme === 'scifi' && !compact && <rect x={0} y={0} width={config.width} height={config.height} fill={`url(#${id}-scan)`} pointerEvents="none" />}
          {!compact && <Frame theme={theme} width={config.width} height={config.height} />}
          {!compact && (
            <>
              <g transform={`translate(${config.width - 62},${config.height - 70}) scale(${scaleFor(0.9)})`} pointerEvents="none"><Compass theme={theme} /></g>
              <g transform={`translate(${theme === 'ancient' ? 30 : 22},${config.height - 26}) scale(${scaleFor(1)})`} pointerEvents="none"><ScaleBar theme={theme} config={config} /></g>
              <g transform={theme === 'ancient' ? `translate(${config.width / 2},42) scale(${scaleFor(0.9)})` : `translate(24,34) scale(${scaleFor(1)})`} pointerEvents="none">
                <Cartouche theme={theme} title={view.title} subtitle={theme === 'ancient' ? undefined : theme === 'modern' ? `${view.stats.total} 处地点 · 比例尺见左下` : `SECTOR MAP · ${String(view.stats.known).padStart(2, '0')}/${String(view.stats.total).padStart(2, '0')} NODES`} />
              </g>
            </>
          )}
        </g>
      </svg>
      {!grid && <div className="map2d__loading" aria-hidden="true"><span /></div>}
    </div>
  );
});

export default Map2D;
export { PAPER };
