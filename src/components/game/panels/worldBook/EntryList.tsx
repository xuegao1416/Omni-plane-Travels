import { Lock, MapPin, Layers } from 'lucide-react';
import type { MappedEntry } from './types';
import { EntryCard } from './EntryDetail';

// ─── Entry group (constant / triggered / other) ───

function EntryGroup({
  title, icon, entries, expandedIds, onToggle,
}: {
  title: string;
  icon: React.ReactNode;
  entries: MappedEntry[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (entries.length === 0) return null;

  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
        fontWeight: '600', marginBottom: '6px', textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {icon}
        {title}
        <span style={{ fontWeight: '400' }}>({entries.length})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {entries.map(entry => (
          <EntryCard
            key={entry.id}
            entry={entry}
            expanded={expandedIds.has(entry.id)}
            onToggle={() => onToggle(entry.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Full entry list with three groups ───

export interface EntryListProps {
  totalEntries: number;
  filteredEntries: MappedEntry[];
  constant: MappedEntry[];
  triggered: MappedEntry[];
  other: MappedEntry[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}

export function EntryList({
  totalEntries, filteredEntries, constant, triggered, other, expandedIds, onToggle,
}: EntryListProps) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px' }}>
      {filteredEntries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          {totalEntries === 0 ? '当前世界没有世界书条目' : '没有匹配的条目'}
        </div>
      ) : (
        <>
          <EntryGroup
            title="常驻条目"
            icon={<Lock size={13} />}
            entries={constant}
            expandedIds={expandedIds}
            onToggle={onToggle}
          />
          <EntryGroup
            title="关键词触发"
            icon={<MapPin size={13} />}
            entries={triggered}
            expandedIds={expandedIds}
            onToggle={onToggle}
          />
          <EntryGroup
            title="其他"
            icon={<Layers size={13} />}
            entries={other}
            expandedIds={expandedIds}
            onToggle={onToggle}
          />
        </>
      )}
    </div>
  );
}
