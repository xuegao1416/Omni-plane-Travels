import s from './ExcelRow.module.css';

export function ExcelRow({ label, value }: { label: string; value: string | number }) {
  const display = value === '' || value == null ? '-' : value;
  return (
    <div className={s.row}>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{display}</span>
    </div>
  );
}
