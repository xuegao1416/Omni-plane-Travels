/**
 * Combat art.
 *
 * Units use painted figures generated offline (MOSS, BiRefNet-matted) and
 * shipped as static WebP under public/art/combat: one transparent full-body
 * image per figure (allies face right, enemies face left) and one 192px bust
 * crop on a side-tinted backdrop for chips and plaques. Each unit is one
 * image layer plus the code-drawn frame. The code-drawn painter that preceded
 * this lives in git history (commit 66fd831).
 */
import type { CombatUnitCardModel } from '../../../gameplay/combatViewModel';
import type { BattleSceneId } from './battleScene';

export type FigureId =
  | 'swordsman' | 'maiden' | 'wanderer'
  | 'brute' | 'beast' | 'wraith' | 'fiend'
  | 'spider' | 'serpent' | 'bird' | 'skeleton' | 'golem' | 'elemental' | 'sorcerer' | 'assassin';

/** Enemy figure by name keyword, first match wins (more specific creatures before broad classes); unmatched names are human brutes. */
const ENEMY_RULES: [RegExp, FigureId][] = [
  [/[蛛蝎蜈蚣虫蚁蛊]/, 'spider'],
  [/[蛇蟒蛟龙鳄]/, 'serpent'],
  [/[鹰雕鸦隼鸟禽鹫枭]/, 'bird'],
  [/[兽狼虎熊豹犬狐鼠豺狮猿狗猪]/, 'beast'],
  [/[骸骨尸僵]/, 'skeleton'],
  [/[灵鬼魂影怨幽魄]/, 'wraith'],
  [/傀|石像|机甲|机械|偶|炮/, 'golem'],
  [/[火炎焰雷冰熔]|元素/, 'elemental'],
  [/[巫祭咒术]|法师|道人|妖道/, 'sorcerer'],
  [/刺|杀手|暗/, 'assassin'],
  [/[魔妖恶邪魇]/, 'fiend'],
];

type Side = 'ally' | 'enemy';

const ART = '/art/combat';

/** Costume set per scene: wuxia robes for ink, modern gear for urban / wasteland / everyday, space suits for the void, knights and mages for fantasy and wilds. */
type Costume = 'wuxia' | 'modern' | 'scifi' | 'fantasy';
const COSTUME: Record<BattleSceneId, Costume> = { ink: 'wuxia', ruins: 'modern', city: 'modern', void: 'scifi', dusk: 'modern', castle: 'fantasy', wilds: 'fantasy' };
/**
 * Dedicated paintings per figure and costume set. A set not listed uses the
 * base painting, which already suits it (e.g. the wolf for wuxia and fantasy,
 * the dark-fantasy spider for wuxia). Allies' base art is wuxia; most enemies'
 * base art is dark fantasy.
 */
const VARIANTS: Record<FigureId, Costume[]> = {
  swordsman: ['modern', 'scifi', 'fantasy'], maiden: ['modern', 'scifi', 'fantasy'], wanderer: ['modern', 'scifi', 'fantasy'],
  brute: ['modern', 'scifi', 'fantasy'], beast: ['modern', 'scifi'], wraith: ['modern', 'scifi'], fiend: ['wuxia', 'modern', 'scifi'],
  spider: ['modern', 'scifi'], serpent: ['wuxia', 'modern', 'scifi'], bird: ['modern', 'scifi'], skeleton: ['wuxia', 'modern', 'scifi'],
  golem: ['wuxia', 'modern', 'scifi'], elemental: ['modern', 'scifi'], sorcerer: ['wuxia', 'modern', 'scifi'], assassin: ['wuxia', 'scifi'],
};

function artName(figure: FigureId, scene: BattleSceneId | undefined): string {
  const costume = scene ? COSTUME[scene] : 'wuxia';
  return VARIANTS[figure].includes(costume) ? `${figure}-${costume}` : figure;
}

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n\s*/g, ' '))}`;
}

export function figureFor(unit: Pick<CombatUnitCardModel, 'side' | 'name' | 'portrait'>): FigureId {
  if (unit.side === 'enemy') {
    return ENEMY_RULES.find(([pattern]) => pattern.test(unit.name))?.[1] ?? 'brute';
  }
  return unit.portrait.kind === 'female' ? 'maiden' : unit.portrait.kind === 'male' ? 'swordsman' : 'wanderer';
}

/** Full standee art (portrait if the player supplied one). */
export function standeeArtFor(unit: CombatUnitCardModel, scene?: BattleSceneId): { src: string; custom: boolean; figure: FigureId } {
  const figure = figureFor(unit);
  if (unit.portrait.src) return { src: unit.portrait.src, custom: true, figure };
  return { src: `${ART}/fig-${artName(figure, scene)}.webp`, custom: false, figure };
}

/** Round chip / plaque art: portrait or a bust crop of the figure. */
export function unitArtFor(unit: CombatUnitCardModel, scene?: BattleSceneId): { src: string; custom: boolean } {
  if (unit.portrait.src) return { src: unit.portrait.src, custom: true };
  return { src: `${ART}/bust-${artName(figureFor(unit), scene)}.webp`, custom: false };
}



/**
 * Standee frame in the card's own 100×140 box: a lancet arch of cast metal
 * with an engraved inner rail, a crescent-and-gem keystone, side bosses at
 * the springing line and a stepped plinth. Allies get brass and amber,
 * enemies blackened bronze and garnet.
 */
const FRAME_CACHE = new Map<Side, string>();
export function frameArtFor(side: Side): string {
  const cached = FRAME_CACHE.get(side);
  if (cached) return cached;
  const ally = side === 'ally';
  const metal = ally ? ['#fff3cf', '#ecca86', '#a97a35', '#f3d899', '#5e3f15'] : ['#ffd8c8', '#d0786a', '#6a1c1c', '#c0605a', '#2a0808'];
  const gem = ally ? ['#fffbe8', '#ffd98a', '#d48a2a', '#2a1203'] : ['#ffe9e4', '#ff8f80', '#b2303a', '#200409'];
  // Pointed arch: two arcs meeting at the apex.
  const arch = (i: number) => `M${i} 139V58C${i} 30 ${24 + i * .4} ${8 + i} 50 ${2 + i}C${76 - i * .4} ${8 + i} ${100 - i} 30 ${100 - i} 58V139`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" preserveAspectRatio="none">
<defs>
<linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${metal[0]}"/><stop offset=".2" stop-color="${metal[1]}"/><stop offset=".45" stop-color="${metal[2]}"/><stop offset=".62" stop-color="${metal[3]}"/><stop offset="1" stop-color="${metal[4]}"/></linearGradient>
<linearGradient id="mv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${metal[0]}"/><stop offset=".5" stop-color="${metal[2]}"/><stop offset="1" stop-color="${metal[3]}"/></linearGradient>
<radialGradient id="g" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="${gem[0]}"/><stop offset=".2" stop-color="${gem[1]}"/><stop offset=".55" stop-color="${gem[2]}"/><stop offset="1" stop-color="${gem[3]}"/></radialGradient>
</defs>
<path d="${arch(1.5)}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="4.4"/>
<path d="${arch(1.5)}" fill="none" stroke="url(#m)" stroke-width="2.6"/>
<path d="${arch(4.2)}" fill="none" stroke="#050407" stroke-opacity=".75" stroke-width="1.6"/>
<path d="${arch(5.6)}" fill="none" stroke="url(#mv)" stroke-width=".7" stroke-dasharray="1.2 1.6"/>
<path d="M50 -1C44 4 41 9 42 14C45 10 48 9 50 9C52 9 55 10 58 14C59 9 56 4 50 -1Z" fill="url(#m)"/>
<path d="M50 4.5 54 9 50 13.5 46 9Z" fill="url(#g)" stroke="url(#m)" stroke-width=".6"/>
<circle cx="49" cy="7.6" r=".9" fill="#fff" fill-opacity=".8"/>
<g fill="url(#m)"><circle cx="2.2" cy="58" r="2.6"/><circle cx="97.8" cy="58" r="2.6"/></g>
<g fill="url(#g)"><circle cx="2.2" cy="58" r="1.1"/><circle cx="97.8" cy="58" r="1.1"/></g>
<path d="M0 128H100V140H0Z" fill="#050407" fill-opacity=".55"/>
<path d="M0 128H100" stroke="url(#m)" stroke-width="1.4"/>
<path d="M4 131.5H96" stroke="url(#mv)" stroke-width=".5" stroke-opacity=".7"/>
<path d="M0 138.6H100" stroke="url(#m)" stroke-width="2.2"/>
<path d="M44 128 50 124 56 128Z" fill="url(#m)"/>
</svg>`;
  const url = toDataUrl(svg);
  FRAME_CACHE.set(side, url);
  return url;
}

/* ── Command glyphs (24×24, stroke = currentColor) ── */
const glyphProps = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

/** Straight sword, point up-right, with a ringed pommel. */
export function GlyphAttack() {
  return <svg {...glyphProps}><path d="M20.5 3.5 10 14l-.2 1.2L11 15l10.5-10.5z" fill="currentColor" fillOpacity=".22" /><path d="M20.5 3.5h1v1M7 13l4 4M9 15l-4.5 4.5" /><circle cx="3.8" cy="20.2" r="1.3" /></svg>;
}
/** Four-point star inside a tilted orbit. */
export function GlyphSkill() {
  return <svg {...glyphProps}><path d="M12 4 13.4 10.6 20 12l-6.6 1.4L12 20l-1.4-6.6L4 12l6.6-1.4z" fill="currentColor" fillOpacity=".22" /><ellipse cx="12" cy="12" rx="10" ry="3.8" transform="rotate(-30 12 12)" strokeOpacity=".5" /><circle cx="20.2" cy="7.2" r="1" fill="currentColor" stroke="none" /></svg>;
}
/** Stoppered round flask with liquid level. */
export function GlyphItem() {
  return <svg {...glyphProps}><path d="M10 3.5h4M10.6 3.5v4.4a6.5 6.5 0 1 0 2.8 0V3.5" /><path d="M6.4 14.6h11.2a5.6 5.6 0 0 1-11.2 0z" fill="currentColor" fillOpacity=".3" stroke="none" /><circle cx="10.4" cy="16.4" r=".8" fill="currentColor" stroke="none" /><circle cx="13.2" cy="15.4" r=".55" fill="currentColor" stroke="none" /></svg>;
}
/** Heater shield with a boss and cross bands. */
export function GlyphDefend() {
  return <svg {...glyphProps}><path d="M12 3 19.5 5.4v5.8c0 4.6-3.2 8.2-7.5 9.8-4.3-1.6-7.5-5.2-7.5-9.8V5.4z" fill="currentColor" fillOpacity=".16" /><path d="M12 6.2v12.2M7.2 10.8h9.6" strokeOpacity=".6" /><circle cx="12" cy="10.8" r="1.8" fill="currentColor" stroke="none" /></svg>;
}
/** Double chevron with speed lines. */
export function GlyphFlee() {
  return <svg {...glyphProps}><path d="M3 8h6M2 12h6M3 16h6" strokeOpacity=".5" /><path d="M11.5 6 17.5 12l-6 6" /><path d="M15.5 6 21.5 12l-6 6" strokeOpacity=".55" /></svg>;
}

/** Outcome emblems for the result seal (120×120, painted with the kit's shared brass and gem servers). */
export function EmblemVictory() {
  return <svg viewBox="0 0 120 120" aria-hidden="true">
    <g fill="none" stroke="url(#pk-brass)" strokeWidth="2.2" strokeLinecap="round">
      <path d="M34 94C18 80 14 60 20 42M86 94c16-14 20-34 14-52" />
    </g>
    <g fill="url(#pk-brass)">
      {[0, 1, 2, 3, 4].map(i => <g key={i}>
        <path d={`M${28 - i * 2} ${86 - i * 10}c-8-1-12-6-13-12 7 0 12 4 13 12z`} />
        <path d={`M${92 + i * 2} ${86 - i * 10}c8-1 12-6 13-12-7 0-12 4-13 12z`} />
      </g>)}
    </g>
    <path d="M60 22 67 46h25l-20 15 8 24-20-15-20 15 8-24-20-15h25z" fill="url(#pk-gem-amber)" stroke="#fff1c8" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M44 100h32" stroke="url(#pk-brass)" strokeWidth="2.4" strokeLinecap="round" />
  </svg>;
}
export function EmblemDefeat() {
  return <svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="44" fill="none" stroke="#7a2a2a" strokeOpacity=".7" strokeDasharray="3 6" />
    <g fill="none" stroke="#c9b9a6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M84 22 60 52M54 60 32 90" />
      <path d="M26 84l12 12M24 98l6-6" />
    </g>
    <path d="M60 52l-6 8" stroke="#ff8f80" strokeWidth="1.4" strokeDasharray="2 2" />
    <path d="M58 48l7 7M50 60l-5 5" stroke="#d0675a" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}
export function EmblemEscape() {
  return <svg viewBox="0 0 120 120" aria-hidden="true">
    <g fill="none" stroke="url(#pk-brass)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M46 34 72 60 46 86" /><path d="M64 34 90 60 64 86" strokeOpacity=".55" />
      <path d="M18 48h20M14 60h24M18 72h20" strokeOpacity=".4" />
    </g>
  </svg>;
}
