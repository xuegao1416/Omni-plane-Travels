import type { TransactionEntry } from '../../../../modules/schema';
import { TRANSACTION_TYPE_LABELS } from './constants';

export function TransactionLog({ entries, cycleName }: { entries: TransactionEntry[]; cycleName: string }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {entries.slice(-10).reverse().map((entry, i) => (
        <LogRow key={`${entry.cycle}_${entry.type}_${entry.amount}_${i}`} entry={entry} cycleName={cycleName} />
      ))}
    </div>
  );
}

function LogRow({ entry, cycleName }: { entry: TransactionEntry; cycleName: string }) {
  const t = TRANSACTION_TYPE_LABELS[entry.type] || TRANSACTION_TYPE_LABELS.event;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-xs)' }}>
      <span style={{ color: 'var(--text-muted)', minWidth: '40px' }}>第{entry.cycle}{cycleName}</span>
      <span style={{
        padding: '0 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 600,
        background: `${t.color}15`, color: t.color,
      }}>
        {t.label}
      </span>
      <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{entry.description}</span>
      {entry.amount != null && (
        <span style={{
          fontWeight: 600,
          color: entry.amount >= 0 ? 'var(--success)' : 'var(--danger)',
        }}>
          {entry.amount >= 0 ? '+' : ''}{entry.amount}
        </span>
      )}
    </div>
  );
}
