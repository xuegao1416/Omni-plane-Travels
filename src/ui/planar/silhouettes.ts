/**
 * Code-drawn traveller silhouettes (male / female / neutral), returned as SVG
 * data URLs so every consumer that expects an image `src` keeps working.
 * Starlit figure on night enamel: a brass rim light, a soft aura, and a few
 * stars, matching the planar kit's mirror.
 */
type SilhouetteKind = 'male' | 'female' | 'neutral';

const FIGURES: Record<SilhouetteKind, string> = {
  // Short hair, broad shoulders, high collar
  male: `
    <path d="M100 46c19 0 32 14 32 33 0 10-3 19-8 25 2 6 1 12-2 16-6 8-14 12-22 12s-16-4-22-12c-3-4-4-10-2-16-5-6-8-15-8-25 0-19 13-33 32-33z"/>
    <path d="M100 40c22 0 38 14 38 32 0 6-1 10-3 14-4-14-16-24-35-24s-31 10-35 24c-2-4-3-8-3-14 0-18 16-32 38-32z" opacity=".9"/>
    <path d="M86 128h28l4 18c26 6 46 22 52 54H30c6-32 26-48 52-54z"/>`,
  // Long hair falling past the shoulders, narrower frame
  female: `
    <path d="M100 48c18 0 30 14 30 32 0 10-3 18-7 24 1 6 0 11-3 15-5 7-13 11-20 11s-15-4-20-11c-3-4-4-9-3-15-4-6-7-14-7-24 0-18 12-32 30-32z"/>
    <path d="M100 38c26 0 42 18 42 42 0 22-4 40-2 58-10-6-16-18-18-30 6-8 8-18 8-28 0-18-12-30-30-30s-30 12-30 30c0 10 2 20 8 28-2 12-8 24-18 30 2-18-2-36-2-58 0-24 16-42 42-42z" opacity=".9"/>
    <path d="M88 128h24l3 16c26 8 44 26 50 56H35c6-30 24-48 50-56z"/>`,
  // Hooded cloak
  neutral: `
    <path d="M100 52c17 0 28 13 28 30 0 9-3 17-7 22 1 6 0 10-3 14-5 7-11 10-18 10s-13-3-18-10c-3-4-4-8-3-14-4-5-7-13-7-22 0-17 11-30 28-30z"/>
    <path d="M100 30c30 0 48 22 48 50 0 20-6 36-14 46l-6-6c6-10 10-24 10-38 0-24-16-40-38-40S62 58 62 82c0 14 4 28 10 38l-6 6c-8-10-14-26-14-46 0-28 18-50 48-50z" opacity=".9"/>
    <path d="M100 124c30 0 52 10 62 22 8 14 12 32 14 54H24c2-22 6-40 14-54 10-12 32-22 62-22z"/>`,
};

const STARS = [[38, 44, 1.4], [162, 36, 1], [150, 92, 1.2], [44, 118, .9], [170, 150, 1.1], [64, 24, .8], [134, 18, .9], [26, 170, 1]];

type Palette = { sky: [string, string, string]; star: string; aura: string; figure: [string, string, string]; rim: [string, string, string]; hem: string };

const NIGHT: Palette = {
  sky: ['#22305e', '#0c1330', '#050815'], star: '#fff6dc', aura: '#f2d48e',
  figure: ['#3a4a80', '#1a2348', '#0b1022'], rim: ['#fff1c8', '#e3c27e', '#8a5f24'], hem: '#f2d48e',
};
// 晨雾琉璃: mist-paper glass, slate figure, old-gold rim lit from the upper left
const DAWN: Palette = {
  sky: ['#fbfcf6', '#e6f0eb', '#c9dbd3'], star: '#b39453', aura: '#ffffff',
  figure: ['#7a968e', '#4f6a68', '#29424a'], rim: ['#f6ecc4', '#d3b36f', '#8f7338'], hem: '#8f7338',
};

function build(kind: SilhouetteKind, p: Palette): string {
  const stars = STARS.map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.star}" opacity="${(.45 + (i % 3) * .2).toFixed(2)}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240">
<defs>
<radialGradient id="g" cx=".5" cy=".36" r=".75"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset=".6" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></radialGradient>
<radialGradient id="a" cx=".5" cy=".45" r=".5"><stop offset="0" stop-color="${p.aura}" stop-opacity=".28"/><stop offset="1" stop-color="${p.aura}" stop-opacity="0"/></radialGradient>
<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.figure[0]}"/><stop offset=".55" stop-color="${p.figure[1]}"/><stop offset="1" stop-color="${p.figure[2]}"/></linearGradient>
<linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.rim[0]}"/><stop offset=".5" stop-color="${p.rim[1]}"/><stop offset="1" stop-color="${p.rim[2]}"/></linearGradient>
</defs>
<rect width="200" height="240" fill="url(#g)"/>
${stars}
<ellipse cx="100" cy="110" rx="86" ry="96" fill="url(#a)"/>
<g fill="url(#f)" stroke="url(#r)" stroke-width="1.6" stroke-linejoin="round" transform="translate(0 40)">${FIGURES[kind]}</g>
<path d="M54 220c14-30 30-44 46-48 16 4 32 18 46 48" fill="none" stroke="${p.hem}" stroke-opacity=".18" stroke-width="1"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n\s*/g, ' '))}`;
}

const CACHE = new Map<string, string>();

function isDawn(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.uiTheme === 'dawn';
}

export function silhouetteDataUrl(kind: SilhouetteKind): string {
  const dawn = isDawn();
  const key = `${kind}:${dawn ? 'dawn' : 'night'}`;
  let url = CACHE.get(key);
  if (!url) { url = build(kind, dawn ? DAWN : NIGHT); CACHE.set(key, url); }
  return url;
}

export function silhouetteForGender(gender: string): string {
  if (gender.includes('男')) return silhouetteDataUrl('male');
  if (gender.includes('女')) return silhouetteDataUrl('female');
  return silhouetteDataUrl('neutral');
}
