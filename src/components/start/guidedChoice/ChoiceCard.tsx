import { Check } from 'lucide-react';
import type { DimensionChoice } from '../../../worldgen/choice';

interface ChoiceCardProps {
  choice: DimensionChoice;
  dimColor: string;
  isSelected: boolean;
  onSelect: () => void;
}

export function ChoiceCard({ choice, dimColor: _dimColor, isSelected, onSelect }: ChoiceCardProps) {
  return (
    <button type="button" onClick={onSelect} className={`guided-choice-option${isSelected ? ' is-selected' : ''}`} aria-pressed={isSelected}>
      <span className="guided-choice-option__badge">{choice.id}</span>
      <span className="guided-choice-option__copy">
        <strong>{choice.title}</strong>
        <small>{choice.subtitle}</small>
      </span>
      {isSelected && <Check className="guided-choice-option__check" size={16} />}
    </button>
  );
}

interface CustomCardProps {
  dimColor: string;
  dimLabel: string;
  isCustomSelected: boolean;
  isEditingCustom: boolean;
  displayTitle: string;
  displaySubtitle: string;
  onSelect: () => void;
}

export function CustomCard({
  dimColor: _dimColor, dimLabel, isCustomSelected, isEditingCustom,
  displayTitle, displaySubtitle, onSelect,
}: CustomCardProps) {
  return (
    <button type="button" onClick={onSelect} className={`guided-choice-option guided-choice-option--custom${isCustomSelected ? ' is-selected' : ''}${isEditingCustom ? ' is-editing' : ''}`} aria-pressed={isCustomSelected}>
      <span className="guided-choice-option__badge">E</span>
      <span className="guided-choice-option__copy">
        <strong>{displayTitle}</strong>
        <small>{displaySubtitle || `为${dimLabel}添加自己的设定`}</small>
      </span>
      {isCustomSelected && <Check className="guided-choice-option__check" size={16} />}
    </button>
  );
}
