import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCalibrationHistory } from './useCalibrationHistory';
import {
  getCalibrationProfile,
  type CalibrationElementState,
  type CalibrationFrameState,
  type CalibrationScreen,
  type CalibrationSnapshot,
  type CalibrationViewport,
  type ExportedCalibrationSnapshot,
} from './types';
import './layout-calibration.css';

interface LayoutCalibrationStudioProps {
  screen: CalibrationScreen;
}

interface OriginalInlineProperty {
  value: string;
  priority: string;
}

type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

const CENTER_PIECES = {
  top: '.dawn-frame__piece--top-center',
  right: '.dawn-frame__piece--right-center',
  bottom: '.dawn-frame__piece--bottom-center',
  left: '.dawn-frame__piece--left-center',
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function readOpacity(element: Element | null, fallback = 1) {
  if (!element) return fallback;
  return finite(Number.parseFloat(getComputedStyle(element).opacity), fallback);
}

function readBrightness(filter: string) {
  const match = filter.match(/brightness\(([-\d.]+)(%)?\)/i);
  if (!match) return 1;
  const parsed = Number.parseFloat(match[1]);
  return match[2] ? parsed / 100 : parsed;
}

function replaceBrightness(filter: string, brightness: number) {
  const safeFilter = filter === 'none' ? '' : filter;
  const next = `brightness(${brightness})`;
  return /brightness\([^)]*\)/i.test(safeFilter)
    ? safeFilter.replace(/brightness\([^)]*\)/i, next)
    : `${safeFilter} ${next}`.trim();
}

function getLayoutNodes() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-layout-id]'));
}

function getLayoutNode(id: string) {
  return getLayoutNodes().find(node => node.dataset.layoutId === id) ?? null;
}

function getNormalizedCenter(target: HTMLElement, containerId: string) {
  const rect = target.getBoundingClientRect();
  const container = getLayoutNode(containerId) ?? target.parentElement;
  const containerRect = container?.getBoundingClientRect();
  if (!containerRect?.width || !containerRect.height) return { x: .5, y: .5 };
  return {
    x: (rect.left + rect.width / 2 - containerRect.left) / containerRect.width,
    y: (rect.top + rect.height / 2 - containerRect.top) / containerRect.height,
  };
}

function findFrame(target: HTMLElement) {
  if (target.classList.contains('dawn-frame')) return target;
  return target.querySelector<HTMLElement>('.dawn-frame');
}

function readFrameState(target: HTMLElement): CalibrationFrameState | undefined {
  const frame = findFrame(target);
  if (!frame) return undefined;
  const border = frame.querySelector<HTMLElement>('.dawn-frame__border');
  const fill = frame.querySelector<HTMLElement>('.dawn-frame__fill');
  return {
    frameOpacity: 1,
    fillOpacity: readOpacity(fill),
    glassOpacity: 1,
    borderOpacity: readOpacity(border),
    centerOrnaments: {
      top: Boolean(frame.querySelector(CENTER_PIECES.top)),
      right: Boolean(frame.querySelector(CENTER_PIECES.right)),
      bottom: Boolean(frame.querySelector(CENTER_PIECES.bottom)),
      left: Boolean(frame.querySelector(CENTER_PIECES.left)),
    },
  };
}

function scanSnapshot(screen: CalibrationScreen, viewport: CalibrationViewport): CalibrationSnapshot {
  const profile = getCalibrationProfile(screen, viewport.aspectRatio);
  const elements: Record<string, CalibrationElementState> = {};
  getLayoutNodes()
    .filter(node => node.dataset.layoutEditable === 'true' && node.dataset.layoutId?.startsWith(`${screen}.`))
    .forEach(target => {
      const id = target.dataset.layoutId;
      if (!id) return;
      const rect = target.getBoundingClientRect();
      const containerId = target.dataset.layoutContainer || `${screen}.screen`;
      elements[id] = {
        id,
        label: target.dataset.layoutLabel || id,
        containerId,
        center: getNormalizedCenter(target, containerId),
        offsetPx: { x: 0, y: 0 },
        size: { width: rect.width, height: rect.height },
        baselineSize: { width: rect.width, height: rect.height },
        scale: 1,
        opacity: readOpacity(target),
        locked: false,
        cropBottomPct: target.dataset.layoutKind === 'fire-flame'
          ? clamp(finite(Number.parseFloat(getComputedStyle(target).getPropertyValue('--entry-flame-crop-bottom')), 28), 0, 60)
          : undefined,
        frame: readFrameState(target),
      };
    });

  const background = getLayoutNode(`${screen}.background`);
  const veil = getLayoutNode(`${screen}.veil`);
  const backgroundStyle = background ? getComputedStyle(background) : null;
  return {
    schemaVersion: 1,
    screen,
    profile,
    viewport,
    background: {
      rawOriginal: false,
      opacity: backgroundStyle ? finite(Number.parseFloat(backgroundStyle.opacity), 1) : 1,
      brightness: backgroundStyle ? readBrightness(backgroundStyle.filter) : 1,
      veilOpacity: readOpacity(veil, 0),
      washOpacity: readOpacity(getLayoutNode(`${screen}.wash`), 0),
    },
    elements,
  };
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onBegin,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onBegin: () => void;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  return (
    <label className="layout-calibration__field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={onBegin}
        onChange={event => onChange(Number(event.target.value))}
        onBlur={onCommit}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export default function LayoutCalibrationStudio({ screen }: LayoutCalibrationStudioProps) {
  const [viewport, setViewport] = useState<CalibrationViewport>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    aspectRatio: window.innerWidth / Math.max(1, window.innerHeight),
  }));
  const profile = getCalibrationProfile(screen, viewport.aspectRatio);
  const historyKey = `${screen}:${profile}`;
  const history = useCalibrationHistory(historyKey);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelHidden, setPanelHidden] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [interactionMode, setInteractionMode] = useState(false);
  const [exited, setExited] = useState(false);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [importText, setImportText] = useState('');
  const [exportFallback, setExportFallback] = useState('');
  const [notice, setNotice] = useState('');
  const touchedPropertiesRef = useRef(new Map<HTMLElement, Map<string, OriginalInlineProperty>>());
  const pointerCleanupRef = useRef<(() => void) | null>(null);

  const rememberProperty = useCallback((element: HTMLElement, property: string) => {
    let properties = touchedPropertiesRef.current.get(element);
    if (!properties) {
      properties = new Map();
      touchedPropertiesRef.current.set(element, properties);
    }
    if (!properties.has(property)) {
      properties.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      });
    }
  }, []);

  const setRuntimeProperty = useCallback((element: HTMLElement, property: string, value: string) => {
    rememberProperty(element, property);
    element.style.setProperty(property, value);
  }, [rememberProperty]);

  const restoreRuntimeProperties = useCallback(() => {
    touchedPropertiesRef.current.forEach((properties, element) => {
      properties.forEach((original, property) => {
        if (original.value) element.style.setProperty(property, original.value, original.priority);
        else element.style.removeProperty(property);
      });
    });
    touchedPropertiesRef.current.clear();
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport({ width, height, aspectRatio: width / Math.max(1, height) });
      setOverlayVersion(value => value + 1);
    };
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useLayoutEffect(() => {
    restoreRuntimeProperties();
    if (exited || history.snapshot) return;
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        history.seed(historyKey, scanSnapshot(screen, viewport));
      });
    });
    return () => {
      cancelAnimationFrame(outerFrame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [exited, history.seed, history.snapshot, historyKey, restoreRuntimeProperties, screen]);

  useLayoutEffect(() => {
    restoreRuntimeProperties();
    const snapshot = history.snapshot;
    if (!snapshot || exited) return;

    const background = getLayoutNode(`${screen}.background`);
    const veil = getLayoutNode(`${screen}.veil`);
    const wash = getLayoutNode(`${screen}.wash`);
    const backgroundState = snapshot.background;
    if (background) {
      const computedFilter = getComputedStyle(background).filter;
      setRuntimeProperty(background, 'opacity', String(backgroundState.rawOriginal ? 1 : backgroundState.opacity));
      setRuntimeProperty(background, 'filter', replaceBrightness(computedFilter, backgroundState.rawOriginal ? 1 : backgroundState.brightness));
    }
    if (veil) setRuntimeProperty(veil, 'opacity', String(backgroundState.rawOriginal ? 0 : backgroundState.veilOpacity));
    if (wash) setRuntimeProperty(wash, 'opacity', String(backgroundState.rawOriginal ? 0 : backgroundState.washOpacity));

    Object.values(snapshot.elements).forEach(elementState => {
      const target = getLayoutNode(elementState.id);
      if (!target) return;
      const baselineWidth = Math.max(1, elementState.baselineSize.width);
      const baselineHeight = Math.max(1, elementState.baselineSize.height);
      const scaleX = elementState.scale * elementState.size.width / baselineWidth;
      const scaleY = elementState.scale * elementState.size.height / baselineHeight;
      setRuntimeProperty(target, 'translate', `${elementState.offsetPx.x}px ${elementState.offsetPx.y}px`);
      setRuntimeProperty(target, 'scale', `${scaleX} ${scaleY}`);
      setRuntimeProperty(target, 'opacity', String(elementState.opacity));
      setRuntimeProperty(target, 'transform-origin', target.dataset.layoutOrigin || 'center center');
      if (elementState.cropBottomPct != null) {
        setRuntimeProperty(target, '--entry-flame-crop-bottom', `${elementState.cropBottomPct}%`);
      }

      if (elementState.frame) {
        const frame = findFrame(target);
        const border = frame?.querySelector<HTMLElement>('.dawn-frame__border');
        const fill = frame?.querySelector<HTMLElement>('.dawn-frame__fill');
        if (border) {
          setRuntimeProperty(border, 'opacity', String(elementState.frame.frameOpacity * elementState.frame.borderOpacity));
        }
        if (fill) {
          setRuntimeProperty(fill, 'opacity', String(elementState.frame.fillOpacity * elementState.frame.glassOpacity));
        }
        (Object.keys(CENTER_PIECES) as Array<keyof typeof CENTER_PIECES>).forEach(side => {
          if (elementState.frame?.centerOrnaments[side]) return;
          const piece = frame?.querySelector<HTMLElement>(CENTER_PIECES[side]);
          if (piece) setRuntimeProperty(piece, 'display', 'none');
        });
      }
    });

    const frame = requestAnimationFrame(() => setOverlayVersion(value => value + 1));
    return () => cancelAnimationFrame(frame);
  }, [exited, history.snapshot, restoreRuntimeProperties, screen, setRuntimeProperty]);

  useEffect(() => () => {
    pointerCleanupRef.current?.();
    restoreRuntimeProperties();
  }, [restoreRuntimeProperties]);

  useEffect(() => {
    if (!exited) return;
    pointerCleanupRef.current?.();
    restoreRuntimeProperties();
  }, [exited, restoreRuntimeProperties]);

  useEffect(() => {
    const snapshot = history.snapshot;
    if (!snapshot) return;
    if (selectedId && snapshot.elements[selectedId]) return;
    setSelectedId(Object.keys(snapshot.elements)[0] ?? null);
  }, [history.snapshot, selectedId]);

  useEffect(() => {
    if (exited) return;
    const nodes = getLayoutNodes().filter(node => node.dataset.layoutEditable === 'true');
    const observer = new ResizeObserver(() => setOverlayVersion(value => value + 1));
    nodes.forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [exited, historyKey, history.snapshot?.elements]);

  const beginMove = useCallback((id: string, clientX: number, clientY: number) => {
    const element = history.snapshot?.elements[id];
    if (!element || element.locked) return;
    pointerCleanupRef.current?.();
    history.begin();
    const startOffset = { ...element.offsetPx };
    const onMove = (event: PointerEvent) => {
      history.preview(draft => {
        const current = draft.elements[id];
        if (!current) return;
        current.offsetPx.x = startOffset.x + event.clientX - clientX;
        current.offsetPx.y = startOffset.y + event.clientY - clientY;
      });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      pointerCleanupRef.current = null;
    };
    const onUp = () => {
      cleanup();
      history.commit();
    };
    pointerCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [history]);

  const beginResize = useCallback((id: string, handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
    const element = history.snapshot?.elements[id];
    if (!element || element.locked) return;
    event.preventDefault();
    event.stopPropagation();
    pointerCleanupRef.current?.();
    history.begin();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = { ...element.size };
    const startOffset = { ...element.offsetPx };
    const aspect = startSize.width / Math.max(1, startSize.height);
    const east = handle.endsWith('e');
    const south = handle.startsWith('s');
    const onMove = (pointerEvent: PointerEvent) => {
      let width = Math.max(24, startSize.width + (east ? 1 : -1) * (pointerEvent.clientX - startX));
      let height = Math.max(24, startSize.height + (south ? 1 : -1) * (pointerEvent.clientY - startY));
      if (pointerEvent.shiftKey) {
        const widthDelta = Math.abs(width - startSize.width) / Math.max(1, startSize.width);
        const heightDelta = Math.abs(height - startSize.height) / Math.max(1, startSize.height);
        if (widthDelta >= heightDelta) height = width / aspect;
        else width = height * aspect;
      }
      const deltaWidth = width - startSize.width;
      const deltaHeight = height - startSize.height;
      history.preview(draft => {
        const current = draft.elements[id];
        if (!current) return;
        current.size = { width, height };
        if (!pointerEvent.altKey) {
          current.offsetPx.x = startOffset.x + (east ? deltaWidth / 2 : -deltaWidth / 2);
          current.offsetPx.y = startOffset.y + (south ? deltaHeight / 2 : -deltaHeight / 2);
        } else {
          current.offsetPx = { ...startOffset };
        }
      });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      pointerCleanupRef.current = null;
    };
    const onUp = () => {
      cleanup();
      history.commit();
    };
    pointerCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [history]);

  useEffect(() => {
    if (exited || interactionMode) return;
    const onPointerDown = (event: PointerEvent) => {
      const origin = event.target instanceof Element ? event.target : null;
      if (interactionMode || !origin || origin.closest('[data-layout-editor-root]')) return;
      const target = origin.closest<HTMLElement>('[data-layout-editable="true"]');
      const id = target?.dataset.layoutId;
      if (!id || !history.snapshot?.elements[id]) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(id);
      beginMove(id, event.clientX, event.clientY);
    };
    const onClick = (event: MouseEvent) => {
      const origin = event.target instanceof Element ? event.target : null;
      if (interactionMode || origin?.closest('[data-layout-editor-root]')) return;
      if (origin?.closest('[data-layout-editable="true"]')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [beginMove, exited, history.snapshot, interactionMode]);

  useEffect(() => {
    if (exited) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingField = target?.matches('input, textarea, select, [contenteditable="true"]');
      if (!editingField && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        setInteractionMode(value => !value);
        return;
      }
      if (!editingField && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (!editingField && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        history.redo();
        return;
      }
      if (editingField || !selectedId || !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return;
      const selected = history.snapshot?.elements[selectedId];
      if (!selected || selected.locked) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      history.transact(draft => {
        const current = draft.elements[selectedId];
        if (!current) return;
        if (event.key === 'ArrowLeft') current.offsetPx.x -= step;
        if (event.key === 'ArrowRight') current.offsetPx.x += step;
        if (event.key === 'ArrowUp') current.offsetPx.y -= step;
        if (event.key === 'ArrowDown') current.offsetPx.y += step;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exited, history, selectedId]);

  const selected = selectedId ? history.snapshot?.elements[selectedId] ?? null : null;
  const selectedTarget = selectedId ? getLayoutNode(selectedId) : null;
  const selectedRect = selectedTarget?.getBoundingClientRect() ?? null;
  const selectedCenter = selected && selectedTarget
    ? getNormalizedCenter(selectedTarget, selected.containerId)
    : selected?.center;
  const hasWash = Boolean(getLayoutNode(`${screen}.wash`));

  const allRects = useMemo(() => {
    void overlayVersion;
    if (!showAll || !history.snapshot) return [];
    return Object.values(history.snapshot.elements).flatMap(element => {
      const target = getLayoutNode(element.id);
      if (!target) return [];
      return [{ element, rect: target.getBoundingClientRect() }];
    });
  }, [history.snapshot, overlayVersion, showAll]);

  const updateElement = useCallback((id: string, mutate: (element: CalibrationElementState) => void) => {
    history.preview(draft => {
      const element = draft.elements[id];
      if (element) mutate(element);
    });
  }, [history]);

  const updateBackground = useCallback((mutate: (background: CalibrationSnapshot['background']) => void) => {
    history.preview(draft => mutate(draft.background));
  }, [history]);

  const buildExportSnapshot = useCallback((): ExportedCalibrationSnapshot | null => {
    const snapshot = history.snapshot;
    if (!snapshot) return null;
    const elements: ExportedCalibrationSnapshot['elements'] = {};
    Object.values(snapshot.elements).forEach(element => {
      const target = getLayoutNode(element.id);
      const { baselineSize: _baselineSize, ...exported } = element;
      void _baselineSize;
      elements[element.id] = {
        ...exported,
        center: target ? getNormalizedCenter(target, element.containerId) : element.center,
      };
    });
    return {
      schemaVersion: 1,
      screen,
      profile,
      viewport,
      background: { ...snapshot.background },
      elements,
    };
  }, [history.snapshot, profile, screen, viewport]);

  const exportSnapshot = useCallback(async () => {
    const exported = buildExportSnapshot();
    if (!exported) return;
    const text = JSON.stringify(exported, null, 2);
    const blobUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = `layout-calibration-${screen}-${profile}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    try {
      await navigator.clipboard.writeText(text);
      setExportFallback('');
      setNotice('已下载并复制 JSON');
    } catch {
      setExportFallback(text);
      setNotice('已下载；剪贴板不可用，请从下方复制');
    }
  }, [buildExportSnapshot, profile, screen]);

  const importSnapshot = useCallback(() => {
    if (!history.snapshot) return;
    try {
      const parsed = JSON.parse(importText) as Partial<ExportedCalibrationSnapshot>;
      if (parsed.schemaVersion !== 1 || parsed.screen !== screen || parsed.profile !== profile || !parsed.elements) {
        throw new Error('快照必须属于当前 screen/profile，且 schemaVersion 为 1。');
      }
      const next = structuredClone(history.snapshot);
      if (parsed.background) next.background = { ...next.background, ...parsed.background };
      Object.entries(parsed.elements).forEach(([id, imported]) => {
        const current = next.elements[id];
        if (!current) return;
        next.elements[id] = {
          ...current,
          ...imported,
          offsetPx: { ...current.offsetPx, ...imported.offsetPx },
          size: { ...current.size, ...imported.size },
          center: { ...current.center, ...imported.center },
          baselineSize: current.baselineSize,
          frame: current.frame && imported.frame
            ? {
              ...current.frame,
              ...imported.frame,
              centerOrnaments: { ...current.frame.centerOrnaments, ...imported.frame.centerOrnaments },
            }
            : current.frame,
        };
      });
      next.viewport = viewport;
      history.replace(next);
      setNotice('当前 profile 快照已导入');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法导入快照');
    }
  }, [history, importText, profile, screen, viewport]);

  if (exited) return null;

  return (
    <div className={`layout-calibration${interactionMode ? ' layout-calibration--interaction' : ''}`} data-layout-editor-root="true">
      {showAll && allRects.map(({ element, rect }) => (
        <div
          key={element.id}
          className="layout-calibration__target-outline"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          <span>{element.label}</span>
        </div>
      ))}

      {selected && selectedRect && (
        <div
          className={`layout-calibration__selection${selected.locked ? ' is-locked' : ''}`}
          style={{ left: selectedRect.left, top: selectedRect.top, width: selectedRect.width, height: selectedRect.height }}
        >
          <button
            type="button"
            className="layout-calibration__drag-surface"
            aria-label={`拖动 ${selected.label}`}
            disabled={selected.locked}
            onPointerDown={event => {
              event.preventDefault();
              event.stopPropagation();
              beginMove(selected.id, event.clientX, event.clientY);
            }}
          />
          {(['nw', 'ne', 'se', 'sw'] as ResizeHandle[]).map(handle => (
            <button
              key={handle}
              type="button"
              className={`layout-calibration__resize-handle layout-calibration__resize-handle--${handle}`}
              aria-label={`${handle} 缩放 ${selected.label}`}
              disabled={selected.locked}
              onPointerDown={event => beginResize(selected.id, handle, event)}
            />
          ))}
          <span className="layout-calibration__selection-label">{selected.label}{selected.locked ? ' · 已锁定' : ''}</span>
        </div>
      )}

      {panelHidden ? (
        <button type="button" className="layout-calibration__reopen" onClick={() => setPanelHidden(false)}>校准台</button>
      ) : (
        <aside className="layout-calibration__panel" aria-label="布局校准台">
          <header className="layout-calibration__panel-header">
            <div><strong>布局校准台</strong><span>Layout Calibration Studio</span></div>
            <button type="button" onClick={() => setPanelHidden(true)} aria-label="隐藏面板">—</button>
          </header>

          <section className="layout-calibration__summary">
            <span>screen <b>{screen}</b></span>
            <span>{viewport.width}×{viewport.height}</span>
            <span>ratio {viewport.aspectRatio.toFixed(3)}</span>
            <span>profile <b>{profile}</b></span>
            <span>mode <b>{interactionMode ? 'interaction' : 'select'}</b></span>
          </section>

          <div className="layout-calibration__toolbar">
            <div className="layout-calibration__mode-switch" role="group" aria-label="校准台模式">
              <button type="button" className={!interactionMode ? 'is-active' : ''} aria-pressed={!interactionMode} onClick={() => setInteractionMode(false)}>选择模式</button>
              <button type="button" className={interactionMode ? 'is-active' : ''} aria-pressed={interactionMode} onClick={() => setInteractionMode(true)}>交互模式</button>
            </div>
            <button type="button" onClick={history.undo} disabled={!history.canUndo}>撤销</button>
            <button type="button" onClick={history.redo} disabled={!history.canRedo}>重做</button>
            <button type="button" onClick={() => selectedId && history.resetElement(selectedId)} disabled={!selectedId}>重置选中</button>
            <button type="button" onClick={history.resetProfile}>重置本档</button>
          </div>

          <label className="layout-calibration__toggle">
            <input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />
            显示所有目标轮廓
          </label>

          <section className="layout-calibration__section">
            <h3>目标元素</h3>
            <div className="layout-calibration__target-list">
              {Object.values(history.snapshot?.elements ?? {}).map(element => (
                <button
                  type="button"
                  key={element.id}
                  className={selectedId === element.id ? 'is-selected' : ''}
                  onClick={() => setSelectedId(element.id)}
                >
                  <span>{element.label}</span><small>{element.locked ? 'LOCK' : element.id}</small>
                </button>
              ))}
            </div>
          </section>

          {selected && (
            <section className="layout-calibration__section">
              <h3>几何与显示</h3>
              <label className="layout-calibration__toggle">
                <input
                  type="checkbox"
                  checked={selected.locked}
                  onChange={event => history.transact(draft => { draft.elements[selected.id].locked = event.target.checked; })}
                />
                锁定元素
              </label>
              <div className="layout-calibration__field-grid">
                <NumberField label="offset X" value={selected.offsetPx.x} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { element.offsetPx.x = finite(value); })} />
                <NumberField label="offset Y" value={selected.offsetPx.y} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { element.offsetPx.y = finite(value); })} />
                <NumberField label="width" value={selected.size.width} min={24} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { element.size.width = Math.max(24, finite(value, 24)); })} />
                <NumberField label="height" value={selected.size.height} min={24} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { element.size.height = Math.max(24, finite(value, 24)); })} />
                <NumberField label="scale" value={selected.scale} min={.05} max={10} step={.05} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { element.scale = clamp(finite(value, 1), .05, 10); })} />
                <NumberField label="opacity" value={selected.opacity} min={0} max={1} step={.05} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { element.opacity = clamp(finite(value, 1), 0, 1); })} />
                {selected.cropBottomPct != null && <NumberField label="火焰底部裁切 %" value={selected.cropBottomPct} min={0} max={60} step={1} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { element.cropBottomPct = clamp(finite(value, 28), 0, 60); })} />}
              </div>
              <div className="layout-calibration__coordinates">
                <span>container: {selected.containerId}</span>
                <span>center: {selectedCenter?.x.toFixed(4)}, {selectedCenter?.y.toFixed(4)}</span>
              </div>
            </section>
          )}

          <section className="layout-calibration__section">
            <h3>背景 · {profile}</h3>
            <label className="layout-calibration__toggle">
              <input
                type="checkbox"
                checked={history.snapshot?.background.rawOriginal ?? false}
                onChange={event => history.transact(draft => { draft.background.rawOriginal = event.target.checked; })}
              />
              直接使用原图
            </label>
            {history.snapshot && (
              <div className="layout-calibration__field-grid">
                <NumberField label="opacity" value={history.snapshot.background.opacity} min={0} max={1} step={.05} disabled={history.snapshot.background.rawOriginal} onBegin={history.begin} onCommit={history.commit} onChange={value => updateBackground(background => { background.opacity = clamp(finite(value, 1), 0, 1); })} />
                <NumberField label="brightness" value={history.snapshot.background.brightness} min={0} max={2} step={.05} disabled={history.snapshot.background.rawOriginal} onBegin={history.begin} onCommit={history.commit} onChange={value => updateBackground(background => { background.brightness = clamp(finite(value, 1), 0, 2); })} />
                <NumberField label="veil" value={history.snapshot.background.veilOpacity} min={0} max={1} step={.05} disabled={history.snapshot.background.rawOriginal || !getLayoutNode(`${screen}.veil`)} onBegin={history.begin} onCommit={history.commit} onChange={value => updateBackground(background => { background.veilOpacity = clamp(finite(value), 0, 1); })} />
                <NumberField label="wash" value={history.snapshot.background.washOpacity} min={0} max={1} step={.05} disabled={history.snapshot.background.rawOriginal || !hasWash} onBegin={history.begin} onCommit={history.commit} onChange={value => updateBackground(background => { background.washOpacity = clamp(finite(value), 0, 1); })} />
              </div>
            )}
          </section>

          {selected?.frame && (
            <section className="layout-calibration__section">
              <h3>框体 / 卡片</h3>
              <div className="layout-calibration__field-grid">
                <NumberField label="frame opacity" value={selected.frame.frameOpacity} min={0} max={1} step={.05} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { if (element.frame) element.frame.frameOpacity = clamp(finite(value, 1), 0, 1); })} />
                <NumberField label="fill opacity" value={selected.frame.fillOpacity} min={0} max={1} step={.05} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { if (element.frame) element.frame.fillOpacity = clamp(finite(value, 1), 0, 1); })} />
                <NumberField label="glass alpha" value={selected.frame.glassOpacity} min={0} max={1} step={.05} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { if (element.frame) element.frame.glassOpacity = clamp(finite(value, 1), 0, 1); })} />
                <NumberField label="border alpha" value={selected.frame.borderOpacity} min={0} max={1} step={.05} onBegin={history.begin} onCommit={history.commit} onChange={value => updateElement(selected.id, element => { if (element.frame) element.frame.borderOpacity = clamp(finite(value, 1), 0, 1); })} />
              </div>
              <div className="layout-calibration__ornaments">
                {(Object.keys(CENTER_PIECES) as Array<keyof typeof CENTER_PIECES>).map(side => (
                  <label key={side}><input type="checkbox" checked={selected.frame?.centerOrnaments[side] ?? false} onChange={event => history.transact(draft => { const frame = draft.elements[selected.id].frame; if (frame) frame.centerOrnaments[side] = event.target.checked; })} />{side}</label>
                ))}
              </div>
              <p className="layout-calibration__future">cornerScale、railThickness、centerOrnamentScale：MVP 后续（当前不伪造覆盖）。</p>
            </section>
          )}

          <section className="layout-calibration__section">
            <h3>快照</h3>
            <div className="layout-calibration__toolbar">
              <button type="button" onClick={exportSnapshot}>下载并复制 JSON</button>
              <button type="button" onClick={importSnapshot} disabled={!importText.trim()}>导入当前快照</button>
            </div>
            <textarea value={importText} onChange={event => setImportText(event.target.value)} placeholder="粘贴当前 screen/profile 的 schemaVersion 1 JSON" rows={4} />
            {exportFallback && <textarea className="layout-calibration__fallback" value={exportFallback} readOnly rows={5} onFocus={event => event.currentTarget.select()} />}
            {notice && <p className="layout-calibration__notice" role="status">{notice}</p>}
          </section>

          <footer className="layout-calibration__panel-footer">
            <span>拖动=1步 · Shift等比 · Alt中心 · 方向键微调</span>
            <button type="button" onClick={() => setExited(true)}>退出编辑</button>
          </footer>
        </aside>
      )}
    </div>
  );
}
