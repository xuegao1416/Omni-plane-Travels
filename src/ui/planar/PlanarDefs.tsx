/**
 * Shared SVG paint servers and filters for the planar kit. Mounted once at
 * the document root; every kit SVG references these ids so metal, gems and
 * relief stay consistent and are defined a single time.
 */
export default function PlanarDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        {/* Polished brass: banded so it reads as turned metal, not a flat yellow. */}
        <linearGradient id="pk-brass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3cf" />
          <stop offset=".18" stopColor="#ecca86" />
          <stop offset=".42" stopColor="#a97a35" />
          <stop offset=".6" stopColor="#f3d899" />
          <stop offset=".82" stopColor="#b8883f" />
          <stop offset="1" stopColor="#5e3f15" />
        </linearGradient>
        <linearGradient id="pk-brass-v" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1c8" />
          <stop offset=".35" stopColor="#e2bb72" />
          <stop offset=".55" stopColor="#9c6e2e" />
          <stop offset="1" stopColor="#e8c983" />
        </linearGradient>
        <linearGradient id="pk-brass-dark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7a5524" />
          <stop offset=".5" stopColor="#3d2808" />
          <stop offset="1" stopColor="#6b4a1c" />
        </linearGradient>

        {/* Gems */}
        <radialGradient id="pk-gem-amber" cx=".38" cy=".32" r=".75">
          <stop offset="0" stopColor="#fffbe8" />
          <stop offset=".18" stopColor="#ffd98a" />
          <stop offset=".5" stopColor="#d48a2a" />
          <stop offset=".85" stopColor="#5e2c06" />
          <stop offset="1" stopColor="#2a1203" />
        </radialGradient>
        <radialGradient id="pk-gem-garnet" cx=".38" cy=".32" r=".75">
          <stop offset="0" stopColor="#ffe9e4" />
          <stop offset=".18" stopColor="#ff8f80" />
          <stop offset=".5" stopColor="#b2303a" />
          <stop offset=".85" stopColor="#4a0c14" />
          <stop offset="1" stopColor="#200409" />
        </radialGradient>
        <radialGradient id="pk-gem-sapphire" cx=".38" cy=".32" r=".75">
          <stop offset="0" stopColor="#eef4ff" />
          <stop offset=".18" stopColor="#9db8ff" />
          <stop offset=".5" stopColor="#3550b0" />
          <stop offset=".85" stopColor="#0f1848" />
          <stop offset="1" stopColor="#060a22" />
        </radialGradient>

        {/* Enamel disc behind seal glyphs */}
        <radialGradient id="pk-enamel" cx=".5" cy=".38" r=".7">
          <stop offset="0" stopColor="#24305a" />
          <stop offset=".7" stopColor="#0d1430" />
          <stop offset="1" stopColor="#050815" />
        </radialGradient>
        <radialGradient id="pk-enamel-danger" cx=".5" cy=".38" r=".7">
          <stop offset="0" stopColor="#5a1a22" />
          <stop offset=".7" stopColor="#2c0a10" />
          <stop offset="1" stopColor="#140306" />
        </radialGradient>

        {/* Wine velvet for ribbons */}
        <linearGradient id="pk-velvet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a1219" />
          <stop offset=".3" stopColor="#8a2d34" />
          <stop offset=".55" stopColor="#6b1e26" />
          <stop offset="1" stopColor="#36090f" />
        </linearGradient>
        <linearGradient id="pk-velvet-fold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a060b" />
          <stop offset=".5" stopColor="#4d1018" />
          <stop offset="1" stopColor="#1c0306" />
        </linearGradient>

        {/* Raised metal: specular light from the upper left over the alpha relief. */}
        <filter id="pk-emboss" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="blur" />
          <feSpecularLighting in="blur" surfaceScale="3.2" specularConstant=".95" specularExponent="22" lightingColor="#fff4d8" result="spec">
            <fePointLight x="-60" y="-80" z="120" />
          </feSpecularLighting>
          <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
          <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3=".75" k4="0" result="lit" />
          <feDropShadow dx="0" dy="1.2" stdDeviation=".8" floodColor="#000" floodOpacity=".75" />
          <feMerge><feMergeNode /><feMergeNode in="lit" /></feMerge>
        </filter>
        <filter id="pk-gem-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.4" result="g" />
          <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="pk-cloth-shadow" x="-10%" y="-30%" width="120%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity=".6" />
        </filter>
      </defs>
    </svg>
  );
}
