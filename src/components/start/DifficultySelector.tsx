import { ShieldCheck } from 'lucide-react';
import type { CombatRiskMode } from '../../gameplay/protocols';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_DESCRIPTIONS,
  DIFFICULTY_POINT_DESCRIPTIONS,
  computeCreationPool,
} from '../../gameplay/creation/creationPoints';

interface DifficultySelectorProps {
  value: CombatRiskMode;
  onChange: (mode: CombatRiskMode) => void;
  /** 有战斗模块时描述文案带战斗风险语义；否则只讲点数。 */
  hasCombat: boolean;
  /** 世界降临点数系数（显示"降临点数 N"用）。 */
  pointScale: number;
}

const ORDER: CombatRiskMode[] = ['easy', 'normal', 'hard', 'inferno'];

const TIER_LABEL: Record<CombatRiskMode, string> = {
  easy: '第一层',
  normal: '第二层',
  hard: '第三层',
  inferno: '第四层',
};

export default function DifficultySelector({ value, onChange, hasCombat, pointScale }: DifficultySelectorProps) {
  return (
    <div className="ritual-difficulty-grid" role="radiogroup" aria-label="降临难度">
      {ORDER.map(mode => {
        const selected = value === mode;
        const pool = computeCreationPool(mode, pointScale);
        const desc = hasCombat ? DIFFICULTY_DESCRIPTIONS[mode] : DIFFICULTY_POINT_DESCRIPTIONS[mode];
        return (
          <button
            type="button"
            key={mode}
            className={`ritual-difficulty-card is-${mode}${selected ? ' is-selected' : ''}`}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(mode)}
          >
            <span className="ritual-difficulty-card__tier">{TIER_LABEL[mode]}</span>
            <strong>{DIFFICULTY_LABELS[mode]}</strong>
            <small>{desc}</small>
            <em className="ritual-difficulty-card__pool">降临点数 {pool}</em>
            {selected && <ShieldCheck size={14} className="ritual-difficulty-card__check" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
