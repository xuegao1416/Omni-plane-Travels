import type { DimensionSelection } from '../../../worldgen/choice';
import { GUIDED_DIMENSIONS } from './dimensions';
import { stepIndicatorStyle } from './styles';

interface StepIndicatorProps {
  currentDimIndex: number;
  selections: DimensionSelection[];
  onJump: (index: number) => void;
}

export function StepIndicator({ currentDimIndex, selections, onJump }: StepIndicatorProps) {
  return (
    <div style={stepIndicatorStyle}>
      {GUIDED_DIMENSIONS.map((dim, i) => {
        const Icon = dim.icon;
        const isActive = i === currentDimIndex;
        const isCompleted = selections.some(s => s.dimensionKey === dim.key);
        const isSkipped = i < currentDimIndex && !isCompleted;
        return (
          <div key={dim.key} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.25rem 0.6rem',
                borderRadius: '20px',
                background: isActive ? dim.color : isCompleted ? `${dim.color}25` : 'transparent',
                color: isActive ? '#fff' : isCompleted ? dim.color : 'var(--text-muted)',
                fontSize: '0.75rem',
                fontWeight: isActive ? 600 : 400,
                transition: 'all 0.2s ease',
                cursor: isCompleted ? 'pointer' : 'default',
              }}
              onClick={() => {
                if (isCompleted || i < currentDimIndex) onJump(i);
              }}
            >
              <span
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: 'var(--radius-md)',
                  background: isActive ? 'rgba(255,255,255,0.3)' : isCompleted ? dim.color : 'var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.65rem',
                  color: isCompleted ? '#fff' : 'var(--text-muted)',
                  fontWeight: 600,
                }}
              >
                {isCompleted ? '\u2713' : isSkipped ? '\u2013' : i + 1}
              </span>
              <span className="guide-step-label">{dim.label}</span>
            </div>
            {i < GUIDED_DIMENSIONS.length - 1 && (
              <div
                style={{
                  width: '16px',
                  height: '1px',
                  background: isCompleted ? dim.color : 'var(--border)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
