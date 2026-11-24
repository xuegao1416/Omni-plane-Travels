/**
 * 2D 地图的符号：古卷的手绘地点与地貌，现代的标注针与地点圆点，科幻的六角信标。
 * 坐标以地点为原点（地点在符号底部中心）。
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Anchor, Building2, Crown, Factory, Flag, GraduationCap, House, Landmark, Pickaxe, Radiation, Rocket, Satellite, Shield,
  ShoppingBag, Skull, Sparkles, Star, Store, Telescope, Tent, TrainFront, TriangleAlert,
} from 'lucide-react';
import type { MapLocationKind, MapTheme } from '../../../domains/map/types';
import type { Glyph } from './geometry';

export const INK = '#3a2817';
export const PAPER = '#f2e4c1';
export const VERMILION = '#9b2f1d';
const SHADE = 'rgba(58, 40, 23, 0.5)';

function crenels(x0: number, x1: number, y: number, size: number): string {
  let d = `M${x0},${y}`;
  let x = x0;
  let up = true;
  while (x < x1 - 0.01) {
    const next = Math.min(x1, x + size);
    d += up ? ` v${-size * 0.7} H${next} v${size * 0.7}` : ` H${next}`;
    x = next;
    up = !up;
  }
  return d;
}

function roof(cx: number, base: number, half: number, height: number, fill = VERMILION): ReactNode {
  return <path d={`M${cx - half},${base} L${cx},${base - height} L${cx + half},${base} Z`} fill={fill} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />;
}

function house(x: number, base: number, w: number, h: number, roofFill = VERMILION): ReactNode {
  return (
    <g key={`h${x}`}>
      <rect x={x - w / 2} y={base - h} width={w} height={h} fill={PAPER} stroke={INK} strokeWidth={0.8} />
      <path d={`M${x - w / 2 - 1.2},${base - h} L${x},${base - h - w * 0.62} L${x + w / 2 + 1.2},${base - h} Z`} fill={roofFill} stroke={INK} strokeWidth={0.8} strokeLinejoin="round" />
      <rect x={x - 0.8} y={base - h * 0.55} width={1.6} height={h * 0.55} fill={INK} />
    </g>
  );
}

/** 古卷地点符号（墨线 + 朱砂屋顶）。 */
export function AncientPlace({ kind }: { kind: MapLocationKind }) {
  const stroke = { stroke: INK, strokeWidth: 0.9, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  switch (kind) {
    case 'capital':
      return (
        <g>
          <ellipse cx={0} cy={4.6} rx={15} ry={2.6} fill={SHADE} opacity={0.35} />
          <rect x={-4.2} y={-11} width={8.4} height={9} fill={PAPER} {...stroke} />
          <path d="M-5.6,-11 L0,-17.5 L5.6,-11 Z" fill={VERMILION} {...stroke} />
          <path d="M0,-17.5 V-23.5" {...stroke} />
          <path d="M0,-23.5 L5.6,-21.8 L0,-20.2 Z" fill={VERMILION} stroke={INK} strokeWidth={0.6} />
          <path d={`${crenels(-12, 12, -2.2, 2.4)} V4 H-12 Z`} fill={PAPER} {...stroke} />
          <rect x={-13.5} y={-8} width={5.4} height={12} fill={PAPER} {...stroke} />
          <rect x={8.1} y={-8} width={5.4} height={12} fill={PAPER} {...stroke} />
          {roof(-10.8, -8, 3.6, 5.6)}
          {roof(10.8, -8, 3.6, 5.6)}
          <path d="M-2.6,4 V1 Q0,-1.6 2.6,1 V4 Z" fill={INK} />
          <path d="M-10.8,-4.5 v2 M10.8,-4.5 v2 M-1.4,-8 v2.4 M1.4,-8 v2.4" stroke={INK} strokeWidth={0.9} />
        </g>
      );
    case 'city':
      return (
        <g>
          <ellipse cx={0} cy={4.4} rx={11} ry={2.2} fill={SHADE} opacity={0.32} />
          <path d={`${crenels(-8, 8, -1.6, 2.2)} V4 H-8 Z`} fill={PAPER} {...stroke} />
          <rect x={-10} y={-7.4} width={4.6} height={11.4} fill={PAPER} {...stroke} />
          <rect x={5.4} y={-7.4} width={4.6} height={11.4} fill={PAPER} {...stroke} />
          {roof(-7.7, -7.4, 3.1, 5)}
          {roof(7.7, -7.4, 3.1, 5)}
          <path d="M-2.2,4 V1.4 Q0,-0.8 2.2,1.4 V4 Z" fill={INK} />
        </g>
      );
    case 'town':
      return (
        <g>
          <ellipse cx={0} cy={4.2} rx={10} ry={2} fill={SHADE} opacity={0.3} />
          {house(-5.4, 4, 5, 4.4)}
          {house(5.4, 4, 5, 4.4)}
          {house(0, 4, 6, 6.2)}
        </g>
      );
    case 'village':
      return (
        <g>
          <ellipse cx={0} cy={4} rx={8} ry={1.8} fill={SHADE} opacity={0.28} />
          {house(-3.4, 4, 4.4, 3.6, '#b8894a')}
          {house(3.6, 4, 4.8, 4.2, '#b8894a')}
        </g>
      );
    case 'fortress':
      return (
        <g>
          <ellipse cx={0} cy={4.4} rx={9.5} ry={2.2} fill={SHADE} opacity={0.32} />
          <path d={`${crenels(-7, 7, -6.5, 2)} V4 H-7 Z`} fill={PAPER} {...stroke} />
          <path d="M0,-8.2 V-15" {...stroke} />
          <path d="M0,-15 L6,-13.2 L0,-11.4 Z" fill={VERMILION} stroke={INK} strokeWidth={0.6} />
          <path d="M-2.4,4 V0 Q0,-2.4 2.4,0 V4 Z" fill={INK} />
          <path d="M-4.6,-3.5 v2.2 M4.6,-3.5 v2.2" stroke={INK} strokeWidth={1} />
        </g>
      );
    case 'port':
      return (
        <g>
          <path d="M-10,4.6 q2.5,-1.6 5,0 t5,0 t5,0 t5,0" fill="none" stroke={INK} strokeWidth={0.8} opacity={0.7} />
          <circle cx={0} cy={-11.2} r={2.1} fill={PAPER} {...stroke} />
          <path d="M0,-9 V2.4 M-4.2,-6.6 H4.2" {...stroke} strokeWidth={1.3} />
          <path d="M-7,-1.6 Q-6,3.6 0,3.4 Q6,3.6 7,-1.6" fill="none" {...stroke} strokeWidth={1.3} />
          <path d="M-8.4,-0.2 L-7,-2.6 L-5.4,-0.6 M8.4,-0.2 L7,-2.6 L5.4,-0.6" fill="none" {...stroke} />
        </g>
      );
    case 'temple':
      return (
        <g>
          <ellipse cx={0} cy={4.3} rx={9} ry={2} fill={SHADE} opacity={0.3} />
          <rect x={-5.2} y={-1} width={10.4} height={5} fill={PAPER} {...stroke} />
          <path d="M-10,-0.6 Q-6,-1.2 -4.6,-4.6 H4.6 Q6,-1.2 10,-0.6 Q4,-2 0,-2 Q-4,-2 -10,-0.6 Z" fill={VERMILION} {...stroke} />
          <rect x={-3.4} y={-8.2} width={6.8} height={3.6} fill={PAPER} {...stroke} />
          <path d="M-7.6,-8 Q-4.4,-8.6 -3.2,-11.6 H3.2 Q4.4,-8.6 7.6,-8 Q3,-9.2 0,-9.2 Q-3,-9.2 -7.6,-8 Z" fill={VERMILION} {...stroke} />
          <path d="M0,-11.6 V-16.4" {...stroke} strokeWidth={1.1} />
          <circle cx={0} cy={-13.6} r={0.9} fill={INK} />
          <rect x={-1.2} y={0.8} width={2.4} height={3.2} fill={INK} />
        </g>
      );
    case 'academy':
      return (
        <g>
          <ellipse cx={0} cy={4.3} rx={10} ry={2} fill={SHADE} opacity={0.3} />
          <path d="M-9,-3.4 L0,-9.6 L9,-3.4 Z" fill={VERMILION} {...stroke} />
          <rect x={-8.2} y={-3.4} width={16.4} height={1.6} fill={PAPER} {...stroke} />
          {[-6.2, -2.1, 2.1, 6.2].map(x => <rect key={x} x={x - 0.9} y={-1.8} width={1.8} height={4.8} fill={PAPER} stroke={INK} strokeWidth={0.7} />)}
          <rect x={-9.4} y={3} width={18.8} height={1.4} fill={PAPER} {...stroke} />
          <path d="M-3,-14.4 Q-1.5,-15.6 0,-14.4 Q1.5,-15.6 3,-14.4 V-11.6 Q1.5,-12.8 0,-11.6 Q-1.5,-12.8 -3,-11.6 Z" fill={PAPER} stroke={INK} strokeWidth={0.7} />
        </g>
      );
    case 'market':
      return (
        <g>
          <ellipse cx={0} cy={4.3} rx={9} ry={1.9} fill={SHADE} opacity={0.3} />
          <path d="M-7.6,4 V-3.2 M7.6,4 V-3.2" {...stroke} />
          <rect x={-6.4} y={0.4} width={12.8} height={3.6} fill={PAPER} {...stroke} />
          <path d="M-9,-3 L-6,-9 H6 L9,-3 Z" fill={PAPER} {...stroke} />
          <path d="M-6,-9 L-7.5,-3 M-2,-9 L-2.5,-3 M2,-9 L2.5,-3 M6,-9 L7.5,-3" stroke={VERMILION} strokeWidth={1.6} />
          <path d="M-9,-3 q1.5,2 3,0 t3,0 t3,0 t3,0 t3,0 t3,0" fill={PAPER} {...stroke} />
        </g>
      );
    case 'station':
      return (
        <g>
          <ellipse cx={0} cy={4.2} rx={8} ry={1.8} fill={SHADE} opacity={0.3} />
          {house(-1.6, 4, 7, 4.8, '#8a6a34')}
          <path d="M5.6,4 V-11" {...stroke} />
          <path d="M5.6,-11 L11,-9.4 L5.6,-7.8 Z" fill={VERMILION} stroke={INK} strokeWidth={0.6} />
        </g>
      );
    case 'ruin':
      return (
        <g>
          <path d="M-9,4 H9" {...stroke} />
          <path d="M-7,4 V-6 L-6,-7.4 L-5,-6.2 L-4,-7 V4 Z" fill={PAPER} {...stroke} />
          <path d="M-1.6,4 V-10 L-0.4,-11.2 L0.6,-9.6 L1.6,-10.4 V4 Z" fill={PAPER} {...stroke} />
          <path d="M4,4 V-3.2 L5,-4.4 L6.4,-3 V4 Z" fill={PAPER} {...stroke} />
          <path d="M-8.6,-6.8 H-2.4" {...stroke} opacity={0.8} />
          <circle cx={7.8} cy={3} r={1.1} fill={PAPER} {...stroke} />
          <circle cx={-9} cy={2.8} r={0.9} fill={PAPER} {...stroke} />
        </g>
      );
    case 'cave':
      return (
        <g>
          <path d="M-10,4 L-7,-3 L-3.6,-6.4 L0,-8.2 L4,-6.4 L7.4,-2.6 L10,4 Z" fill={PAPER} {...stroke} />
          <path d="M-3.8,4 V0.4 Q0,-4.6 3.8,0.4 V4 Z" fill={INK} />
          <path d="M3.6,-5.4 L6.4,-1.8 M-5.6,-2.8 L-3.4,-5.2" stroke={INK} strokeWidth={0.7} opacity={0.7} />
        </g>
      );
    case 'landmark':
      return (
        <g>
          <ellipse cx={0} cy={4.2} rx={6.4} ry={1.6} fill={SHADE} opacity={0.3} />
          <path d="M-2.6,4 L-1.8,-9 L0,-12.4 L1.8,-9 L2.6,4 Z" fill={PAPER} {...stroke} />
          <path d="M-4.6,4 H4.6 V2.4 H-4.6 Z" fill={PAPER} {...stroke} />
          <path d="M0,-12.4 L1.8,-9 H-1.8 Z" fill={VERMILION} />
          <path d="M6.6,-12 l0.9,2.2 2.2,0.9 -2.2,0.9 -0.9,2.2 -0.9,-2.2 -2.2,-0.9 2.2,-0.9 Z" fill={VERMILION} />
        </g>
      );
    case 'camp':
      return (
        <g>
          <ellipse cx={0} cy={4.2} rx={8} ry={1.6} fill={SHADE} opacity={0.3} />
          <path d="M-7.4,4 L0,-7.6 L7.4,4 Z" fill={PAPER} {...stroke} />
          <path d="M0,-7.6 L-1.8,4 M0,-7.6 L1.8,4" {...stroke} />
          <path d="M0,-7.6 V-12.4 L4.6,-11 L0,-9.6" fill={VERMILION} stroke={INK} strokeWidth={0.7} />
        </g>
      );
    case 'wild':
      return (
        <g>
          <path d="M0,-12 L6,-3 L2.4,4 H-2.4 L-6,-3 Z" fill={PAPER} {...stroke} />
          <path d="M0,-12 L1.8,-3 L0,4 M-6,-3 H6" stroke={INK} strokeWidth={0.7} fill="none" />
          <path d="M0,-12 L6,-3 L1.8,-3 Z" fill={VERMILION} opacity={0.85} />
        </g>
      );
    case 'home':
    default:
      return (
        <g>
          <ellipse cx={0} cy={4.2} rx={7} ry={1.6} fill={SHADE} opacity={0.3} />
          <rect x={3} y={-8.4} width={1.8} height={4} fill={PAPER} {...stroke} />
          {house(0, 4, 8, 5.2)}
          <path d="M3.9,-9.6 q1.4,-1.6 0,-3.2 t0.4,-3" fill="none" stroke={INK} strokeWidth={0.6} opacity={0.6} />
        </g>
      );
  }
}

/** 古卷地貌符号。 */
export function AncientTerrainGlyph({ glyph }: { glyph: Glyph }) {
  const s = glyph.size;
  switch (glyph.kind) {
    case 'mountain': {
      const w = s * 0.95;
      const h = s * (glyph.variant === 2 ? 1.05 : 0.88);
      const peak = glyph.variant === 1 ? -w * 0.12 : w * 0.06;
      return (
        <g transform={`translate(${glyph.x.toFixed(1)},${glyph.y.toFixed(1)})`}>
          <path d={`M${-w},0 L${peak},${-h} L${w * 0.92},0 Z`} fill={PAPER} stroke="none" />
          <path d={`M${peak},${-h} L${w * 0.92},0 L${peak + w * 0.18},0 Q${peak + w * 0.05},${-h * 0.45} ${peak},${-h} Z`} fill={SHADE} opacity={0.62} />
          {glyph.snow && <path d={`M${peak - w * 0.3},${-h * 0.62} L${peak},${-h} L${peak + w * 0.32},${-h * 0.6} L${peak + w * 0.1},${-h * 0.68} L${peak - w * 0.08},${-h * 0.56} Z`} fill="#fbf7ea" stroke={INK} strokeWidth={0.45} />}
          <path d={`M${-w},0 L${peak},${-h} L${w * 0.92},0`} fill="none" stroke={INK} strokeWidth={0.85} strokeLinejoin="round" strokeLinecap="round" />
          <path d={`M${peak - w * 0.18},${-h * 0.42} l${w * 0.12},${-h * 0.14} M${peak + w * 0.34},${-h * 0.3} l${w * 0.1},${h * 0.16}`} stroke={INK} strokeWidth={0.5} opacity={0.6} />
        </g>
      );
    }
    case 'hill':
      return (
        <g transform={`translate(${glyph.x.toFixed(1)},${glyph.y.toFixed(1)})`}>
          <path d={`M${-s},0 Q0,${-s * 0.9} ${s},0`} fill={PAPER} stroke={INK} strokeWidth={0.75} strokeLinecap="round" />
          <path d={`M${s * 0.15},${-s * 0.36} Q${s * 0.55},${-s * 0.25} ${s * 0.75},0`} fill="none" stroke={INK} strokeWidth={0.5} opacity={0.55} />
        </g>
      );
    case 'tree':
      if (glyph.variant === 0) {
        return (
          <g transform={`translate(${glyph.x.toFixed(1)},${glyph.y.toFixed(1)})`}>
            <path d={`M0,${-s * 2.1} L${s * 0.85},${-s * 0.4} H${-s * 0.85} Z`} fill="#c7c48a" stroke={INK} strokeWidth={0.65} strokeLinejoin="round" />
            <path d={`M0,${-s * 0.4} V${s * 0.1}`} stroke={INK} strokeWidth={0.7} />
          </g>
        );
      }
      return (
        <g transform={`translate(${glyph.x.toFixed(1)},${glyph.y.toFixed(1)})`}>
          <path d={`M0,${s * 0.1} V${-s * 0.5}`} stroke={INK} strokeWidth={0.7} />
          <circle cx={0} cy={-s * 1.05} r={s * (glyph.variant === 1 ? 0.82 : 0.66)} fill="#c3c286" stroke={INK} strokeWidth={0.65} />
          <path d={`M${s * 0.15},${-s * 1.5} q${s * 0.35},${s * 0.2} ${s * 0.3},${s * 0.6}`} fill="none" stroke={INK} strokeWidth={0.45} opacity={0.5} />
        </g>
      );
    case 'tuft':
      return (
        <g transform={`translate(${glyph.x.toFixed(1)},${glyph.y.toFixed(1)})`} stroke={INK} strokeWidth={0.6} strokeLinecap="round" opacity={0.85}>
          <path d={`M${-s},0 H${s}`} opacity={0.6} />
          <path d={`M${-s * 0.5},0 l${-s * 0.2},${-s * 0.9} M0,0 V${-s * 1.2} M${s * 0.5},0 l${s * 0.22},${-s * 0.9}`} />
        </g>
      );
    case 'dune':
      return (
        <g transform={`translate(${glyph.x.toFixed(1)},${glyph.y.toFixed(1)})`} fill="none" stroke={INK} strokeWidth={0.6} strokeLinecap="round" opacity={0.7}>
          <path d={`M${-s},0 Q${-s * 0.2},${-s * 0.55} ${s * 0.6},${-s * 0.1}`} />
          {glyph.variant === 1 && <path d={`M${-s * 0.2},${s * 0.4} Q${s * 0.4},${s * 0.05} ${s},${s * 0.35}`} />}
        </g>
      );
    case 'rock':
      return (
        <path transform={`translate(${glyph.x.toFixed(1)},${glyph.y.toFixed(1)})`} d={`M${-s},0 L${-s * 0.5},${-s * 0.9} L${s * 0.4},${-s * 0.8} L${s},0 Z`} fill={PAPER} stroke={INK} strokeWidth={0.6} strokeLinejoin="round" />
      );
    default:
      return null;
  }
}

// ── Modern & sci-fi markers ───────────────────────────────────────────

const MODERN_ICONS: Record<MapLocationKind, LucideIcon> = {
  capital: Crown, city: Building2, town: Store, village: House, fortress: Shield, port: Anchor, temple: Landmark, academy: GraduationCap,
  market: ShoppingBag, station: TrainFront, ruin: Factory, cave: Pickaxe, landmark: Star, camp: Tent, wild: TriangleAlert, home: House,
};
const SCIFI_ICONS: Record<MapLocationKind, LucideIcon> = {
  capital: Crown, city: Building2, town: Store, village: House, fortress: Shield, port: Rocket, temple: Sparkles, academy: Telescope,
  market: ShoppingBag, station: Satellite, ruin: Skull, cave: Pickaxe, landmark: Star, camp: Flag, wild: Radiation, home: House,
};

export function placeIcon(theme: MapTheme, kind: MapLocationKind): LucideIcon {
  return theme === 'scifi' ? SCIFI_ICONS[kind] : MODERN_ICONS[kind];
}

/** 现代标注：聚落用圆点，其余地点用带图标的标注针。 */
export const MODERN_COLORS: Record<MapLocationKind, string> = {
  capital: '#1f2d3d', city: '#33475b', town: '#4b5d70', village: '#5f7183', fortress: '#56657a', port: '#1f78e0', temple: '#8d5bd6',
  academy: '#5a55d6', market: '#ef8a24', station: '#0f9aa8', ruin: '#8a6a4c', cave: '#7c6a5a', landmark: '#d6457a', camp: '#2f9a6b', wild: '#d64a3e', home: '#e0598b',
};

export const SCIFI_COLORS: Record<MapLocationKind, string> = {
  capital: '#ff5cdc', city: '#3ee8ff', town: '#3ee8ff', village: '#7fd8ff', fortress: '#8aa4ff', port: '#3ee8ff', temple: '#c79bff',
  academy: '#8aff6b', market: '#ffb84f', station: '#3ee8ff', ruin: '#ff8a5c', cave: '#ffb84f', landmark: '#e6ff4f', camp: '#4fffc4', wild: '#ff4f6b', home: '#7fd8ff',
};

export function isSettlement(kind: MapLocationKind): boolean {
  return kind === 'capital' || kind === 'city' || kind === 'town' || kind === 'village';
}

export function ModernPlace({ kind, scale = 1 }: { kind: MapLocationKind; scale?: number }) {
  const color = MODERN_COLORS[kind];
  const Icon = MODERN_ICONS[kind];
  if (isSettlement(kind)) {
    const r = kind === 'capital' ? 5.4 : kind === 'city' ? 4.4 : kind === 'town' ? 3.4 : 2.8;
    return (
      <g transform={`scale(${scale})`}>
        <circle r={r + 1.8} fill="#ffffff" opacity={0.95} />
        <circle r={r} fill={kind === 'capital' ? '#ffffff' : color} stroke={color} strokeWidth={kind === 'capital' ? 2 : 0} />
        {kind === 'capital' && <circle r={r * 0.45} fill={color} />}
      </g>
    );
  }
  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx={0} cy={0.4} rx={3.2} ry={1.1} fill="rgba(20,30,40,.25)" />
      <path d="M0,0 C-2.2,-3.6 -7.2,-7.6 -7.2,-12.4 A7.2,7.2 0 1 1 7.2,-12.4 C7.2,-7.6 2.2,-3.6 0,0 Z" fill={color} stroke="#ffffff" strokeWidth={1.3} />
      <Icon x={-4.4} y={-16.8} width={8.8} height={8.8} color="#ffffff" strokeWidth={2.4} />
    </g>
  );
}

function hexPath(r: number): string {
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index - Math.PI / 2;
    return `${(Math.cos(angle) * r).toFixed(2)},${(Math.sin(angle) * r).toFixed(2)}`;
  });
  return `M${points.join(' L')} Z`;
}

/** 古卷符号的顶端与地基半宽（符号单位），选中标记按它们贴合。 */
const ANCIENT_TOP: Record<MapLocationKind, number> = {
  capital: -24, city: -13, town: -10, village: -8, fortress: -15.5, port: -13.5, temple: -16.5, academy: -15.6,
  market: -9.5, station: -11.5, ruin: -11.5, cave: -8.5, landmark: -12.6, camp: -12.6, wild: -12.2, home: -12,
};
const ANCIENT_HALF: Record<MapLocationKind, number> = {
  capital: 15, city: 11, town: 10, village: 8, fortress: 9.5, port: 10, temple: 10, academy: 10,
  market: 9, station: 8, ruin: 9, cave: 10, landmark: 6.4, camp: 8, wild: 6, home: 7,
};

/**
 * 选中标记：古卷在地基下画一圈朱砂虚线椭圆，上方悬一个小箭头；
 * 测绘是标注中心的蓝色光圈；星图是绕信标的虚线六角与四角准星。连路时的起点用琥珀色。
 */
export function SelectionMark({ theme, kind, linking = false }: { theme: MapTheme; kind: MapLocationKind; linking?: boolean }) {
  const className = `map2d-selection map2d-selection--${theme}${linking ? ' is-linking' : ''}`;
  if (theme === 'ancient') {
    const rx = Math.max(9, ANCIENT_HALF[kind] + 4);
    const ry = rx * 0.34;
    const top = ANCIENT_TOP[kind];
    return (
      <g className={className}>
        <ellipse cx={0} cy={4.2} rx={rx + 2.6} ry={ry + 1.4} className="map2d-selection__halo" />
        <ellipse cx={0} cy={4.2} rx={rx} ry={ry} className="map2d-selection__ring" />
        <g className="map2d-selection__arrow"><path d={`M0,${top - 3} L-3.4,${top - 8.6} H3.4 Z`} /></g>
      </g>
    );
  }
  if (theme === 'modern') {
    const settlement = isSettlement(kind);
    const cy = settlement ? 0 : -12.4;
    const r = settlement ? (kind === 'capital' ? 5.4 : kind === 'city' ? 4.4 : 3.6) + 6 : 10.6;
    return (
      <g className={className}>
        <circle cx={0} cy={cy} r={r + 5} className="map2d-selection__halo" />
        <circle cx={0} cy={cy} r={r} className="map2d-selection__ring" />
      </g>
    );
  }
  const r = (kind === 'capital' ? 8.6 : isSettlement(kind) ? 7.2 : 6.4) + (kind === 'capital' ? 9.5 : 6.5);
  const s = r + 2.4;
  const arm = 4.2;
  return (
    <g className={className}>
      <path d={hexPath(r)} className="map2d-selection__ring" />
      <path className="map2d-selection__brackets"
        d={`M${-s},${-s + arm} V${-s} H${-s + arm} M${s - arm},${-s} H${s} V${-s + arm} M${s},${s - arm} V${s} H${s - arm} M${-s + arm},${s} H${-s} V${s - arm}`} />
    </g>
  );
}

export function ScifiPlace({ kind, scale = 1 }: { kind: MapLocationKind; scale?: number }) {
  const color = SCIFI_COLORS[kind];
  const Icon = SCIFI_ICONS[kind];
  const r = kind === 'capital' ? 8.6 : isSettlement(kind) ? 7.2 : 6.4;
  return (
    <g transform={`scale(${scale})`}>
      <path d={hexPath(r + 3.2)} fill="none" stroke={color} strokeWidth={0.6} opacity={0.45} />
      <path d={hexPath(r)} fill="rgba(4, 14, 28, 0.88)" stroke={color} strokeWidth={1.3} />
      <Icon x={-r * 0.55} y={-r * 0.55} width={r * 1.1} height={r * 1.1} color={color} strokeWidth={2.2} />
      {kind === 'capital' && <path d={hexPath(r + 6)} fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="2 3" opacity={0.7} className="map2d-spin" />}
    </g>
  );
}
