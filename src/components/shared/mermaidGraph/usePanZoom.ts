import { useState, useCallback, useRef } from 'react';
import {
  MIN_SCALE, MAX_SCALE, STEP_SCALE, SURFACE_PADDING, DRAG_THRESHOLD,
} from './mermaidInit';

interface UsePanZoomParams {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  graphSize: { width: number; height: number };
  onPointerTap?: (clientX: number, clientY: number, target: HTMLElement) => void;
}

export function usePanZoom({ viewportRef, graphSize, onPointerTap }: UsePanZoomParams) {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);

  const pointerState = useRef({
    isDragging: false,
    startX: 0, startY: 0,
    startTranslateX: 0, startTranslateY: 0,
    moved: false,
  });

  const pinchState = useRef({
    active: false,
    startDistance: 0,
    startScale: 1,
  });

  const activePointers = useRef(new Map<number, { x: number; y: number }>());

  const fitGraphToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const size = graphSize;

    if (!viewportRect.width || !viewportRect.height || !size.width || !size.height) {
      setScale(1.5);
      setTranslateX(SURFACE_PADDING);
      setTranslateY(SURFACE_PADDING);
      return;
    }

    const widthRatio = (viewportRect.width - SURFACE_PADDING * 2) / size.width;
    const heightRatio = (viewportRect.height - SURFACE_PADDING * 2) / size.height;
    const fitScale = Math.max(widthRatio, heightRatio);
    const nextScale = Math.max(1.0, Math.min(MAX_SCALE, fitScale));

    const totalWidth = size.width * nextScale + SURFACE_PADDING * 2;
    const totalHeight = size.height * nextScale + SURFACE_PADDING * 2;
    setScale(nextScale);
    setTranslateX((viewportRect.width - totalWidth) / 2);
    setTranslateY((viewportRect.height - totalHeight) / 2);
  }, [viewportRef, graphSize]);

  const zoomBy = useCallback((factor: number, originX?: number, originY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const centerX = originX ?? (rect.width / 2);
    const centerY = originY ?? (rect.height / 2);
    const previousScale = scale;
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, previousScale * factor));
    if (Math.abs(nextScale - previousScale) < 0.0001) return;

    const worldX = (centerX - translateX - SURFACE_PADDING) / previousScale;
    const worldY = (centerY - translateY - SURFACE_PADDING) / previousScale;
    setScale(nextScale);
    setTranslateX(centerX - SURFACE_PADDING - worldX * nextScale);
    setTranslateY(centerY - SURFACE_PADDING - worldY * nextScale);
  }, [viewportRef, scale, translateX, translateY]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? STEP_SCALE : 1 / STEP_SCALE;
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
  }, [viewportRef, zoomBy]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchState.current = { active: true, startDistance: dist, startScale: scale };
      return;
    }

    pointerState.current = {
      isDragging: true,
      startX: e.clientX, startY: e.clientY,
      startTranslateX: translateX, startTranslateY: translateY,
      moved: false,
    };
  }, [scale, translateX, translateY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchState.current.active && activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / pinchState.current.startDistance;
      setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchState.current.startScale * ratio)));
      return;
    }

    if (!pointerState.current.isDragging) return;
    const dx = e.clientX - pointerState.current.startX;
    const dy = e.clientY - pointerState.current.startY;
    if (!pointerState.current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    pointerState.current.moved = true;
    setTranslateX(pointerState.current.startTranslateX + dx);
    setTranslateY(pointerState.current.startTranslateY + dy);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (pinchState.current.active && activePointers.current.size < 2) {
      pinchState.current.active = false;
    }

    if (!pointerState.current.isDragging) return;
    const wasMoved = pointerState.current.moved;
    pointerState.current.isDragging = false;

    if (!wasMoved) {
      onPointerTap?.(e.clientX, e.clientY, e.target as HTMLElement);
    }
  }, [onPointerTap]);

  const resetView = useCallback(() => fitGraphToViewport(), [fitGraphToViewport]);
  const zoomIn = useCallback(() => zoomBy(STEP_SCALE), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / STEP_SCALE), [zoomBy]);

  return {
    scale, translateX, translateY,
    isDragging: pointerState.current.isDragging,
    handleWheel, handlePointerDown, handlePointerMove, handlePointerUp,
    fitGraphToViewport, resetView, zoomIn, zoomOut,
  };
}
