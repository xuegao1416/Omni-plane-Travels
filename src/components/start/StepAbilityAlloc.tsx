import type { CSSProperties } from 'react';
import { BarChart3, Minus, Plus } from 'lucide-react';
import { statPointGain } from '../../gameplay/creation/creationPoints';

interface StepAbilityAllocProps {
  statConfig: Record<string, unknown>;
  allocations: Record<string, number>;
  poolRemaining: number;
  onChange: (next: Record<string, number>) => void;
}

interface AbilityRow {
  key: string;
  name: string;
  base: number;
  min: number;
  cap: number;
  gain: number;
}

type TrackStyle = CSSProperties & {
  '--fill': number;
  '--gain-start': number;
  '--gain-width': number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function allocationFor(allocations: Record<string, number>, key: string): number {
  const value = allocations[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function buildAbilityRows(statConfig: Record<string, unknown>): AbilityRow[] {
  const rows: AbilityRow[] = [];
  for (const key of ['attrA', 'attrB']) {
    const attr = asRecord(statConfig[key]);
    const base = finiteNumber(attr?.current);
    const cap = finiteNumber(attr?.max);
    if (!attr || base === null || cap === null || cap <= 0) continue;
    rows.push({
      key,
      name: typeof attr.name === 'string' && attr.name.trim() ? attr.name : key,
      base: Math.min(cap, Math.max(0, base)),
      min: 0,
      cap,
      gain: statPointGain(cap),
    });
  }

  for (const key of ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6']) {
    const dim = asRecord(statConfig[key]);
    const range = Array.isArray(dim?.range) ? dim.range : [];
    const base = finiteNumber(dim?.value);
    const min = finiteNumber(range[0]) ?? 0;
    const cap = finiteNumber(range[1]);
    if (!dim || base === null || cap === null || cap <= min) continue;
    rows.push({
      key,
      name: typeof dim.name === 'string' && dim.name.trim() ? dim.name : key,
      base: Math.min(cap, Math.max(min, base)),
      min,
      cap,
      gain: statPointGain(cap),
    });
  }

  const special = Array.isArray(statConfig.special) ? statConfig.special : [];
  for (const item of special) {
    const stat = asRecord(item);
    const range = Array.isArray(stat?.range) ? stat.range : [];
    const id = typeof stat?.id === 'string' ? stat.id : '';
    const base = finiteNumber(stat?.value);
    const min = finiteNumber(range[0]) ?? 0;
    const cap = finiteNumber(range[1]);
    if (!stat || !id || base === null || cap === null || cap <= min) continue;
    rows.push({
      key: id,
      name: typeof stat.name === 'string' && stat.name.trim() ? stat.name : id,
      base: Math.min(cap, Math.max(min, base)),
      min,
      cap,
      gain: statPointGain(cap),
    });
  }
  return rows;
}

function displayValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function StepAbilityAlloc({
  statConfig,
  allocations,
  poolRemaining,
  onChange,
}: StepAbilityAllocProps) {
  const rows = buildAbilityRows(statConfig);

  const step = (key: string, delta: -1 | 1) => {
    const current = allocationFor(allocations, key);
    const nextValue = Math.max(0, current + delta);
    const next = { ...allocations };
    if (nextValue === 0) delete next[key];
    else next[key] = nextValue;
    onChange(next);
  };

  return (
    <section className="alloc-panel" aria-label="降临点数分配">
      <header className="alloc-panel__heading">
        <span><BarChart3 size={16} aria-hidden="true" /><strong>降临点数 · 属性分配</strong></span>
        <span className="alloc-panel__pool">剩余 <strong>{poolRemaining}</strong> 点</span>
      </header>
      <p className="alloc-panel__hint">每 1 点约提升该属性上限的 5%；进入世界后无法重置。</p>

      <div className="alloc-panel__rows">
        {rows.map(row => {
          const allocation = allocationFor(allocations, row.key);
          const current = Math.min(row.cap, Math.max(row.min, row.base + allocation * row.gain));
          const nextWouldOverflow = current + row.gain > row.cap;
          const span = row.cap - row.min;
          const style: TrackStyle = {
            '--fill': Math.max(0, Math.min(1, (current - row.min) / span)),
            '--gain-start': Math.max(0, Math.min(1, (row.base - row.min) / span)),
            '--gain-width': Math.max(0, Math.min(1, (current - row.base) / span)),
          };
          return (
            <div className="alloc-row" key={row.key}>
              <span className="alloc-row__name">{row.name}</span>
              <span className="alloc-row__value">{displayValue(current)}<i>/{displayValue(row.cap)}</i></span>
              <div
                className="alloc-track"
                style={style}
                role="progressbar"
                aria-label={`${row.name}当前值`}
                aria-valuemin={row.min}
                aria-valuemax={row.cap}
                aria-valuenow={current}
              >
                <span className="alloc-track__mid" aria-hidden="true" />
                <span className="alloc-track__fill" aria-hidden="true" />
                <span className="alloc-track__gain" aria-hidden="true" />
              </div>
              <div className="alloc-stepper">
                <button
                  type="button"
                  aria-label={`减少${row.name}`}
                  title={`减少${row.name}`}
                  disabled={allocation <= 0}
                  onClick={() => step(row.key, -1)}
                ><Minus size={15} /></button>
                <b className="alloc-stepper__count" aria-label={`${row.name}已分配 ${allocation} 点`}>
                  {allocation > 0 ? `+${allocation}` : '·'}
                </b>
                <button
                  type="button"
                  aria-label={`增加${row.name}`}
                  title={`增加${row.name}`}
                  disabled={poolRemaining <= 0 || nextWouldOverflow}
                  onClick={() => step(row.key, 1)}
                ><Plus size={15} /></button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="alloc-panel__empty">当前世界没有可分配的初始属性。</p>}
      </div>
    </section>
  );
}
