import { memo,useEffect } from 'react';
import { dawnSceneBus } from './scene/sceneBus';

const hearth = (on: boolean) => dawnSceneBus.setFocus({ coreHover: on });

/**
 * 晨雾琉璃 start prompt: a frosted crystal plaque standing in front of the
 * bonfire, so the flames glow through the glass. A gilded outline (SVG, the
 * chamfers included), gems on gold rules at both ends and a light sweep
 * across the glass. Hover / focus feeds the scene's hearth and the fire flares.
 */
export default memo(function DawnStartPlaque({ label, onStart }: { label: string; onStart: () => void }) {
  useEffect(() => () => hearth(false), []);
  return (
    <button
      type="button"
      className="pl-home__start dw-start"
      onClick={event => { event.stopPropagation(); hearth(false); onStart(); }}
      onPointerEnter={() => hearth(true)}
      onPointerLeave={() => hearth(false)}
      onFocus={() => hearth(true)}
      onBlur={() => hearth(false)}
    >
      <span className="dw-start__glass" aria-hidden="true"><i className="dw-start__sweep" /></span>
      <svg className="dw-start__frame" viewBox="0 0 260 52" aria-hidden="true" focusable="false">
        <polygon className="dw-start__edge" points="14,.75 246,.75 259.25,26 246,51.25 14,51.25 .75,26" />
        <polygon className="dw-start__edge dw-start__edge--inner" points="16.5,4.5 243.5,4.5 254.75,26 243.5,47.5 16.5,47.5 5.25,26" />
      </svg>
      <span className="dw-start__label">{label}</span>
    </button>
  );
});
