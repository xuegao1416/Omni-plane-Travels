import { ChevronLeft, ChevronRight, SkipForward } from 'lucide-react';
import {
  bottomBarStyle, navBtnStyle, primaryBtnStyle, skipBtnStyle,
} from './styles';

interface BottomNavProps {
  currentDimIndex: number;
  totalDims: number;
  canProceed: boolean;
  isLastDimension: boolean;
  dimRequired: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}

export function BottomNav({
  currentDimIndex, totalDims, canProceed, isLastDimension, dimRequired,
  onPrev, onNext, onSkip,
}: BottomNavProps) {
  return (
    <div style={bottomBarStyle}>
      <button
        onClick={onPrev}
        disabled={currentDimIndex === 0}
        style={{ ...navBtnStyle, opacity: currentDimIndex === 0 ? 0.5 : 1, cursor: currentDimIndex === 0 ? 'not-allowed' : 'pointer' }}
      >
        <ChevronLeft size={16} />
        上一步
      </button>

      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        {currentDimIndex + 1} / {totalDims}
      </span>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {!dimRequired && (
          <button onClick={onSkip} style={skipBtnStyle}>
            <SkipForward size={14} />
            跳过
          </button>
        )}
        <button
          onClick={onNext}
          disabled={!canProceed}
          style={{ ...primaryBtnStyle, opacity: canProceed ? 1 : 0.5, cursor: canProceed ? 'pointer' : 'not-allowed' }}
        >
          {isLastDimension ? '完成选择' : '下一步'}
          {!isLastDimension && <ChevronRight size={16} />}
        </button>
      </div>
    </div>
  );
}
