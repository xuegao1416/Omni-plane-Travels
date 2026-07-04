import type { GameEngine } from '../../../../engine/types';

/** Props for the top-level WorldBookPanel */
export interface WorldBookPanelProps {
  worldId: string;
  engine?: GameEngine;
}

/** A single mapped entry after processing raw WorldBookEntryDef */
export interface MappedEntry {
  id: string;
  comment: string;
  content: string;
  constant: boolean;
  enabled: boolean;
  keys: string[];
  position: 'before_char' | 'after_char';
  order: number;
  depth: number;
  entryType?: string;
}

/** Props for the EntryGroup sub-component */
export interface EntryGroupProps {
  title: string;
  icon: React.ReactNode;
  entries: MappedEntry[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}

/** Props for a single EntryCard */
export interface EntryCardProps {
  entry: MappedEntry;
  expanded: boolean;
  onToggle: () => void;
}

/** Props for EntryFilters */
export interface EntryFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  showDisabled: boolean;
  onToggleDisabled: () => void;
}
