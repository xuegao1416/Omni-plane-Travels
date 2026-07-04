import { useState, useEffect, useRef, useCallback } from 'react';
import type { NodeDetail } from './types';
import { ensureMermaidInit, getMermaid, getNodeKeyFromDomId } from './mermaidInit';

interface UseMermaidRenderParams {
  graphDefinition: string;
  nodeDetails: Record<string, NodeDetail>;
  svgContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function useMermaidRender({
  graphDefinition, nodeDetails, svgContainerRef,
}: UseMermaidRenderParams) {
  const [renderedSvg, setRenderedSvg] = useState('');
  const [renderError, setRenderError] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [graphSize, setGraphSize] = useState({ width: 0, height: 0 });
  const renderId = useRef(0);

  const getGraphMetrics = useCallback(() => {
    const svgEl = svgContainerRef.current?.querySelector('svg');
    if (!svgEl) return { width: 0, height: 0 };

    const widthAttr = Number(svgEl.getAttribute('width'));
    const heightAttr = Number(svgEl.getAttribute('height'));
    if (Number.isFinite(widthAttr) && widthAttr > 0 && Number.isFinite(heightAttr) && heightAttr > 0) {
      return { width: widthAttr, height: heightAttr };
    }

    const viewBox = svgEl.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return { width: viewBox.width, height: viewBox.height };
    }

    const rect = svgEl.getBBox?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }

    const domRect = svgEl.getBoundingClientRect();
    return { width: domRect.width || 0, height: domRect.height || 0 };
  }, [svgContainerRef]);

  useEffect(() => {
    if (!graphDefinition?.trim()) {
      setRenderedSvg('');
      setRenderError('');
      setGraphSize({ width: 0, height: 0 });
      return;
    }

    let cancelled = false;
    const currentId = ++renderId.current;

    async function render() {
      setIsRendering(true);
      setRenderError('');
      try {
        await ensureMermaidInit();
        const mermaid = await getMermaid();
        const id = `mermaid-graph-${currentId}-${Date.now()}`;
        const { svg } = await mermaid.default.render(id, graphDefinition);

        if (!cancelled) {
          setRenderedSvg(svg || '');
          await new Promise(resolve => requestAnimationFrame(resolve));

          if (!cancelled && svgContainerRef.current) {
            const svgEl = svgContainerRef.current.querySelector('svg');
            if (svgEl) {
              svgEl.removeAttribute('width');
              svgEl.removeAttribute('height');
              svgEl.style.maxWidth = 'none';
              svgEl.style.maxHeight = 'none';
              svgEl.style.overflow = 'visible';
              svgEl.style.display = 'block';
              svgEl.setAttribute('preserveAspectRatio', 'xMinYMin meet');
              setGraphSize(getGraphMetrics());
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[MermaidGraphPanel] 渲染失败:', err);
          setRenderError(err instanceof Error ? err.message : String(err));
          setRenderedSvg('');
        }
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    }

    render();
    return () => { cancelled = true; };
  }, [graphDefinition, getGraphMetrics, svgContainerRef]);

  useEffect(() => {
    if (!svgContainerRef.current || !renderedSvg) return;
    const timer = requestAnimationFrame(() => {
      if (!svgContainerRef.current) return;
      const nodeElements = svgContainerRef.current.querySelectorAll('g.node');
      nodeElements.forEach(el => {
        const domId = el.id || el.getAttribute('data-id') || '';
        const key = getNodeKeyFromDomId(domId, nodeDetails);
        if (nodeDetails[key]) {
          (el as HTMLElement).style.cursor = 'pointer';
          el.classList.add('interactive-node');
        }
      });
    });
    return () => cancelAnimationFrame(timer);
  }, [renderedSvg, nodeDetails, svgContainerRef]);

  return { renderedSvg, renderError, isRendering, graphSize, getGraphMetrics };
}
