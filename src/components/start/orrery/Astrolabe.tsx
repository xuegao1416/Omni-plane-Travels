import { memo } from 'react';

const GLYPHS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];
const PLANE_RUNES = ['界', '渡', '星', '门', '潮', '轨'];

function ticks(count: number, r1: number, r2: number, every = 0, r3 = r2) {
  return Array.from({ length: count }, (_, index) => {
    const a = (index / count) * Math.PI * 2;
    const long = every > 0 && index % every === 0;
    const outer = long ? r3 : r2;
    return (
      <line
        key={index}
        x1={Math.cos(a) * r1} y1={Math.sin(a) * r1}
        x2={Math.cos(a) * outer} y2={Math.sin(a) * outer}
        className={long ? 'pl-astro__tick is-long' : 'pl-astro__tick'}
      />
    );
  });
}

/**
 * The navigator at the centre of the orrery. Pure SVG; every ring is a
 * separately rotating group so motion reads as a mechanism, not a spinner.
 * Sized by its container (viewBox -300..300).
 */
export default memo(function Astrolabe({ className = '', variant = 'hall' }: { className?: string; variant?: 'hall' | 'home' | 'ritual' }) {
  return (
    <svg className={`pl-astro pl-astro--${variant} ${className}`} viewBox="-300 -300 600 600" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`pl-astro-core-${variant}`} cx="0" cy="0" r="1" gradientUnits="objectBoundingBox" fx=".5" fy=".5">
          <stop offset="0" stopColor="#fff4d6" stopOpacity=".95" />
          <stop offset=".18" stopColor="#f2c97a" stopOpacity=".7" />
          <stop offset=".5" stopColor="#7a5a2a" stopOpacity=".18" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`pl-astro-brass-${variant}`} x1="-1" y1="-1" x2="1" y2="1" gradientUnits="userSpaceOnUse" gradientTransform="scale(300)">
          <stop offset="0" stopColor="#f7deA0" />
          <stop offset=".45" stopColor="#c79a4b" />
          <stop offset="1" stopColor="#7c5a26" />
        </linearGradient>
        <path id={`pl-astro-text-${variant}`} d="M -199 0 A 199 199 0 1 1 199 0 A 199 199 0 1 1 -199 0" />
      </defs>

      {/* Outer fixed limb */}
      <g className="pl-astro__limb">
        <circle r="286" className="pl-astro__ring pl-astro__ring--faint" />
        <circle r="272" className="pl-astro__ring" />
        {ticks(180, 272, 278, 5, 286)}
      </g>

      {/* Slow outer dial: hour numerals */}
      <g className="pl-astro__spin pl-astro__spin--slow">
        <circle r="258" className="pl-astro__ring pl-astro__ring--thin" />
        <circle r="214" className="pl-astro__ring pl-astro__ring--thin" />
        {GLYPHS.map((glyph, index) => {
          const a = (index / GLYPHS.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <text key={glyph} x={Math.cos(a) * 236} y={Math.sin(a) * 236} className="pl-astro__glyph" transform={`rotate(${(index / GLYPHS.length) * 360} ${Math.cos(a) * 236} ${Math.sin(a) * 236})`}>
              {glyph}
            </text>
          );
        })}
        {ticks(72, 214, 220)}
      </g>

      {/* Counter-rotating inscription band */}
      <g className="pl-astro__spin pl-astro__spin--reverse">
        <text className="pl-astro__inscription">
          <textPath href={`#pl-astro-text-${variant}`} startOffset="0">
            OMNI · PLANE · TRAVELS · ATLAS OF CROSSINGS · 万界渡行 · NAVIGATOR OF PLANES · 星轨即航路 ·
          </textPath>
        </text>
      </g>

      {/* Rete: the star pointer lattice */}
      <g className="pl-astro__spin pl-astro__spin--rete">
        <circle r="190" className="pl-astro__ring pl-astro__ring--dashed" />
        <ellipse rx="190" ry="118" className="pl-astro__ring pl-astro__ring--thin" transform="rotate(24)" />
        <ellipse rx="190" ry="118" className="pl-astro__ring pl-astro__ring--thin" transform="rotate(-36)" />
        {PLANE_RUNES.map((rune, index) => {
          const a = (index / PLANE_RUNES.length) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(a) * 160;
          const y = Math.sin(a) * 160;
          return (
            <g key={rune} transform={`translate(${x} ${y})`}>
              <path d="M 0 -15 L 6 0 L 0 15 L -6 0 Z" className="pl-astro__pointer" transform={`rotate(${(index / PLANE_RUNES.length) * 360})`} />
              <text className="pl-astro__rune" y="4.5">{rune}</text>
            </g>
          );
        })}
      </g>

      {/* Fast inner gimbal */}
      <g className="pl-astro__spin pl-astro__spin--fast">
        <circle r="118" className="pl-astro__ring" />
        {ticks(48, 118, 126, 4, 132)}
        <path d="M 0 -132 L 9 -100 L 0 -108 L -9 -100 Z" className="pl-astro__pointer is-bright" />
      </g>

      <g className="pl-astro__spin pl-astro__spin--wobble">
        <ellipse rx="98" ry="34" className="pl-astro__ring pl-astro__ring--aether" />
        <ellipse rx="98" ry="34" className="pl-astro__ring pl-astro__ring--aether" transform="rotate(60)" />
        <ellipse rx="98" ry="34" className="pl-astro__ring pl-astro__ring--aether" transform="rotate(120)" />
      </g>

      {/* Core */}
      <circle r="150" fill={`url(#pl-astro-core-${variant})`} className="pl-astro__corona" />
      <circle r="44" className="pl-astro__hub" stroke={`url(#pl-astro-brass-${variant})`} />
      <circle r="10" className="pl-astro__heart" />
    </svg>
  );
});
