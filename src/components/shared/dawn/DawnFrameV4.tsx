import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  DAWN_V4_MASTER_ATLAS,
  DAWN_V4_OVERLAY_PIECES,
  DAWN_V4_RAIL_SEGMENTS,
  getDawnV4Layout,
  getDawnV4LayerOrder,
  type DawnV4BorderLayer,
  type DawnV4Mode,
  type DawnV4PieceLayout,
} from './dawnV4Assembly';

const PIECE_LABELS: Record<string, string> = {
  'top-left': '左上角件',
  'top-right': '右上角件',
  'bottom-left': '左下角件',
  'bottom-right': '右下角件',
  top: '上边条',
  bottom: '下边条',
  left: '左边条',
  right: '右边条',
  'top-center': '上中饰',
  'bottom-center': '下中饰',
  'left-center': '左中饰',
  'right-center': '右中饰',
};

const SEGMENT_LEGACY_IDS: Record<string, string> = {
  'top-left': 'top',
  'bottom-left': 'bottom',
  'left-upper': 'left',
  'right-upper': 'right',
};

export interface DawnFrameV4CalibrationProps {
  containerId: string;
  editable?: boolean;
  label?: string;
}

export interface DawnFrameV4Props {
  children?: ReactNode;
  mode?: DawnV4Mode;
  withFill?: boolean;
  /** Optional seam guide for calibration surfaces; ordinary frames stay ornament-only. */
  withUnderlay?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  calibration?: DawnFrameV4CalibrationProps;
  /** Decorative border is front-most by default. Use the exception only when content must intentionally cross it. */
  borderLayer?: DawnV4BorderLayer;
}

function atlasImageStyle(piece: DawnV4PieceLayout): CSSProperties {
  const [sourceLeft, sourceTop, sourceRight, sourceBottom] = piece.sourceBox;
  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;
  const scaleX = piece.axis === 'x' ? piece.rect.width / sourceWidth : piece.rect.width / sourceWidth;
  const scaleY = piece.axis === 'y' ? piece.rect.height / sourceHeight : piece.rect.height / sourceHeight;
  return {
    position: 'absolute',
    left: -sourceLeft * scaleX,
    top: -sourceTop * scaleY,
    width: 1536 * scaleX,
    height: 1024 * scaleY,
    maxWidth: 'none',
    pointerEvents: 'none',
    userSelect: 'none',
  };
}

function pieceWindowStyle(piece: DawnV4PieceLayout, zIndex: number): CSSProperties {
  return {
    left: piece.rect.left,
    top: piece.rect.top,
    width: piece.rect.width,
    height: piece.rect.height,
    zIndex,
  };
}

function renderPiece(
  id: string,
  piece: DawnV4PieceLayout,
  pieceName: string,
  zIndex: number,
  calibration?: DawnFrameV4CalibrationProps,
  className = '',
) {
  if (!piece.visible) return null;
  const legacyName = id.startsWith('overlay-') ? id.slice('overlay-'.length) : SEGMENT_LEGACY_IDS[id] ?? id;
  const layoutId = calibration
    ? `v4-frame.${id.startsWith('overlay-') ? `piece.${legacyName}` : id === SEGMENT_LEGACY_IDS[id] ? `piece.${legacyName}` : `segment.${id}`}`
    : undefined;
  return (
    <span
      key={id}
      className={`dawn-frame-v4__piece dawn-frame-v4__piece--${id} ${className}`}
      style={pieceWindowStyle(piece, zIndex)}
      data-layout-id={layoutId}
      data-layout-label={calibration ? PIECE_LABELS[legacyName] ?? pieceName : undefined}
      data-layout-editable={calibration?.editable ? 'true' : undefined}
      data-layout-container={calibration?.containerId}
      data-layout-origin={calibration ? 'source-ratio' : undefined}
    >
      <img src={DAWN_V4_MASTER_ATLAS} alt="" draggable={false} style={atlasImageStyle(piece)} />
    </span>
  );
}

export default function DawnFrameV4({
  children,
  mode = 'panel',
  withFill = false,
  withUnderlay = false,
  className = '',
  style,
  ariaLabel,
  calibration,
  borderLayer = 'front',
}: DawnFrameV4Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const layout = getDawnV4Layout(frameSize.width, frameSize.height, mode);
  const layerOrder = getDawnV4LayerOrder(borderLayer);
  const calibrationClass = calibration ? ' dawn-frame-v4--calibration' : '';

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const measure = () => setFrameSize({ width: frame.clientWidth, height: frame.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className={`dawn-frame-v4 dawn-frame-v4--source-ratio dawn-frame-v4--${mode} dawn-frame-v4--border-${borderLayer}${withFill ? ' dawn-frame-v4--with-fill' : ''}${withUnderlay ? ' dawn-frame-v4--with-underlay' : ''}${calibrationClass}${className ? ` ${className}` : ''}`}
      style={style}
      aria-label={ariaLabel}
      data-layout-id={calibration?.containerId}
      data-layout-label={calibration?.label ?? 'Dawn V4 源图拼接框'}
      data-layout-editable={calibration ? 'false' : undefined}
    >
      {withFill && <span className="dawn-frame-v4__fill" aria-hidden="true" style={{ zIndex: layerOrder.fill }} />}
      {withUnderlay && <span className="dawn-frame-v4__underlay" aria-hidden="true" />}
      <span className="dawn-frame-v4__border" aria-hidden="true" style={{ zIndex: layerOrder.border }}>
        {DAWN_V4_RAIL_SEGMENTS.map(segment => {
          const piece = layout.pieces[segment.id];
          return renderPiece(segment.id, piece, `${segment.rail} rail ${segment.id}`, 2, calibration, `dawn-frame-v4__rail-segment dawn-frame-v4__rail-segment--${segment.rail}`);
        })}
        {DAWN_V4_OVERLAY_PIECES.map(overlay => {
          const piece = layout.pieces[`overlay-${overlay.id}`];
          const zIndex = overlay.kind === 'corner' ? 6 : 5;
          return renderPiece(`overlay-${overlay.id}`, piece, PIECE_LABELS[overlay.id], zIndex, calibration, `dawn-frame-v4__overlay-piece dawn-frame-v4__overlay-piece--${overlay.kind}`);
        })}
      </span>
      <span className="dawn-frame-v4__content" style={{ zIndex: layerOrder.content }}>{children}</span>
    </div>
  );
}
