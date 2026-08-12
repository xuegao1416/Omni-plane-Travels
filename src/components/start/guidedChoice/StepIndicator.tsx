import { Check } from 'lucide-react';
import type { DimensionSelection } from '../../../worldgen/choice';
import { GUIDED_DIMENSIONS } from './dimensions';

interface StepIndicatorProps {
  currentDimIndex: number;
  selections: DimensionSelection[];
  onJump: (index: number) => void;
}

export function StepIndicator({ currentDimIndex, selections, onJump }: StepIndicatorProps) {
  return (
    <div className="guided-choice-step-indicator" role="tablist" aria-label="世界织构维度">
      {GUIDED_DIMENSIONS.map((dim, i) => {
        const isActive = i === currentDimIndex;
        const isCompleted = selections.some(s => s.dimensionKey === dim.key);
        const isSkipped = i < currentDimIndex && !isCompleted;
        return (
          <div className="guided-choice-step" key={dim.key}>
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`${i + 1}. ${dim.label}`}
              className={`guided-choice-step__button${isActive ? ' is-active' : ''}${isCompleted ? ' is-complete' : ''}`}
              onClick={() => (isCompleted || i < currentDimIndex) && onJump(i)}
            >
              <span className="guided-choice-step__badge">
                <img src={dim.emblem} alt="" aria-hidden="true" />
                {isCompleted && <Check className="guided-choice-step__check" size={11} />}
                {isSkipped && <span className="guided-choice-step__skip">–</span>}
              </span>
              <b>{dim.label}</b>
            </button>
            {i < GUIDED_DIMENSIONS.length - 1 && <span className={`guided-choice-step__line${isCompleted ? ' is-complete' : ''}`} aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}
