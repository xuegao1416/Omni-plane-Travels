import { Search,Eye,EyeOff } from 'lucide-react';
import type { EntryFiltersProps } from './types';

/** Search bar and disabled-toggle button */
export function EntryFilters({ search, onSearchChange, showDisabled, onToggleDisabled }: EntryFiltersProps) {
  return (
    <div className="game-worldbook-filters">
      <div className="game-worldbook-search">
        <Search size={14} style={{
          position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
          color: 'var(--text-muted)',
        }} />
        <input
          className="input-field"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="搜索条目..."
          style={{ width: '100%', paddingLeft: '28px' }}
        />
      </div>
      <button
        onClick={onToggleDisabled}
        title={showDisabled ? '隐藏已禁用' : '显示已禁用'}
        className="btn-ghost btn-icon-sm"
      >
        {showDisabled ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
    </div>
  );
}
