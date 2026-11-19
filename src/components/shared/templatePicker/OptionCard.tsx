/**
 * 选项卡片 — 主视图中的操作选项
 */
import type { OptionCardProps } from './types';
import s from './styles.module.css';

export function OptionCard({ icon, title, desc, onClick }: OptionCardProps) {
  return (
    <button type="button" className={s.optionCard} onClick={onClick}>
      <div className={s.optionIcon}>
        {icon}
      </div>
      <div className={s.optionCopy}>
        <div className={s.optionTitle}>{title}</div>
        <div className={s.optionDesc}>{desc}</div>
      </div>
      <span className={s.optionArrow} aria-hidden="true" />
    </button>
  );
}
