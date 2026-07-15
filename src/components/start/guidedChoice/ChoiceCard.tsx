import type { DimensionChoice, DimensionSelection } from '../../../worldgen/choice';
import { cardStyle } from './styles';

interface ChoiceCardProps {
  choice: DimensionChoice;
  dimColor: string;
  isSelected: boolean;
  onSelect: () => void;
}

/** 普通选项卡片（A/B/C/D） */
export function ChoiceCard({ choice, dimColor, isSelected, onSelect }: ChoiceCardProps) {
  return (
    <button
      onClick={onSelect}
      style={{
        ...cardStyle,
        border: `2px solid ${isSelected ? dimColor : 'var(--border)'}`,
        background: isSelected ? `${dimColor}15` : 'var(--bg-secondary)',
      }}
      onMouseEnter={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = `${dimColor}80`;
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = `0 4px 12px ${dimColor}20`;
        }
      }}
      onMouseLeave={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }
      }}
    >
      <CardBadge id={choice.id} dimColor={dimColor} isSelected={isSelected} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
          {choice.title}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem', lineHeight: 1.4 }}>
          {choice.subtitle}
        </div>
      </div>
      {isSelected && <CheckMark dimColor={dimColor} />}
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

/** 自定义选项卡片（E） */
export function CustomCard({
  dimColor, isCustomSelected, isEditingCustom,
  displayTitle, displaySubtitle, onSelect,
}: CustomCardProps) {
  return (
    <button
      onClick={onSelect}
      style={{
        ...cardStyle,
        border: `2px solid ${isCustomSelected ? dimColor : isEditingCustom ? `${dimColor}80` : 'var(--border)'}`,
        background: isCustomSelected ? `${dimColor}15` : isEditingCustom ? `${dimColor}08` : 'var(--bg-secondary)',
      }}
      onMouseEnter={e => {
        if (!isCustomSelected) {
          e.currentTarget.style.borderColor = `${dimColor}80`;
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = `0 4px 12px ${dimColor}20`;
        }
      }}
      onMouseLeave={e => {
        if (!isCustomSelected) {
          e.currentTarget.style.borderColor = isEditingCustom ? `${dimColor}80` : 'var(--border)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = 'none';
        }
      }}
    >
      <CardBadge id="E" dimColor={dimColor} isSelected={isCustomSelected} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>
          {displayTitle}
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem', lineHeight: 1.4 }}>
          {displaySubtitle}
        </div>
      </div>
      {isCustomSelected && <CheckMark dimColor={dimColor} />}
    </button>
  );
}

/** 选项标识徽章 */
function CardBadge({ id, dimColor, isSelected }: { id: string; dimColor: string; isSelected: boolean }) {
  return (
    <div
      style={{
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        background: isSelected ? dimColor : `${dimColor}20`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isSelected ? '#fff' : dimColor,
        fontWeight: 700,
        fontSize: '0.85rem',
        flexShrink: 0,
      }}
    >
      {id}
    </div>
  );
}

/** 选中标记圆点 */
function CheckMark({ dimColor }: { dimColor: string }) {
  return (
    <div
      style={{
        width: '22px',
        height: '22px',
        borderRadius: 'var(--radius-md)',
        background: dimColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: '0.7rem',
        flexShrink: 0,
      }}
    >
      {'\u2713'}
    </div>
  );
}
