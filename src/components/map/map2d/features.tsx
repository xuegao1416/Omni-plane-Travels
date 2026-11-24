/**
 * 2D 地图的手绘要素层（MapFeature）：地块、水面、河流、建筑、铁路、道路、边界与注记。
 * 测绘画风按网页地图的配色（浅米灰陆地、白色街道、黄色快速路、蓝色水面、绿色公园）；
 * 古卷画风用墨线（河流、城墙 / 长城、驿道）；星图画风用发光细线。
 */
import { memo, useMemo } from 'react';
import { smoothLine, type Point2 } from '../../../domains/map/features';
import type { MapFeature, MapModuleSchema, MapTheme } from '../../../domains/map/types';

function linePath(points: readonly Point2[], closed = false): string {
  if (!points.length) return '';
  let d = `M${points[0]![0].toFixed(1)},${points[0]![1].toFixed(1)}`;
  for (let index = 1; index < points.length; index++) d += `L${points[index]![0].toFixed(1)},${points[index]![1].toFixed(1)}`;
  return closed ? `${d}Z` : d;
}

const ROAD_ORDER: Record<string, number> = { path: 0, street: 1, major: 2, highway: 3 };

interface Prepared {
  areas: Array<{ d: string; fill: string; level?: string; natural: boolean; relief: boolean }>;
  waters: Array<{ d: string; shallow: boolean }>;
  lands: string[];
  rivers: Array<{ d: string; width: number; id: string; name?: string }>;
  buildings: Array<{ d: string; tall: boolean }>;
  rails: Array<{ d: string; level?: string; color?: string; id: string; name?: string }>;
  roads: Array<{ d: string; level: string; width: number; id: string; name?: string }>;
  borders: Array<{ d: string; level: string; id: string; name?: string }>;
  labels: Array<{ x: number; y: number; text: string; level: string }>;
}

const MODERN_AREA: Record<string, string> = {
  park: '#c9e7bd', forest: '#cfe5c2', campus: '#f1e6d6', industrial: '#e6e1ea', beach: '#f5ecc9', sports: '#bfe0ae', hazard: '#f0d3cf', track: '#dfa58f',
  cemetery: '#d6e4cf', urban: '#e7e3dc', farmland: '#ebedd3', swamp: '#d3e6d6', desert: '#efe2bf', wasteland: '#e3d9c6',
  hills: '#e6e1d2', mountains: '#ded7c6', snow: '#f4f6f8', plains: '#efece3',
};

const ANCIENT_AREA: Record<string, string> = {
  urban: 'rgba(196, 160, 112, .22)', campus: 'rgba(196, 160, 112, .18)', industrial: 'rgba(160, 130, 100, .2)',
};

const cache = new WeakMap<object, Map<MapTheme, Prepared>>();

function prepare(config: MapModuleSchema, theme: MapTheme): Prepared {
  const hit = cache.get(config)?.get(theme);
  if (hit) return hit;
  const out: Prepared = { areas: [], waters: [], lands: [], rivers: [], buildings: [], rails: [], roads: [], borders: [], labels: [] };
  (config.features ?? []).forEach((feature: MapFeature, index) => {
    const id = `f${index}`;
    switch (feature.kind) {
      case 'area': {
        const key = feature.level ?? feature.terrain ?? 'urban';
        const fill = theme === 'modern' ? MODERN_AREA[key] ?? MODERN_AREA[feature.terrain ?? ''] : theme === 'ancient' ? ANCIENT_AREA[key] : undefined;
        const natural = !['urban', 'campus', 'industrial', 'sports', 'track'].includes(key);
        const relief = !feature.level && (feature.terrain === 'mountains' || feature.terrain === 'hills' || feature.terrain === 'snow');
        if (fill) out.areas.push({ d: linePath(smoothLine(feature.points, 2, true), true), fill, natural, relief, ...(feature.level ? { level: feature.level } : {}) });
        break;
      }
      case 'water':
        out.waters.push({ d: linePath(smoothLine(feature.points, 3, true), true), shallow: feature.level === 'shallow' });
        break;
      case 'land':
        out.lands.push(linePath(smoothLine(feature.points, 3, true), true));
        break;
      case 'river':
        out.rivers.push({ d: linePath(smoothLine(feature.points, 4)), width: feature.width ?? 3, id, ...(feature.name ? { name: feature.name } : {}) });
        break;
      case 'building':
        out.buildings.push({ d: linePath(feature.points, true), tall: (feature.height ?? 1) > 2.5 });
        break;
      case 'rail':
        out.rails.push({ d: linePath(smoothLine(feature.points, 3)), id, ...(feature.level ? { level: feature.level } : {}), ...(feature.color ? { color: feature.color } : {}), ...(feature.name ? { name: feature.name } : {}) });
        break;
      case 'road': {
        const level = feature.level && ROAD_ORDER[feature.level] !== undefined ? feature.level : 'street';
        const width = feature.width ?? (level === 'highway' ? 5 : level === 'major' ? 3.6 : level === 'path' ? 1 : 2.2);
        out.roads.push({ d: linePath(smoothLine(feature.points, level === 'street' ? 1 : 3)), level, width, id, ...(feature.name ? { name: feature.name } : {}) });
        break;
      }
      case 'border':
        out.borders.push({ d: linePath(smoothLine(feature.points, 2)), level: feature.level ?? 'national', id, ...(feature.name ? { name: feature.name } : {}) });
        break;
      case 'label':
        if (feature.name) out.labels.push({ x: feature.points[0]![0], y: feature.points[0]![1], text: feature.name, level: feature.level ?? 'district' });
        break;
      default:
        break;
    }
  });
  out.roads.sort((a, b) => ROAD_ORDER[a.level]! - ROAD_ORDER[b.level]!);
  let perConfig = cache.get(config);
  if (!perConfig) { perConfig = new Map(); cache.set(config, perConfig); }
  perConfig.set(theme, out);
  return out;
}

const MODERN_ROAD: Record<string, { fill: string; casing: string; extra: number }> = {
  highway: { fill: '#fbd88a', casing: '#e4a94c', extra: 1.4 },
  major: { fill: '#ffffff', casing: '#d2cdc2', extra: 1.1 },
  street: { fill: '#ffffff', casing: '#dedad2', extra: 0.7 },
  path: { fill: 'none', casing: 'none', extra: 0 },
};

/** 地块、水面、河流、建筑、铁路、道路、边界（画在地形之上、路线与地点之下）。 */
export const FeatureShapes = memo(function FeatureShapes({ id, theme, config }: { id: string; theme: MapTheme; config: MapModuleSchema }) {
  const data = useMemo(() => prepare(config, theme), [config, theme]);
  if (!config.features?.length) return null;
  if (theme === 'ancient') {
    return (
      <g className="map2d-features map2d-features--ancient">
        {data.areas.map((area, index) => <path key={`a${index}`} d={area.d} fill={area.fill} stroke="none" />)}
        {data.rivers.map(river => (
          <g key={river.id}>
            <path id={`${id}-${river.id}`} d={river.d} fill="none" stroke="#f3e6c4" strokeOpacity={0.55} strokeWidth={Math.max(1.6, river.width * 0.55) + 1.6} strokeLinecap="round" strokeLinejoin="round" />
            <path d={river.d} fill="none" stroke="#3f6f7e" strokeWidth={Math.max(1.1, river.width * 0.55)} strokeLinecap="round" strokeLinejoin="round" opacity={0.88} />
          </g>
        ))}
        {data.roads.map(road => <path key={road.id} id={`${id}-${road.id}`} d={road.d} fill="none" stroke="#6b4a2a" strokeWidth={road.level === 'highway' || road.level === 'major' ? 1 : 0.7} strokeDasharray={road.level === 'path' ? '0.5 2.4' : '3 2'} strokeLinecap="round" opacity={0.7} />)}
        {data.borders.map(border => border.level === 'wall' ? (
          <g key={border.id}>
            <path id={`${id}-${border.id}`} d={border.d} fill="none" stroke="#f1e1bb" strokeWidth={4.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
            <path d={border.d} fill="none" stroke="#5a3b1c" strokeWidth={1.1} strokeLinejoin="round" />
            <path d={border.d} fill="none" stroke="#5a3b1c" strokeWidth={3.2} strokeDasharray="1.3 1.7" strokeLinejoin="round" transform="translate(0,-0.9)" />
          </g>
        ) : (
          <path key={border.id} id={`${id}-${border.id}`} d={border.d} fill="none" stroke="#8c2f1c" strokeWidth={border.level === 'national' ? 1.3 : 0.9} strokeDasharray="5 2 1 2" opacity={0.75} />
        ))}
        {data.rails.map(rail => <path key={rail.id} id={`${id}-${rail.id}`} d={rail.d} fill="none" stroke="#3a2817" strokeWidth={1.2} strokeDasharray="1 2" opacity={0.6} />)}
      </g>
    );
  }
  if (theme === 'scifi') {
    return (
      <g className="map2d-features map2d-features--scifi">
        {data.waters.map((water, index) => <path key={`w${index}`} d={water.d} fill="rgba(20, 90, 140, .35)" stroke="rgba(62, 232, 255, .45)" strokeWidth={0.6} />)}
        {data.rivers.map(river => <path key={river.id} id={`${id}-${river.id}`} d={river.d} fill="none" stroke="rgba(62, 232, 255, .55)" strokeWidth={Math.max(0.8, river.width * 0.5)} strokeLinecap="round" />)}
        {data.buildings.map((building, index) => <path key={`b${index}`} d={building.d} fill="rgba(16, 40, 70, .75)" stroke="rgba(62, 232, 255, .5)" strokeWidth={0.4} />)}
        {data.roads.map(road => <path key={road.id} id={`${id}-${road.id}`} d={road.d} fill="none" stroke="rgba(127, 216, 255, .45)" strokeWidth={Math.max(0.5, road.width * 0.35)} strokeLinecap="round" />)}
        {data.rails.map(rail => <path key={rail.id} id={`${id}-${rail.id}`} d={rail.d} fill="none" stroke={rail.color ?? 'rgba(230, 255, 79, .6)'} strokeWidth={0.9} strokeDasharray="3 3" />)}
        {data.borders.map(border => <path key={border.id} id={`${id}-${border.id}`} d={border.d} fill="none" stroke="rgba(255, 92, 220, .7)" strokeWidth={1} strokeDasharray="6 4" />)}
      </g>
    );
  }
  return (
    <g className="map2d-features map2d-features--modern">
      {data.areas.map((area, index) => (
        <path key={`a${index}`} d={area.d} fill={area.fill} fillOpacity={area.relief ? 0.55 : area.natural ? 0.86 : 1} stroke={area.level === 'sports' ? '#ffffff' : 'none'} strokeWidth={area.level === 'sports' ? 0.8 : 0} />
      ))}
      {data.waters.map((water, index) => (
        <path key={`w${index}`} d={water.d} fill={water.shallow ? '#bfe6ef' : '#a9d3f2'} stroke={water.shallow ? '#9fd6e3' : '#93c2e8'} strokeWidth={0.7} strokeDasharray={water.shallow ? '1.5 1.5' : undefined} />
      ))}
      {data.lands.map((d, index) => <path key={`l${index}`} d={d} fill="none" stroke="#93c2e8" strokeWidth={0.8} />)}
      {data.rivers.map(river => <path key={river.id} id={`${id}-${river.id}`} d={river.d} fill="none" stroke="#a9d3f2" strokeWidth={river.width} strokeLinecap="round" strokeLinejoin="round" />)}
      {data.buildings.map((building, index) => <path key={`b${index}`} d={building.d} fill={building.tall ? '#dcd7ce' : '#e5e1d9'} stroke="#d0c9bc" strokeWidth={0.35} />)}
      {data.rails.filter(rail => rail.level !== 'metro').map(rail => (
        <g key={rail.id} opacity={rail.level === 'tunnel' ? 0.55 : 1}>
          <path id={`${id}-${rail.id}`} d={rail.d} fill="none" stroke="#a3a8ae" strokeWidth={1.9} strokeDasharray={rail.level === 'tunnel' ? '4 3' : undefined} />
          {rail.level !== 'tunnel' && <path d={rail.d} fill="none" stroke="#ffffff" strokeWidth={0.9} strokeDasharray="3.5 3.5" />}
        </g>
      ))}
      {data.roads.filter(road => road.level !== 'path').map(road => {
        const style = MODERN_ROAD[road.level]!;
        return <path key={`${road.id}c`} d={road.d} fill="none" stroke={style.casing} strokeWidth={road.width + style.extra} strokeLinecap="round" strokeLinejoin="round" />;
      })}
      {data.roads.map(road => road.level === 'path'
        ? <path key={road.id} id={`${id}-${road.id}`} d={road.d} fill="none" stroke="#b9a98f" strokeWidth={road.width} strokeDasharray="2 1.6" strokeLinecap="round" />
        : <path key={road.id} id={`${id}-${road.id}`} d={road.d} fill="none" stroke={MODERN_ROAD[road.level]!.fill} strokeWidth={road.width} strokeLinecap="round" strokeLinejoin="round" />)}
      {data.rails.filter(rail => rail.level === 'metro').map(rail => (
        <path key={rail.id} id={`${id}-${rail.id}`} d={rail.d} fill="none" stroke={rail.color ?? '#7b61c9'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" opacity={0.78} />
      ))}
      {data.borders.map(border => (
        <g key={border.id}>
          <path d={border.d} fill="none" stroke={border.level === 'national' ? 'rgba(150, 102, 170, .22)' : 'rgba(120, 120, 130, .16)'} strokeWidth={border.level === 'national' ? 7 : 4} strokeLinecap="round" strokeLinejoin="round" />
          <path id={`${id}-${border.id}`} d={border.d} fill="none" stroke={border.level === 'national' ? '#8a5f9c' : '#8f8f96'} strokeWidth={border.level === 'national' ? 1.3 : 0.9} strokeDasharray={border.level === 'national' ? '7 3 1.5 3' : '4 3'} strokeLinejoin="round" />
        </g>
      ))}
    </g>
  );
});

/** 要素名：沿河流、道路、铁路与边界排字，外加独立注记（国名、片区、水面、山峰）。labelScale 让字在缩放时保持可读。 */
export function FeatureLabels({ id, theme, config, labelScale }: { id: string; theme: MapTheme; config: MapModuleSchema; labelScale: number }) {
  const data = useMemo(() => prepare(config, theme), [config, theme]);
  if (!config.features?.length) return null;
  const size = (base: number) => (base * labelScale).toFixed(2);
  const along = [
    ...data.rivers.filter(item => item.name).map(item => ({ id: item.id, name: item.name!, cls: 'is-water', base: 8.6 })),
    ...data.roads.filter(item => item.name && (item.level === 'major' || item.level === 'highway' || theme === 'ancient')).map(item => ({ id: item.id, name: item.name!, cls: `is-road is-${item.level}`, base: item.level === 'highway' ? 7.6 : 7 })),
    ...data.rails.filter(item => item.name).map(item => ({ id: item.id, name: item.name!, cls: 'is-rail', base: 6.8 })),
    ...data.borders.filter(item => item.name).map(item => ({ id: item.id, name: item.name!, cls: 'is-border', base: 7.6 })),
  ];
  return (
    <g className={`map2d-feature-labels map2d-feature-labels--${theme}`} aria-hidden="true">
      {along.map(item => (
        <text key={`t${item.id}`} className={`map2d-feature-label ${item.cls}`} fontSize={size(item.base)} dy={-0.2}>
          <textPath href={`#${id}-${item.id}`} startOffset="50%" textAnchor="middle">{item.name}</textPath>
        </text>
      ))}
      {data.labels.map((label, index) => (
        <text key={`l${index}`} x={label.x} y={label.y} textAnchor="middle" className={`map2d-feature-label is-${label.level}`}
          fontSize={size(label.level === 'country' ? 15 : label.level === 'water' ? 10 : label.level === 'peak' ? 7.6 : label.level === 'range' ? 9 : 8.4)}>
          {label.level === 'peak' ? `▲ ${label.text}` : label.text}
        </text>
      ))}
    </g>
  );
}
