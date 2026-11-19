import { memo } from 'react';
import { Arena, H, W } from './backdrop/paint';
import type { BattleSceneId } from './battleScene';

/**
 * Battlefield backdrop, three layers:
 *   1. a painted plate per scene (generated offline, public/art/combat/bg-*.webp;
 *      only the current scene's image is requested; phones get the 960px copy)
 *   2. the engraved astrolabe floor (static SVG) where units stand
 *   3. CSS atmosphere: mist, motes, grain, vignette (transform/opacity only)
 */
const ARENA: Record<BattleSceneId, { tone: string; pool: string; o: number }> = {
  ink: { tone: '#e3c27e', pool: '#efe6cc', o: .7 },
  ruins: { tone: '#e8ac6c', pool: '#ff9a50', o: .65 },
  city: { tone: '#e3c27e', pool: '#f2b066', o: .6 },
  wilds: { tone: '#e3c27e', pool: '#f0e2b8', o: .65 },
  castle: { tone: '#e3c27e', pool: '#f2dcc0', o: .75 },
  void: { tone: '#f2c880', pool: '#f2b066', o: .8 },
  dusk: { tone: '#e3c27e', pool: '#f6c88a', o: .7 },
};

function BattleBackdrop({ scene }: { scene: BattleSceneId }) {
  const arena = ARENA[scene];
  return (
    <div className={`bb is-${scene}`} aria-hidden="true">
      <img className="bb__plate" src={`/art/combat/bg-${scene}.webp`} srcSet={`/art/combat/bg-${scene}-960.webp 960w, /art/combat/bg-${scene}.webp 1600w`} sizes="100vw" alt="" decoding="async" draggable={false} />
      <svg className="bb__paint" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice"><Arena scene={scene} {...arena} /></svg>
      <span className="bb__mist is-far" />
      <span className="bb__mist is-near" />
      <span className="bb__motes" />
      <span className="bb__grain" />
      <span className="bb__vignette" />
    </div>
  );
}

export default memo(BattleBackdrop);
