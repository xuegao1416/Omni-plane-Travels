import { memo,type CSSProperties } from 'react';

/** Logo glyphs; null is the crystal gem between OMNI and PLANE. */
const LOGO = ['O', 'M', 'N', 'I', null, 'P', 'L', 'A', 'N', 'E'] as const;
/** Glyphs whose polished edge throws a star glint (index into LOGO). */
const GLINTS = new Set([0, 3, 7]);

const order = (i: number) => ({ '--i': i } as CSSProperties);

/**
 * 晨雾琉璃 title lockup over the 3D rotunda. Every glyph is its own gilded
 * element so the logo can assemble letter by letter, ripple with light and
 * scatter upward on the warp. A transparent copy of the glyphs on top carries
 * the light: per-letter sheen and star glints animate there by opacity and
 * transform only, outside the drop-shadow filter of the gold layer.
 */
export default memo(function DawnTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  const glyphs = (layer: 'gold' | 'light') => LOGO.map((ch, i) => (ch === null
    ? <i key={i} className={`dw-logo__gem${layer === 'light' ? ' dw-logo__gem--light' : ''}`} style={order(i)} />
    : <span key={i} className={`dw-logo__ch${layer === 'light' && GLINTS.has(i) ? ' has-glint' : ''}`} style={order(i)}>{ch}</span>));
  return (
    <section className="pl-home__title dw-title">
      <span className="pl-home__eyebrow dw-title__eyebrow">{eyebrow}</span>
      <h1 id="pl-home-title" className="dw-title__h1" aria-label="OMNI·PLANE TRAVELS">
        <span className="dw-logo" aria-hidden="true">
          <span className="pl-home__latin dw-logo__gold">{glyphs('gold')}</span>
          <span className="pl-home__latin dw-logo__light">{glyphs('light')}</span>
        </span>
        <span className="pl-home__latin pl-home__latin--sub dw-title__sub" aria-hidden="true">TRAVELS</span>
      </h1>
      <span className="pl-home__rule dw-title__rule" aria-hidden="true"><span /></span>
      <p className="pl-home__cn dw-title__cn">
        <span className="pl-sr-only">{title}</span>
        {Array.from(title).map((ch, i) => <span key={i} aria-hidden="true" style={order(i)}>{ch}</span>)}
      </p>
      <p className="pl-home__motto dw-title__motto">{subtitle}</p>
    </section>
  );
});
