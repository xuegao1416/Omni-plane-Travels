/**
 * Battlefield floor overlay.
 *
 * Canvas is 1600x900, laid out with `xMidYMax slice` so the bottom edge is
 * always visible. The arena (an engraved brass astrolabe set into the floor)
 * sits in the lower third where the units stand, over the painted plate.
 */
import { useMemo } from 'react';

export const W = 1600;
export const H = 900;

/** Scene-scoped gradient id so scenes never collide in one document. */
export const gid = (scene: string, name: string) => `bb-${scene}-${name}`;

type Stop = [offset: number, color: string, opacity?: number];

export function Radial({ id, stops, cx = .5, cy = .5, r = .5 }: { id: string; stops: Stop[]; cx?: number; cy?: number; r?: number }) {
  return <radialGradient id={id} cx={cx} cy={cy} r={r}>{stops.map(([o, c, a], i) => <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />)}</radialGradient>;
}

/**
 * The astrolabe floor: concentric engraved rings, a 72-step degree scale,
 * zodiac-like cartouches at the quarters and a lit pool at the centre.
 * Foreshortened into the floor plane so units read as standing on it.
 */
export function Arena({ scene, tone, pool, o = 1 }: { scene: string; tone: string; pool: string; o?: number }) {
  const cx = 800;
  const cy = 752;
  const rx = 660;
  const ry = 124;
  const id = gid(scene, 'pool');
  const ring = (k: number) => ({ rx: rx * k, ry: ry * k });
  const scale = useMemo(() => Array.from({ length: 72 }, (_, i) => {
    const t = (i / 72) * Math.PI * 2;
    const k1 = .88;
    const k2 = i % 6 === 0 ? .8 : .845;
    return `M${cx + Math.cos(t) * rx * k1} ${cy + Math.sin(t) * ry * k1}L${cx + Math.cos(t) * rx * k2} ${cy + Math.sin(t) * ry * k2}`;
  }).join(''), []);
  const spokes = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const t = (i / 12) * Math.PI * 2;
    return `M${cx + Math.cos(t) * rx * .24} ${cy + Math.sin(t) * ry * .24}L${cx + Math.cos(t) * rx * .62} ${cy + Math.sin(t) * ry * .62}`;
  }).join(''), []);
  return <g opacity={o}>
    <defs><Radial id={id} stops={[[0, pool, .3], [.55, pool, .09], [1, pool, 0]]} /></defs>
    <ellipse cx={cx} cy={cy} rx={rx * 1.1} ry={ry * 1.6} fill={`url(#${id})`} />
    <g fill="none" stroke={tone}>
      <ellipse cx={cx} cy={cy} {...ring(1)} strokeOpacity=".22" strokeWidth="2" />
      <ellipse cx={cx} cy={cy} {...ring(.965)} strokeOpacity=".12" />
      <path d={scale} strokeOpacity=".24" />
      <ellipse cx={cx} cy={cy} {...ring(.72)} strokeOpacity=".14" strokeDasharray="1 9" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx={cx} cy={cy} {...ring(.62)} strokeOpacity=".1" />
      <path d={spokes} strokeOpacity=".07" />
      <ellipse cx={cx} cy={cy} {...ring(.24)} strokeOpacity=".2" />
      <ellipse cx={cx} cy={cy} {...ring(.18)} strokeOpacity=".1" />
    </g>
    {/* Quarter cartouches */}
    <g fill={tone}>
      {[0, 1, 2, 3].map(i => {
        const t = (i / 4) * Math.PI * 2;
        const x = cx + Math.cos(t) * rx;
        const y = cy + Math.sin(t) * ry;
        return <g key={i} opacity=".45"><path d={`M${x} ${y - 6}l9 6-9 6-9-6z`} /><path d={`M${x - 18} ${y}h-10M${x + 18} ${y}h10`} stroke={tone} strokeWidth="1" /></g>;
      })}
    </g>
  </g>;
}
