import type { CSSProperties,ReactNode } from 'react';
import type { DawnV4BorderLayer,DawnV4Mode } from './dawnV4Assembly';
import { getDawnV4LayerOrder } from './dawnV4Assembly';
import { FrameCorner,FrameCrest,FrameStud } from '../../../ui/planar/Ornaments';

export interface DawnFrameV4CalibrationProps {
  containerId: string;
  editable?: boolean;
  label?: string;
}

export interface DawnFrameV4Props {
  children?: ReactNode;
  mode?: DawnV4Mode;
  withFill?: boolean;
  /** Optional inner guide line; ordinary frames stay ornament-only. */
  withUnderlay?: boolean;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  calibration?: DawnFrameV4CalibrationProps;
  /** Decorative border is front-most by default. Use the exception only when content must intentionally cross it. */
  borderLayer?: DawnV4BorderLayer;
  gem?: 'amber' | 'garnet' | 'sapphire';
}

/**
 * Historical DawnFrameV4 API and class contract (`__fill` / `__border` /
 * `__content`), now painted by the planar kit: a bevelled brass rail with
 * acanthus corners around a woven night-cloth field, all drawn in code.
 */
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
  gem = 'amber',
}: DawnFrameV4Props) {
  const layerOrder = getDawnV4LayerOrder(borderLayer);
  const isPanel = mode !== 'compact';

  return (
    <div
      className={`dawn-frame-v4 pk-frame pk-frame--${isPanel ? 'grand' : 'plate'} pk-frame--cloth dawn-frame-v4--${mode} dawn-frame-v4--border-${borderLayer}${withFill ? ' dawn-frame-v4--with-fill' : ''}${withUnderlay ? ' dawn-frame-v4--with-underlay' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      aria-label={ariaLabel}
      data-layout-id={calibration?.containerId}
      data-layout-label={calibration ? calibration.label ?? '星仪框' : undefined}
    >
      <span className="dawn-frame-v4__fill" aria-hidden="true" style={{ zIndex: layerOrder.fill }}>
        <span className="pk-frame__rail" />
        <span className="pk-frame__field" />
      </span>
      {withUnderlay && <span className="dawn-frame-v4__underlay" aria-hidden="true" />}
      <span className="dawn-frame-v4__border pk-frame__ornaments" aria-hidden="true" style={{ zIndex: layerOrder.border }}>
        <FrameCorner gem={gem} className="pk-frame__corner pk-frame__corner--tl" />
        <FrameCorner gem={gem} className="pk-frame__corner pk-frame__corner--tr" />
        <FrameCorner gem={gem} className="pk-frame__corner pk-frame__corner--bl" />
        <FrameCorner gem={gem} className="pk-frame__corner pk-frame__corner--br" />
        {isPanel && (
          <>
            <FrameCrest gem={gem} className="pk-frame__crest" />
            <FrameStud className="pk-frame__stud" />
          </>
        )}
      </span>
      <span className="dawn-frame-v4__content" style={{ zIndex: layerOrder.content }}>{children}</span>
    </div>
  );
}
