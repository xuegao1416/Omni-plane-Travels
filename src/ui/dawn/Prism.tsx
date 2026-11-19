import { memo } from 'react';

/**
 * Dawn-theme centrepiece: a cut crystal prism drawn in SVG. Each facet's
 * lightness follows the site-wide light source (upper left), so the left/top
 * faces are bright and the lower right faces fall into slate shade.
 * viewBox -300..300 to match the Astrolabe it replaces.
 */
export default memo(function Prism({ className = '', variant = 'hall' }: { className?: string; variant?: 'hall' | 'home' | 'mark' }) {
  const id = `dw-prism-${variant}`;
  return (
    <svg className={`dw-prism dw-prism--${variant} ${className}`} viewBox="-300 -300 600 600" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-lit`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e3eee8" />
        </linearGradient>
        <linearGradient id={`${id}-mid`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6f0eb" />
          <stop offset="1" stopColor="#bcd3c9" />
        </linearGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9c3b9" />
          <stop offset="1" stopColor="#7d9e93" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3e3a6" />
          <stop offset="1" stopColor="#b39453" />
        </linearGradient>
        <radialGradient id={`${id}-pool`} cx="0" cy="0" r="1" gradientUnits="objectBoundingBox" fx=".5" fy=".5">
          <stop offset="0" stopColor="#d3b36f" stopOpacity=".32" />
          <stop offset=".55" stopColor="#d3b36f" stopOpacity=".08" />
          <stop offset="1" stopColor="#d3b36f" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Engraved dial behind the crystal: thin slate rings, a gold meridian */}
      <g className="dw-prism__dial">
        <circle r="272" className="dw-prism__ring dw-prism__ring--faint" />
        <circle r="236" className="dw-prism__ring" />
        <circle r="228" className="dw-prism__ring dw-prism__ring--faint" />
        {Array.from({ length: 72 }, (_, index) => {
          const a = (index / 72) * Math.PI * 2;
          const long = index % 6 === 0;
          return <line key={index} x1={Math.cos(a) * 236} y1={Math.sin(a) * 236} x2={Math.cos(a) * (long ? 252 : 244)} y2={Math.sin(a) * (long ? 252 : 244)} className={long ? 'dw-prism__tick is-long' : 'dw-prism__tick'} />;
        })}
        <ellipse rx="200" ry="70" className="dw-prism__ring dw-prism__ring--gold" transform="rotate(-18)" />
      </g>

      {/* Light pooled under the crystal, offset to the lower right (away from the source) */}
      <ellipse cx="34" cy="150" rx="190" ry="46" fill={`url(#${id}-pool)`} className="dw-prism__pool" />

      <g className="dw-prism__body">
        {/* Upper crown */}
        <polygon points="0,-190 -96,-58 -40,-36" fill={`url(#${id}-lit)`} />
        <polygon points="0,-190 -40,-36 44,-36" fill="#f7fbf8" />
        <polygon points="0,-190 44,-36 96,-58" fill={`url(#${id}-mid)`} />
        {/* Girdle band */}
        <polygon points="-96,-58 -40,-36 -40,-6 -96,-24" fill="#eef5f1" />
        <polygon points="-40,-36 44,-36 44,-6 -40,-6" fill="#dceae3" />
        <polygon points="44,-36 96,-58 96,-24 44,-6" fill={`url(#${id}-shade)`} />
        {/* Pavilion */}
        <polygon points="-96,-24 -40,-6 0,170" fill={`url(#${id}-mid)`} />
        <polygon points="-40,-6 44,-6 0,170" fill="#c3d8cf" />
        <polygon points="44,-6 96,-24 0,170" fill={`url(#${id}-shade)`} />
        {/* Facet edges */}
        <g className="dw-prism__edges">
          <polyline points="0,-190 -96,-58 -96,-24 0,170 96,-24 96,-58 0,-190" />
          <polyline points="-96,-58 -40,-36 44,-36 96,-58" />
          <polyline points="-96,-24 -40,-6 44,-6 96,-24" />
          <line x1="0" y1="-190" x2="-40" y2="-36" /><line x1="0" y1="-190" x2="44" y2="-36" />
          <line x1="-40" y1="-36" x2="-40" y2="-6" /><line x1="44" y1="-36" x2="44" y2="-6" />
          <line x1="-40" y1="-6" x2="0" y2="170" /><line x1="44" y1="-6" x2="0" y2="170" />
        </g>
        {/* Gold girdle inlay */}
        <polyline points="-96,-41 -40,-21 44,-21 96,-41" className="dw-prism__inlay" stroke={`url(#${id}-gold)`} />
        {/* Specular glint on the lit crown face; it sweeps by opacity only */}
        <polygon points="-8,-170 -70,-66 -52,-58" className="dw-prism__glint" />
      </g>
    </svg>
  );
});
