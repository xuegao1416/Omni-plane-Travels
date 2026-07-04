import { Swords, AlertTriangle, DollarSign, Flag } from 'lucide-react';
import type { WorldBookEntryDef } from '../../../data/worlds-schema';
import { findEntryByType, findAllEntriesByType } from './utils';

interface WorldStatsProps {
  entries: WorldBookEntryDef[] | undefined;
  accentColor: string;
}

/** Statistics section: rules, economy & time, factions */
export function WorldStats({ entries, accentColor }: WorldStatsProps) {
  const rulesEntry = findEntryByType(entries, 'rules');
  const economyEntry = findEntryByType(entries, 'economy');
  const factionEntries = findAllEntriesByType(entries, 'factions');
  const allFactions = factionEntries.flatMap(e => e.meta?.factions ?? []);

  const hasRules = !!rulesEntry;
  const hasEconomy = !!economyEntry;
  const hasFactions = allFactions.length > 0;

  if (!hasRules && !hasEconomy && !hasFactions) return null;

  return (
    <>
      {/* World rules */}
      {hasRules && rulesEntry && (
        <div className="surface-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '10px', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Swords size={14} />世界规则
          </div>
          {rulesEntry.meta && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                {rulesEntry.meta.powerSystem && (
                  <div style={{ padding: '10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '4px' }}>力量体系</div>
                    <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)' }}>{rulesEntry.meta.powerSystem}</div>
                  </div>
                )}
                {rulesEntry.meta.socialStructure && (
                  <div style={{ padding: '10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '4px' }}>社会结构</div>
                    <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)' }}>{rulesEntry.meta.socialStructure}</div>
                  </div>
                )}
              </div>
              {rulesEntry.meta.specialRules && rulesEntry.meta.specialRules.length > 0 && (
                <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {rulesEntry.meta.specialRules.map((rule, i) => (
                    <span key={i} style={{
                      fontSize: 'var(--font-size-sm)', padding: '3px 10px', borderRadius: '12px',
                      background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', gap: '4px',
                    }}><AlertTriangle size={10} /> {rule}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Economy & time */}
      {hasEconomy && economyEntry && (
        <div className="surface-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '10px', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <DollarSign size={14} />经济 & 时间
          </div>
          {economyEntry.meta && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              {economyEntry.meta.currency && (
                <div style={{ padding: '10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '4px' }}>货币</div>
                  <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)' }}>
                    {economyEntry.meta.currency.symbol} {economyEntry.meta.currency.name}
                    {economyEntry.meta.currency.description && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginLeft: '6px' }}>{economyEntry.meta.currency.description}</span>}
                  </div>
                </div>
              )}
              {economyEntry.meta.priceLevel && (
                <div style={{ padding: '10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '4px' }}>物价水平</div>
                  <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)' }}>{economyEntry.meta.priceLevel}</div>
                </div>
              )}
              {economyEntry.meta.calendar && (
                <div style={{ padding: '10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '4px' }}>纪年</div>
                  <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)' }}>{economyEntry.meta.calendar}</div>
                </div>
              )}
              {economyEntry.meta.startTime && (
                <div style={{ padding: '10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '4px' }}>开始时间</div>
                  <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-primary)' }}>{economyEntry.meta.startTime}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Factions */}
      {hasFactions && (
        <div>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Flag size={14} />势力 ({allFactions.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
            {allFactions.map((f, i) => (
              <div key={i} className="surface-card" style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontWeight: '600', fontSize: 'var(--font-size-md)' }}>{f.name}</span>
                  {f.alignment && (
                    <span style={{
                      fontSize: 'var(--font-size-xs)', padding: '1px 8px', borderRadius: '10px',
                      background: f.alignment === '友善' ? '#22c55e18' : f.alignment === '敌对' ? '#ef444418' : '#f59e0b18',
                      color: f.alignment === '友善' ? '#22c55e' : f.alignment === '敌对' ? '#ef4444' : '#f59e0b',
                    }}>{f.alignment}</span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '1.4' }}>{f.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
