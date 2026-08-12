import { ChevronLeft, ChevronRight, SkipForward } from 'lucide-react';
import { EntrySlicedButton } from '../EntrySurface';

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

export function BottomNav({ currentDimIndex, totalDims, canProceed, isLastDimension, dimRequired, onPrev, onNext, onSkip }: BottomNavProps) {
  return (
    <footer className="guided-choice-bottom-nav">
      <EntrySlicedButton className="guided-choice-nav-button" icon={ChevronLeft} tone="quiet" onClick={onPrev} disabled={currentDimIndex === 0}>上一步</EntrySlicedButton>
      <span className="guided-choice-bottom-nav__count">{currentDimIndex + 1} / {totalDims}</span>
      <div className="guided-choice-bottom-nav__actions">
        {!dimRequired && <EntrySlicedButton className="guided-choice-nav-button guided-choice-nav-button--quiet" icon={SkipForward} tone="quiet" onClick={onSkip}>跳过</EntrySlicedButton>}
        <EntrySlicedButton className="guided-choice-primary" icon={isLastDimension ? undefined : ChevronRight} tone="primary" onClick={onNext} disabled={!canProceed}>{isLastDimension ? '完成推演' : '下一步'}</EntrySlicedButton>
      </div>
    </footer>
  );
}
