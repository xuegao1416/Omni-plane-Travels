/**
 * 2D 地图的装饰：滤镜与图案定义、罗盘、比例尺、标题框与图框。
 */
import { metersPerUnitOf } from '../../../domains/map/config';
import type { MapModuleSchema, MapTheme } from '../../../domains/map/types';
import { INK, PAPER, VERMILION } from './glyphs';

export function MapDefs({ id, theme }: { id: string; theme: MapTheme }) {
  return (
    <defs>
      <filter id={`${id}-sheet`} x="-5%" y="-5%" width="110%" height="112%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity={theme === 'scifi' ? 0.6 : 0.45} />
      </filter>
      <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.2" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id={`${id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="14" />
      </filter>
      <filter id={`${id}-pin`} x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" floodColor="#102030" floodOpacity="0.35" />
      </filter>
      <radialGradient id={`${id}-vignette`} cx="50%" cy="50%" r="72%">
        <stop offset="55%" stopColor="#000" stopOpacity="0" />
        <stop offset="100%" stopColor={theme === 'ancient' ? '#4a2c10' : theme === 'scifi' ? '#000' : '#2a3a4a'} stopOpacity={theme === 'ancient' ? 0.34 : theme === 'scifi' ? 0.55 : 0.08} />
      </radialGradient>
      <pattern id={`${id}-hex`} width="24" height="41.57" patternUnits="userSpaceOnUse" patternTransform="scale(0.9)">
        <path d="M12,0 L24,6.93 L24,20.78 L12,27.71 L0,20.78 L0,6.93 Z M12,27.71 V41.57" fill="none" stroke="#3ee8ff" strokeWidth="0.45" opacity="0.18" />
      </pattern>
      {[14, -21, 33].map((angle, index) => (
        <pattern key={angle} id={`${id}-streets-${index}`} width="44" height="44" patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
          <path d="M0,0 H44 M0,0 V44" stroke="#ffffff" strokeWidth="2.1" />
          <path d="M0,11 H44 M0,22 H44 M0,33 H44 M14.5,0 V44 M29.5,0 V44" stroke="#ffffff" strokeWidth="0.8" opacity="0.8" />
        </pattern>
      ))}
      <pattern id={`${id}-cityglow`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
        <path d="M0,0 H10 M0,0 V10" stroke="#3ee8ff" strokeWidth="0.5" opacity="0.5" />
        <rect x="3" y="3" width="2" height="2" fill="#ffd36b" opacity="0.5" />
      </pattern>
      <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <path d="M0,0 V7" stroke={theme === 'ancient' ? '#6b4a26' : theme === 'scifi' ? '#3ee8ff' : '#9aa6b2'} strokeWidth="0.8" opacity={theme === 'scifi' ? 0.12 : 0.22} />
      </pattern>
      <pattern id={`${id}-scan`} width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="1" fill="#3ee8ff" opacity="0.05" />
      </pattern>
    </defs>
  );
}

/** 古卷罗盘：十六向星芒 + 朱砂北针。 */
function AncientCompass() {
  const points = (count: number, outer: number, inner: number, rotate = 0) => Array.from({ length: count * 2 }, (_, index) => {
    const angle = (Math.PI / count) * index + rotate - Math.PI / 2;
    const radius = index % 2 ? inner : outer;
    return `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`;
  }).join(' ');
  return (
    <g>
      <circle r={30} fill={PAPER} fillOpacity={0.55} stroke={INK} strokeWidth={0.8} />
      <circle r={26.5} fill="none" stroke={INK} strokeWidth={0.5} strokeDasharray="1 2.2" />
      <polygon points={points(8, 24, 6, Math.PI / 8)} fill={PAPER} stroke={INK} strokeWidth={0.5} />
      <polygon points={points(4, 34, 5.2)} fill={PAPER} stroke={INK} strokeWidth={0.8} />
      {[0, 1, 2, 3].map(index => {
        const angle = (Math.PI / 2) * index;
        const tip = [Math.sin(angle) * 34, -Math.cos(angle) * 34];
        const side = [Math.sin(angle + Math.PI / 4) * 5.2, -Math.cos(angle + Math.PI / 4) * 5.2];
        return <polygon key={index} points={`0,0 ${tip[0]!.toFixed(2)},${tip[1]!.toFixed(2)} ${side[0]!.toFixed(2)},${side[1]!.toFixed(2)}`} fill={index === 0 ? VERMILION : INK} opacity={index === 0 ? 0.95 : 0.78} />;
      })}
      <circle r={3} fill={PAPER} stroke={INK} strokeWidth={0.7} />
      <text y={-38} textAnchor="middle" className="map2d-compass-label">北</text>
    </g>
  );
}

function ModernCompass() {
  return (
    <g>
      <circle r={15} fill="#ffffff" opacity={0.92} stroke="#c9d1d9" strokeWidth={0.8} />
      <path d="M0,-11 L5,4 L0,1.2 L-5,4 Z" fill="#e2483d" />
      <path d="M0,11 L5,4 L0,1.2 L-5,4 Z" fill="#8a96a3" opacity={0.6} />
      <text y={-17.5} textAnchor="middle" className="map2d-compass-label">N</text>
    </g>
  );
}

function ScifiCompass() {
  return (
    <g className="map2d-hud">
      <circle r={20} fill="none" stroke="#3ee8ff" strokeWidth={0.8} opacity={0.6} />
      <circle r={26} fill="none" stroke="#3ee8ff" strokeWidth={0.5} strokeDasharray="1.5 4" opacity={0.5} className="map2d-spin" />
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (Math.PI / 6) * index;
        return <line key={index} x1={Math.sin(angle) * 16} y1={-Math.cos(angle) * 16} x2={Math.sin(angle) * (index % 3 ? 18 : 20)} y2={-Math.cos(angle) * (index % 3 ? 18 : 20)} stroke="#3ee8ff" strokeWidth={0.7} opacity={0.8} />;
      })}
      <path d="M0,-14 L4,0 L0,-3 L-4,0 Z" fill="#ff5cdc" />
      <text y={-30} textAnchor="middle" className="map2d-compass-label">N</text>
    </g>
  );
}

export function Compass({ theme }: { theme: MapTheme }) {
  return theme === 'ancient' ? <AncientCompass /> : theme === 'modern' ? <ModernCompass /> : <ScifiCompass />;
}

/** 比例尺：按地图尺度把 100 个地图单位换成里 / 公里 / 光年。 */
export function scaleLabel(config: MapModuleSchema, theme: MapTheme, units: number): string {
  if (config.landform === 'space') return `${Math.max(1, Math.round(units / 100))} 光年`;
  const km = (units * metersPerUnitOf(config)) / 1000;
  if (theme === 'ancient') {
    const li = Math.round(km * 2 / 10) * 10;
    return li >= 10 ? `${li} 里` : `${Math.max(1, Math.round(km * 2))} 里`;
  }
  return km >= 1 ? `${Math.round(km * 10) / 10} 公里` : `${Math.round(km * 1000)} 米`;
}

export function ScaleBar({ theme, config }: { theme: MapTheme; config: MapModuleSchema }) {
  const units = 100;
  const color = theme === 'ancient' ? INK : theme === 'scifi' ? '#3ee8ff' : '#3c4a58';
  return (
    <g className="map2d-scale">
      {[0, 1, 2, 3].map(index => (
        <rect key={index} x={index * (units / 4)} y={0} width={units / 4} height={theme === 'modern' ? 3 : 4}
          fill={index % 2 ? (theme === 'scifi' ? 'rgba(4,14,28,.8)' : '#ffffff') : color} stroke={color} strokeWidth={0.6} />
      ))}
      <text x={units + 6} y={4} className="map2d-scale-label">{scaleLabel(config, theme, units)}</text>
    </g>
  );
}

/** 古卷标题框：卷轴飘带。 */
export function Cartouche({ theme, title, subtitle }: { theme: MapTheme; title: string; subtitle?: string }) {
  if (theme === 'ancient') {
    const width = Math.max(150, title.length * 26 + 70);
    return (
      <g className="map2d-cartouche">
        <path d={`M${-width / 2 - 18},6 L${-width / 2},-2 L${-width / 2 - 10},-14 L${-width / 2 + 8},-16 Z`} fill="#d9c08f" stroke={INK} strokeWidth={0.8} />
        <path d={`M${width / 2 + 18},6 L${width / 2},-2 L${width / 2 + 10},-14 L${width / 2 - 8},-16 Z`} fill="#d9c08f" stroke={INK} strokeWidth={0.8} />
        <path d={`M${-width / 2},-22 Q0,-30 ${width / 2},-22 L${width / 2},10 Q0,2 ${-width / 2},10 Z`} fill={PAPER} stroke={INK} strokeWidth={1} />
        <path d={`M${-width / 2 + 6},-17 Q0,-24.5 ${width / 2 - 6},-17 M${-width / 2 + 6},5 Q0,-2.5 ${width / 2 - 6},5`} fill="none" stroke={VERMILION} strokeWidth={0.6} />
        <text y={-2} textAnchor="middle" className="map2d-cartouche-title">{title}</text>
        {subtitle && <text y={20} textAnchor="middle" className="map2d-cartouche-sub">{subtitle}</text>}
      </g>
    );
  }
  if (theme === 'modern') {
    return (
      <g className="map2d-cartouche">
        <text x={0} y={0} className="map2d-cartouche-title">{title}</text>
        {subtitle && <text x={0} y={15} className="map2d-cartouche-sub">{subtitle}</text>}
      </g>
    );
  }
  return (
    <g className="map2d-cartouche">
      <path d="M0,-16 H10 M0,-16 V-6" stroke="#3ee8ff" strokeWidth={1.2} fill="none" />
      <text x={14} y={-4} className="map2d-cartouche-title">{title}</text>
      {subtitle && <text x={14} y={11} className="map2d-cartouche-sub">{subtitle}</text>}
    </g>
  );
}

/** 图框：古卷双线 + 角花；科幻 HUD 角标；现代只留细边。 */
export function Frame({ theme, width, height }: { theme: MapTheme; width: number; height: number }) {
  if (theme === 'ancient') {
    const corner = (x: number, y: number, sx: number, sy: number) => (
      <g transform={`translate(${x},${y}) scale(${sx},${sy})`}>
        <path d="M0,0 h26 M0,0 v26 M6,6 h12 M6,6 v12" stroke={INK} strokeWidth={0.9} fill="none" />
        <circle cx={6} cy={6} r={2.4} fill={VERMILION} />
      </g>
    );
    return (
      <g className="map2d-frame" pointerEvents="none">
        <rect x={4} y={4} width={width - 8} height={height - 8} fill="none" stroke={INK} strokeWidth={1.6} />
        <rect x={9} y={9} width={width - 18} height={height - 18} fill="none" stroke={INK} strokeWidth={0.6} />
        {corner(9, 9, 1, 1)}{corner(width - 9, 9, -1, 1)}{corner(9, height - 9, 1, -1)}{corner(width - 9, height - 9, -1, -1)}
      </g>
    );
  }
  if (theme === 'scifi') {
    const tick = (x: number, y: number, sx: number, sy: number) => <path transform={`translate(${x},${y}) scale(${sx},${sy})`} d="M0,22 V0 H22" stroke="#3ee8ff" strokeWidth={1.4} fill="none" />;
    return (
      <g className="map2d-frame" pointerEvents="none">
        <rect x={0.5} y={0.5} width={width - 1} height={height - 1} fill="none" stroke="#3ee8ff" strokeWidth={0.6} opacity={0.35} />
        {tick(6, 6, 1, 1)}{tick(width - 6, 6, -1, 1)}{tick(6, height - 6, 1, -1)}{tick(width - 6, height - 6, -1, -1)}
        {Array.from({ length: 19 }, (_, index) => <line key={index} x1={(index + 1) * width / 20} y1={0} x2={(index + 1) * width / 20} y2={index % 5 === 4 ? 9 : 5} stroke="#3ee8ff" strokeWidth={0.6} opacity={0.55} />)}
        {Array.from({ length: 13 }, (_, index) => <line key={`v${index}`} x1={0} y1={(index + 1) * height / 14} x2={index % 5 === 4 ? 9 : 5} y2={(index + 1) * height / 14} stroke="#3ee8ff" strokeWidth={0.6} opacity={0.55} />)}
      </g>
    );
  }
  return <rect x={0.5} y={0.5} width={width - 1} height={height - 1} fill="none" stroke="#b8c2cc" strokeWidth={1} pointerEvents="none" />;
}
