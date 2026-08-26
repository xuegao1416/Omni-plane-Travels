import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ProfessionDef } from '../../../modules/schema';
import OverlayPortal from '../../shared/OverlayPortal';
import { EntrySlicedButton } from '../EntrySurface';
import TarotCard from './TarotCard';

interface ProfessionTarotOverlayProps {
  professions: ProfessionDef[];
  selectedId: string | null;
  allowNoProfession: boolean;
  onConfirm: (id: string | null) => void;
  onClose: () => void;
}

const NO_PROFESSION_KEY = '__no_profession__';

export default function ProfessionTarotOverlay({
  professions,
  selectedId,
  allowNoProfession,
  onConfirm,
  onClose,
}: ProfessionTarotOverlayProps) {
  const [flippedKey, setFlippedKey] = useState<string | null>(null);
  const [collapsing, setCollapsing] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cards: Array<ProfessionDef | null> = allowNoProfession
    ? [null, ...professions]
    : professions;
  const flippedProfession = flippedKey === NO_PROFESSION_KEY
    ? null
    : professions.find(profession => profession.id === flippedKey) ?? null;
  const hasFlippedCard = flippedKey !== null;

  useEffect(() => () => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
  }, []);

  const handleFlip = (id: string | null) => {
    if (collapsing) return;
    setFlippedKey(id ?? NO_PROFESSION_KEY);
  };

  const handleConfirm = () => {
    if (!hasFlippedCard || collapsing) return;
    setCollapsing(true);
    const collapseDuration = 360 + Math.min(cards.length, 12) * 28;
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null;
      onConfirm(flippedKey === NO_PROFESSION_KEY ? null : flippedKey);
    }, collapseDuration);
  };

  return (
    <OverlayPortal
      className={`profession-tarot-overlay${collapsing ? ' is-collapsing' : ''}`}
      ariaLabel="职业牌阵"
      onClose={allowNoProfession ? onClose : undefined}
      closeOnBackdrop={false}
      closeOnEscape={allowNoProfession}
    >
      <div className="profession-tarot-overlay__inner">
        <header className="profession-tarot-overlay__header">
          <div>
            <span>命运牌阵</span>
            <h2>职业牌阵</h2>
            <small>道路数量由当前职业典藏决定</small>
          </div>
          {allowNoProfession && (
            <button type="button" className="profession-tarot-overlay__close" onClick={onClose} aria-label="关闭职业牌阵" title="关闭">
              <X size={19} />
            </button>
          )}
        </header>

        <div
          className="profession-tarot-fan"
          style={{ '--tarot-count': cards.length } as React.CSSProperties}
          aria-label="可选职业牌"
        >
          {cards.map((profession, index) => {
            const key = profession?.id ?? NO_PROFESSION_KEY;
            return (
              <TarotCard
                key={key}
                profession={profession}
                index={index}
                total={cards.length}
                flipped={flippedKey === key}
                selected={profession ? selectedId === profession.id : selectedId === null}
                onFlip={handleFlip}
              />
            );
          })}
        </div>

        <footer className="profession-tarot-overlay__footer">
          <div aria-live="polite">
            {hasFlippedCard
              ? <><strong>{flippedProfession?.name ?? '无职者'}</strong><span>{flippedProfession?.archetype ?? '自由之道'}</span></>
              : <span>命运仍在牌背后静候</span>}
          </div>
          <EntrySlicedButton
            frame="dawn-v4-compact"
            tone="primary"
            icon={Check}
            onClick={handleConfirm}
            disabled={!hasFlippedCard || collapsing}
          >
            {collapsing ? '命运收拢中' : `选择「${flippedProfession?.name ?? '无职者'}」`}
          </EntrySlicedButton>
        </footer>
      </div>
    </OverlayPortal>
  );
}
