import { useState, useEffect, useRef, useCallback } from 'react';
import type { MermaidGraphPanelProps, NodeDetail } from './mermaidGraph/types';
import { getNodeKeyFromDomId, SURFACE_PADDING } from './mermaidGraph/mermaidInit';
import { useMermaidRender } from './mermaidGraph/useMermaidRender';
import { usePanZoom } from './mermaidGraph/usePanZoom';
import { ZoomControls } from './mermaidGraph/ZoomButton';
import { NodeDetailPopup } from './mermaidGraph/NodeDetailPopup';
import s from './MermaidGraphPanel.module.css';

export type { NodeDetail, MermaidGraphPanelProps };

export function MermaidGraphPanel({
  graphDefinition,
  nodeDetails = {},
  title,
  subtitle,
  onNodeClick,
  className,
  style,
}: MermaidGraphPanelProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeDetailPopup, setNodeDetailPopup] = useState<{
    nodeId: string; detail: NodeDetail; x: number; y: number;
  } | null>(null);

  const { renderedSvg, renderError, isRendering, graphSize } = useMermaidRender({
    graphDefinition, nodeDetails, svgContainerRef,
  });

  const handlePointerTap = useCallback((clientX: number, clientY: number, target: HTMLElement) => {
    const nodeEl = target.closest('g.node') as HTMLElement;
    if (!nodeEl) return;
    const domId = nodeEl.id || nodeEl.getAttribute('data-id') || '';
    const key = getNodeKeyFromDomId(domId, nodeDetails);
    if (!nodeDetails[key]) return;
    setSelectedNodeId(key);
    setNodeDetailPopup({ nodeId: key, detail: nodeDetails[key], x: clientX, y: clientY });
    onNodeClick?.(key, nodeDetails[key]);
  }, [nodeDetails, onNodeClick]);

  const panZoom = usePanZoom({ viewportRef, graphSize, onPointerTap: handlePointerTap });

  useEffect(() => {
    if (graphSize.width > 0 && graphSize.height > 0) {
      panZoom.fitGraphToViewport();
    }
  }, [graphSize, panZoom.fitGraphToViewport]);

  const closePopup = useCallback(() => {
    setNodeDetailPopup(null);
    setSelectedNodeId(null);
  }, []);

  const selectedDetail = selectedNodeId ? nodeDetails[selectedNodeId] : null;

  return (
    <div className={`${s.panel}${className ? ` ${className}` : ''}`} style={style}>
      {(title || subtitle) && (
        <div className={s.titleBar}>
          <div>
            {title && <div className={s.title}>{title}</div>}
            {subtitle && <div className={s.subtitle}>{subtitle}</div>}
          </div>
          <ZoomControls
            scale={panZoom.scale}
            onZoomIn={panZoom.zoomIn}
            onZoomOut={panZoom.zoomOut}
            onReset={panZoom.resetView}
          />
        </div>
      )}

      <div
        ref={viewportRef}
        onWheel={panZoom.handleWheel}
        onPointerDown={panZoom.handlePointerDown}
        onPointerMove={panZoom.handlePointerMove}
        onPointerUp={panZoom.handlePointerUp}
        onPointerCancel={panZoom.handlePointerUp}
        className={`${s.viewport} ${panZoom.isDragging ? s.viewportGrabbing : s.viewportGrab}`}
      >
        <div
          className={s.surface}
          style={{
            padding: SURFACE_PADDING,
            transform: `translate(${panZoom.translateX}px, ${panZoom.translateY}px) scale(${panZoom.scale})`,
            width: graphSize.width > 0 ? graphSize.width : undefined,
            height: graphSize.height > 0 ? graphSize.height : undefined,
          }}
        >
          <div
            ref={svgContainerRef}
            data-mermaid-container
            dangerouslySetInnerHTML={{ __html: renderedSvg }}
            className={s.svgContainer}
            style={{
              width: graphSize.width > 0 ? graphSize.width : undefined,
              height: graphSize.height > 0 ? graphSize.height : undefined,
            }}
          />
        </div>

        {isRendering && (
          <div className={`${s.overlay} ${s.overlayDark}`}>图谱渲染中...</div>
        )}

        {renderError && (
          <div className={`${s.overlay} ${s.overlayError}`}>图谱渲染失败：{renderError}</div>
        )}

        {!graphDefinition?.trim() && !isRendering && !renderError && (
          <div className={s.overlay}>暂无图谱数据</div>
        )}
      </div>

      {nodeDetailPopup && selectedDetail && (
        <NodeDetailPopup detail={selectedDetail} onClose={closePopup} />
      )}

      <style>{`
        [data-mermaid-container] svg {
          display: block; width: 100%; height: 100%;
          max-width: none !important; max-height: none !important;
          overflow: visible; shape-rendering: geometricPrecision;
          text-rendering: geometricPrecision; image-rendering: optimizeQuality;
        }
        [data-mermaid-container] .edgeLabel, [data-mermaid-container] .label,
        [data-mermaid-container] foreignObject, [data-mermaid-container] text,
        [data-mermaid-container] tspan {
          font-family: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif !important;
        }
        [data-mermaid-container] g.node.interactive-node {
          cursor: pointer; pointer-events: auto; transition: filter 0.18s ease;
        }
        [data-mermaid-container] g.node.interactive-node:hover rect,
        [data-mermaid-container] g.node.interactive-node:hover circle,
        [data-mermaid-container] g.node.interactive-node:hover polygon,
        [data-mermaid-container] g.node.interactive-node:hover path {
          filter: drop-shadow(0 0 14px rgba(255, 220, 150, 0.2)) drop-shadow(0 0 22px rgba(212, 168, 83, 0.16));
          stroke: #ffe2a0 !important; stroke-width: 2px !important;
        }
      `}</style>
    </div>
  );
}
