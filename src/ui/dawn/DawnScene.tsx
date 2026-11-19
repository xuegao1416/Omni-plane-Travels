import { memo,useEffect,useRef,useState } from 'react';
import { DawnEngine,type ScenePhase } from './scene/engine';
import { dawnSceneBus } from './scene/sceneBus';

/**
 * 晨雾琉璃 entry backdrop, drawn entirely in code: a WebGL marble rotunda with a
 * crystal-ringed bonfire and volumetric morning light (see ./scene). The
 * engine survives short unmounts (hall ↔ settings / events) so returning to
 * the hall does not rebuild the scene. Without WebGL 2, or after the GPU
 * drops the context twice, a CSS painting of the same light stays in place.
 */

const GRACE_MS = 6000;
/** Rebuilds allowed after a lost context (per page load), so a flaky GPU cannot loop. */
const MAX_RESTARTS = 1;
const RESTART_DELAY_MS = 1500;
let cached: { engine: DawnEngine; timer: number | null } | null = null;
let restarts = 0;

function acquire(host: HTMLElement, phase: ScenePhase) {
  if (cached) {
    if (cached.timer !== null) window.clearTimeout(cached.timer);
    cached.timer = null;
    cached.engine.attach(host);
    cached.engine.setPhase(phase);
    return cached.engine;
  }
  const engine = DawnEngine.create(host, phase);
  if (engine) cached = { engine, timer: null };
  return engine;
}

function release(engine: DawnEngine) {
  if (!cached || cached.engine !== engine) { engine.dispose(); return; }
  engine.suspend();
  cached.timer = window.setTimeout(() => {
    if (cached?.engine !== engine) return;
    cached = null;
    engine.dispose();
  }, GRACE_MS);
}

function discard(engine: DawnEngine) {
  if (cached?.engine === engine) {
    if (cached.timer !== null) window.clearTimeout(cached.timer);
    cached = null;
  }
  engine.dispose();
}

export default memo(function DawnScene({ phase }: { phase: ScenePhase }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<DawnEngine | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const engine = acquire(host, phaseRef.current);
    if (!engine) { setStatus('fallback'); return undefined; }
    engineRef.current = engine;
    let alive = true;
    let retry: number | null = null;
    setStatus('loading');
    engine.onReady(() => { if (alive) setStatus('ready'); });
    const sync = () => {
      engine.setLayout(dawnSceneBus.getLayout());
      engine.setFocus(dawnSceneBus.getFocus());
      for (const pulse of dawnSceneBus.takePulses()) engine.pulse(pulse);
    };
    sync();
    const unsubscribe = dawnSceneBus.subscribe(sync);
    const offLost = engine.onLost(() => {
      if (!alive) return;
      unsubscribe();
      engineRef.current = null;
      discard(engine);
      setStatus('fallback');
      if (restarts < MAX_RESTARTS) {
        restarts += 1;
        retry = window.setTimeout(() => setGeneration(g => g + 1), RESTART_DELAY_MS);
      }
    });
    return () => {
      alive = false;
      if (retry !== null) window.clearTimeout(retry);
      offLost();
      unsubscribe();
      if (engineRef.current === engine) {
        engineRef.current = null;
        release(engine);
      }
    };
  }, [generation]);

  useEffect(() => { engineRef.current?.setPhase(phase); }, [phase]);

  return (
    <div ref={hostRef} className={`dw-scene is-${status} is-${phase}`} aria-hidden="true">
      <div className="dw-scene__fallback">
        <i className="dw-scene__rays" />
        <i className="dw-scene__glow" />
        <i className="dw-scene__floor" />
      </div>
    </div>
  );
});
