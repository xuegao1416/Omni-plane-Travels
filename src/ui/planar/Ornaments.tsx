/**
 * Hand-drawn SVG ornaments for the planar kit. All paint comes from the
 * shared ids in PlanarDefs (pk-brass, pk-emboss, pk-gem-*), so a frame corner,
 * a seal and a ribbon read as the same metal and the same light.
 */
import type { CSSProperties, ReactNode } from 'react';

type Gem = 'amber' | 'garnet' | 'sapphire';

/** Top-left frame corner; the other three are CSS mirrors of this one. */
export function FrameCorner({ gem = 'amber', className = '' }: { gem?: Gem; className?: string }) {
  // One arm is drawn along the top edge; the diagonal mirror produces the left arm.
  const arm = (
    <>
      {/* Acanthus scroll curling off the rosette along the edge */}
      <path d="M21 12.5 C27 4.5 37 5 39.5 11 C41.5 16 36.5 19.5 33 17.5 C30.5 16 31.5 12.5 34 13" fill="none" stroke="url(#pk-brass)" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M39.5 11 C45 8.5 51 9.5 56 12.5" fill="none" stroke="url(#pk-brass)" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M27 9 C29 6.5 32 6 34 7" fill="none" stroke="#fff3cf" strokeOpacity=".55" strokeWidth=".6" strokeLinecap="round" />
      {/* Leaf tip */}
      <path d="M56 12.5 C59 10 62 10.5 64 12 C61.5 13.5 59 14 56 12.5 Z" fill="url(#pk-brass)" />
      {/* Bead run */}
      <circle cx="46" cy="16.5" r="1" fill="url(#pk-brass)" />
      <circle cx="51" cy="17" r=".8" fill="url(#pk-brass)" />
      <circle cx="55.5" cy="17.2" r=".6" fill="url(#pk-brass)" />
    </>
  );
  return (
    <svg className={`pk-corner ${className}`} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g filter="url(#pk-emboss)">
        {/* Outer and inner mitred rails */}
        <path d="M3 64 V13 Q3 3 13 3 H64" fill="none" stroke="url(#pk-brass)" strokeWidth="2.6" />
        <path d="M9.5 64 V19 Q9.5 9.5 19 9.5 H64" fill="none" stroke="url(#pk-brass-v)" strokeWidth="1" />
        {arm}
        <g transform="matrix(0 1 1 0 0 0)">{arm}</g>
        {/* Rosette */}
        <circle cx="14" cy="14" r="8.6" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1.8" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return <circle key={i} cx={14 + Math.cos(a) * 6.2} cy={14 + Math.sin(a) * 6.2} r=".9" fill="url(#pk-brass)" />;
        })}
      </g>
      <circle cx="14" cy="14" r="3.6" fill={`url(#pk-gem-${gem})`} filter="url(#pk-gem-glow)" />
      <circle cx="12.9" cy="12.8" r="1" fill="#fff" opacity=".85" />
    </svg>
  );
}

/** Crest that sits on the top edge of panel frames. */
export function FrameCrest({ gem = 'amber', className = '' }: { gem?: Gem; className?: string }) {
  return (
    <svg className={`pk-crest ${className}`} viewBox="0 0 160 34" aria-hidden="true" focusable="false">
      <g filter="url(#pk-emboss)">
        <path d="M0 22 H44 C54 22 58 14 66 10" fill="none" stroke="url(#pk-brass)" strokeWidth="1.6" />
        <path d="M160 22 H116 C106 22 102 14 94 10" fill="none" stroke="url(#pk-brass)" strokeWidth="1.6" />
        <path d="M30 22 C36 15 46 15 47 20 C48 24 42 25 41 22" fill="none" stroke="url(#pk-brass)" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M130 22 C124 15 114 15 113 20 C112 24 118 25 119 22" fill="none" stroke="url(#pk-brass)" strokeWidth="1.3" strokeLinecap="round" />
        {/* Lunette */}
        <path d="M58 24 C58 10 68 3 80 3 C92 3 102 10 102 24 Z" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1.8" />
        <path d="M64 24 C64 14 71 8.5 80 8.5 C89 8.5 96 14 96 24" fill="none" stroke="url(#pk-brass-v)" strokeWidth=".9" />
        {Array.from({ length: 7 }, (_, i) => {
          const a = Math.PI + (i / 6) * Math.PI;
          return <line key={i} x1={80 + Math.cos(a) * 9} y1={24 + Math.sin(a) * 9} x2={80 + Math.cos(a) * 13} y2={24 + Math.sin(a) * 13} stroke="url(#pk-brass)" strokeWidth=".9" />;
        })}
        <path d="M74 31 L80 26 L86 31 L80 34 Z" fill="url(#pk-brass)" />
      </g>
      <circle cx="80" cy="18" r="4.4" fill={`url(#pk-gem-${gem})`} filter="url(#pk-gem-glow)" />
      <circle cx="78.6" cy="16.6" r="1.2" fill="#fff" opacity=".85" />
    </svg>
  );
}

/** Small finial for the bottom edge and side midpoints. */
export function FrameStud({ className = '' }: { className?: string }) {
  return (
    <svg className={`pk-stud ${className}`} viewBox="0 0 40 14" aria-hidden="true" focusable="false">
      <g filter="url(#pk-emboss)">
        <path d="M0 7 H12 M28 7 H40" stroke="url(#pk-brass)" strokeWidth="1.2" />
        <path d="M12 7 C15 2 18 2 20 1 C22 2 25 2 28 7 C25 12 22 12 20 13 C18 12 15 12 12 7 Z" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1.2" />
      </g>
      <circle cx="20" cy="7" r="2.2" fill="url(#pk-gem-amber)" />
    </svg>
  );
}

/** Wax-and-brass seal used as the emblem of dialogs and notices. */
export function Seal({ tone = 'brass', children, size = 64, style }: { tone?: 'brass' | 'danger'; children?: ReactNode; size?: number; style?: CSSProperties }) {
  const teeth = 24;
  const scallop = Array.from({ length: teeth * 2 }, (_, i) => {
    const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 30 : 27.4;
    return `${(32 + Math.cos(a) * r).toFixed(2)},${(32 + Math.sin(a) * r).toFixed(2)}`;
  }).join(' ');
  return (
    <span className={`pk-seal pk-seal--${tone}`} style={{ '--pk-seal-size': `${size}px`, ...style } as CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <g filter="url(#pk-emboss)">
          <polygon points={scallop} fill="url(#pk-brass)" />
          <circle cx="32" cy="32" r="24.5" fill="url(#pk-brass-dark)" />
          <circle cx="32" cy="32" r="23" fill={tone === 'danger' ? 'url(#pk-enamel-danger)' : 'url(#pk-enamel)'} stroke="url(#pk-brass-v)" strokeWidth="1.2" />
          <circle cx="32" cy="32" r="18.5" fill="none" stroke="url(#pk-brass)" strokeWidth=".7" strokeDasharray="1.2 2.2" />
        </g>
        <ellipse cx="26" cy="22" rx="9" ry="4.5" fill="#fff" opacity=".07" transform="rotate(-28 26 22)" />
      </svg>
      <span className="pk-seal__glyph">{children}</span>
    </span>
  );
}

/**
 * Bezel-only mirror frame (same 140×190 geometry as IdentityMirror) to lay over
 * a live portrait. The glass opening is an ellipse at cx 70, cy 80, rx 46, ry 62,
 * i.e. 34.3%..65.7% horizontally and 9.5%..74.7% vertically of the box.
 */
export function MirrorBezel({ className = '' }: { className?: string }) {
  return (
    <svg className={`pk-mirror-bezel ${className}`} viewBox="0 0 140 190" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="pk-mirror-vignette" cx=".5" cy=".42" r=".55">
          <stop offset=".72" stopColor="#050815" stopOpacity="0" />
          <stop offset="1" stopColor="#050815" stopOpacity=".7" />
        </radialGradient>
      </defs>
      <ellipse cx="70" cy="80" rx="46" ry="62" fill="url(#pk-mirror-vignette)" />
      <path d="M36 50 C42 32 58 22 74 21" stroke="#fff" strokeOpacity=".14" strokeWidth="5" strokeLinecap="round" fill="none" />
      <g filter="url(#pk-emboss)">
        <ellipse cx="70" cy="80" rx="50" ry="66" fill="none" stroke="url(#pk-brass)" strokeWidth="5" />
        <ellipse cx="70" cy="80" rx="46.5" ry="62.5" fill="none" stroke="url(#pk-brass-v)" strokeWidth="1.2" />
        <ellipse cx="70" cy="80" rx="53.5" ry="69.5" fill="none" stroke="url(#pk-brass)" strokeWidth=".8" strokeDasharray="1.4 2.4" />
        <path d="M58 16 C60 8 66 4 70 2 C74 4 80 8 82 16 C76 13 64 13 58 16 Z" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1.2" />
        <path d="M48 20 C52 12 60 12 62 16 M92 20 C88 12 80 12 78 16" stroke="url(#pk-brass)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M18 74 C12 70 12 62 18 60 C22 59 23 64 20 65 M122 74 C128 70 128 62 122 60 C118 59 117 64 120 65" stroke="url(#pk-brass)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M18 92 C12 96 12 104 18 106 C22 107 23 102 20 101 M122 92 C128 96 128 104 122 106 C118 107 117 102 120 101" stroke="url(#pk-brass)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M62 146 L66 160 H74 L78 146 Z" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1" />
        <path d="M40 176 C48 164 60 160 70 160 C80 160 92 164 100 176 Z" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1.3" />
        <path d="M34 178 H106" stroke="url(#pk-brass)" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <circle cx="70" cy="10" r="3.4" fill="url(#pk-gem-amber)" filter="url(#pk-gem-glow)" />
      <circle cx="69" cy="9" r=".9" fill="#fff" opacity=".85" />
      <circle cx="70" cy="168" r="2.6" fill="url(#pk-gem-sapphire)" />
    </svg>
  );
}

/**
 * The identity mirror: an oval brass looking-glass on a small stand, holding a
 * starlit traveller silhouette. Replaces the bitmap portrait placeholders.
 */
export function IdentityMirror({ className = '', title }: { className?: string; title?: string }) {
  const stars = [[42, 46, 1.1], [78, 38, .8], [96, 62, 1.2], [36, 88, .7], [104, 98, .9], [58, 30, .6], [88, 120, .7], [30, 128, .9], [70, 64, .5]];
  return (
    <svg className={`pk-mirror ${className}`} viewBox="0 0 140 190" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <defs>
        <radialGradient id="pk-mirror-glass" cx=".5" cy=".38" r=".7">
          <stop offset="0" stopColor="#1f2c58" />
          <stop offset=".6" stopColor="#0c1330" />
          <stop offset="1" stopColor="#050815" />
        </radialGradient>
        <linearGradient id="pk-mirror-figure" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe7b5" stopOpacity=".55" />
          <stop offset=".55" stopColor="#c9a766" stopOpacity=".22" />
          <stop offset="1" stopColor="#c9a766" stopOpacity="0" />
        </linearGradient>
        <clipPath id="pk-mirror-clip"><ellipse cx="70" cy="80" rx="46" ry="62" /></clipPath>
      </defs>
      {/* Glass */}
      <ellipse cx="70" cy="80" rx="46" ry="62" fill="url(#pk-mirror-glass)" />
      <g clipPath="url(#pk-mirror-clip)">
        {stars.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#fff6dc" opacity={.4 + (i % 3) * .2} />)}
        {/* Traveller silhouette: head, cloak and shoulders in starlight */}
        <path d="M70 52 C80 52 86 60 86 70 C86 80 79 88 70 88 C61 88 54 80 54 70 C54 60 60 52 70 52 Z" fill="url(#pk-mirror-figure)" stroke="#f2d48e" strokeOpacity=".55" strokeWidth=".8" />
        <path d="M30 150 C32 118 48 100 70 98 C92 100 108 118 110 150 Z" fill="url(#pk-mirror-figure)" stroke="#f2d48e" strokeOpacity=".5" strokeWidth=".8" />
        <path d="M70 98 L70 140 M58 104 C62 116 66 126 70 140 M82 104 C78 116 74 126 70 140" stroke="#f2d48e" strokeOpacity=".3" strokeWidth=".6" fill="none" />
        {/* Glass sheen */}
        <path d="M36 50 C42 32 58 22 74 21" stroke="#fff" strokeOpacity=".16" strokeWidth="5" strokeLinecap="round" fill="none" />
      </g>
      <g filter="url(#pk-emboss)">
        {/* Bezel: outer rope rail, inner bead rail */}
        <ellipse cx="70" cy="80" rx="50" ry="66" fill="none" stroke="url(#pk-brass)" strokeWidth="5" />
        <ellipse cx="70" cy="80" rx="46.5" ry="62.5" fill="none" stroke="url(#pk-brass-v)" strokeWidth="1.2" />
        <ellipse cx="70" cy="80" rx="53.5" ry="69.5" fill="none" stroke="url(#pk-brass)" strokeWidth=".8" strokeDasharray="1.4 2.4" />
        {/* Crest finial */}
        <path d="M58 16 C60 8 66 4 70 2 C74 4 80 8 82 16 C76 13 64 13 58 16 Z" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1.2" />
        <path d="M48 20 C52 12 60 12 62 16 M92 20 C88 12 80 12 78 16" stroke="url(#pk-brass)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        {/* Side scrolls */}
        <path d="M18 74 C12 70 12 62 18 60 C22 59 23 64 20 65 M122 74 C128 70 128 62 122 60 C118 59 117 64 120 65" stroke="url(#pk-brass)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        <path d="M18 92 C12 96 12 104 18 106 C22 107 23 102 20 101 M122 92 C128 96 128 104 122 106 C118 107 117 102 120 101" stroke="url(#pk-brass)" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        {/* Stand */}
        <path d="M62 146 L66 160 H74 L78 146 Z" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1" />
        <path d="M40 176 C48 164 60 160 70 160 C80 160 92 164 100 176 Z" fill="url(#pk-brass-dark)" stroke="url(#pk-brass)" strokeWidth="1.3" />
        <path d="M34 178 H106" stroke="url(#pk-brass)" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <circle cx="70" cy="10" r="3.4" fill="url(#pk-gem-amber)" filter="url(#pk-gem-glow)" />
      <circle cx="69" cy="9" r=".9" fill="#fff" opacity=".85" />
      <circle cx="70" cy="168" r="2.6" fill="url(#pk-gem-sapphire)" />
    </svg>
  );
}

/** Velvet ribbon banner with forked tails, for titles that hang over a frame edge. */
export function Ribbon({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`pk-ribbon ${className}`}>
      <svg className="pk-ribbon__tail pk-ribbon__tail--l" viewBox="0 0 34 40" aria-hidden="true" focusable="false" preserveAspectRatio="none">
        <g filter="url(#pk-cloth-shadow)">
          <path d="M34 6 H4 L13 20 L4 34 H34 Z" fill="url(#pk-velvet)" />
          <path d="M34 6 L26 0 V6 Z M34 34 L26 40 V34 Z" fill="url(#pk-velvet-fold)" />
          <path d="M34 9 H9 M34 31 H9" stroke="url(#pk-brass)" strokeWidth=".8" />
        </g>
      </svg>
      <span className="pk-ribbon__band">{children}</span>
      <svg className="pk-ribbon__tail pk-ribbon__tail--r" viewBox="0 0 34 40" aria-hidden="true" focusable="false" preserveAspectRatio="none">
        <g filter="url(#pk-cloth-shadow)">
          <path d="M0 6 H30 L21 20 L30 34 H0 Z" fill="url(#pk-velvet)" />
          <path d="M0 6 L8 0 V6 Z M0 34 L8 40 V34 Z" fill="url(#pk-velvet-fold)" />
          <path d="M0 9 H25 M0 31 H25" stroke="url(#pk-brass)" strokeWidth=".8" />
        </g>
      </svg>
    </span>
  );
}
