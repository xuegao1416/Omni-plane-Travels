/**
 * 3D 沙盘的 React 外壳：挂载 three.js 场景，把选中、规划路线、视图数据同步进去。
 * 没有 WebGL2 或显卡上下文丢失时通知外层切回 2D。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { MapTheme } from '../../domains/map/types';
import type { MapViewModel } from '../../domains/map/viewModel';
import { MapScene } from '../../ui/map/scene/engine';

export interface Map3DHandle {
  zoomBy(factor: number): void;
  reset(): void;
  focus(locationId: string): void;
  focusRegion(regionId: string): void;
}

interface Map3DProps {
  view: MapViewModel;
  theme: MapTheme;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  plan?: string[];
  onUnavailable?: () => void;
}

const Map3D = forwardRef<Map3DHandle, Map3DProps>(function Map3D({ view, theme, selectedId, onSelect, plan, onUnavailable }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MapScene | null>(null);
  const callbacks = useRef({ onSelect, onUnavailable });
  callbacks.current = { onSelect, onUnavailable };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = MapScene.create(host, theme, {
      onSelect: id => callbacks.current.onSelect?.(id),
      onLost: () => callbacks.current.onUnavailable?.(),
    });
    if (!scene) { callbacks.current.onUnavailable?.(); return undefined; }
    sceneRef.current = scene;
    setReady(true);
    return () => {
      sceneRef.current = null;
      scene.dispose();
    };
    // 场景只建一次；画风与数据变化走 setView。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (ready) sceneRef.current?.setView(view, theme); }, [ready, view, theme]);
  useEffect(() => { if (ready) sceneRef.current?.setSelected(selectedId ?? null); }, [ready, selectedId]);
  useEffect(() => { if (ready) sceneRef.current?.setPlan(plan); }, [ready, plan, view]);

  useImperativeHandle(ref, () => ({
    zoomBy: factor => sceneRef.current?.zoomBy(factor),
    reset: () => sceneRef.current?.reset(),
    focus: id => sceneRef.current?.focusLocation(id),
    focusRegion: id => sceneRef.current?.focusRegion(id),
  }), []);

  return <div ref={hostRef} className={`map3d map3d--${theme}`} />;
});

export default Map3D;
