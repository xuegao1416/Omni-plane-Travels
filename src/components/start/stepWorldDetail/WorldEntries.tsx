import { ScrollText, MapPin, Clock, Cloud, Sparkles, Flag, User, Landmark, Scroll } from 'lucide-react';
import type { WorldBookEntryDef } from '../../../data/worlds-schema';
import type { WorldBookEntry } from '../../../worldbook/index';
import { findEntryByType, findAllEntriesByType } from './utils';

interface WorldEntriesProps {
  entries: WorldBookEntryDef[] | undefined;
  accentColor: string;
  worldEntry: WorldBookEntry | null;
}

/** World book entries display: setting, NPCs, geography, culture, highlights */
export function WorldEntries({ entries, accentColor, worldEntry }: WorldEntriesProps) {
  const settingEntry = findEntryByType(entries, 'setting');
  const highlightsEntry = findEntryByType(entries, 'highlights');
  const loreEntries = findAllEntriesByType(entries, 'lore');
  const cultureEntry = findEntryByType(entries, 'culture');
  const npcEntries = findAllEntriesByType(entries, 'npcs');
  const allNPCs = npcEntries.flatMap(e => e.meta?.npcs ?? []);

  const hasSetting = !!settingEntry || !!worldEntry;
  const hasNPCs = allNPCs.length > 0;
  const hasHighlights = !!highlightsEntry && highlightsEntry.meta?.highlights && highlightsEntry.meta.highlights.length > 0;

  if (!hasSetting && !hasNPCs && loreEntries.length === 0 && !cultureEntry && !hasHighlights) return null;

  return (
    <>
      {/* World setting narrative */}
      {hasSetting && (
        <div className="surface-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ScrollText size={14} />世界设定
          </div>
          {worldEntry ? (
            <div style={{
              fontSize: 'var(--font-size-md)', lineHeight: '1.8', color: 'var(--text-primary)',
              maxHeight: '400px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-family)',
            }}>
              {worldEntry.content.length > 2000
                ? worldEntry.content.substring(0, 2000) + '...\n\n[完整设定将在游戏中加载]'
                : worldEntry.content}
            </div>
          ) : settingEntry ? (
            <div style={{ fontSize: 'var(--font-size-md)', lineHeight: '1.8', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
              {settingEntry.content}
            </div>
          ) : null}
          {settingEntry?.meta && (
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
              {settingEntry.meta.location && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={12} /> {settingEntry.meta.location}</span>}
              {settingEntry.meta.timePeriod && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {settingEntry.meta.timePeriod}</span>}
              {settingEntry.meta.atmosphere && <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Cloud size={12} /> {settingEntry.meta.atmosphere}</span>}
            </div>
          )}
        </div>
      )}

      {/* NPCs */}
      {hasNPCs && (
        <div>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <User size={14} />关键人物 ({allNPCs.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
            {allNPCs.map((npc, i) => (
              <div key={i} className="surface-card" style={{ padding: '10px 12px' }}>
                <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', marginBottom: '2px' }}>{npc.name}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: accentColor, marginBottom: '4px' }}>{npc.role}</div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '1.4' }}>{npc.description}</div>
                {npc.personality && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>{npc.personality}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Geography / lore */}
      {loreEntries.length > 0 && (
        <div>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Landmark size={14} />地理 ({loreEntries.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {loreEntries.map(entry => (
              <div key={entry.uid} className="surface-card" style={{ padding: '10px 12px' }}>
                <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', marginBottom: '4px' }}>{entry.comment}</div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                  {entry.content.length > 300 ? entry.content.substring(0, 300) + '...' : entry.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Culture */}
      {cultureEntry && (
        <div className="surface-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Scroll size={14} />文化风俗
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
            {cultureEntry.content}
          </div>
        </div>
      )}

      {/* Highlights */}
      {hasHighlights && highlightsEntry && (
        <div>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={14} />核心特色
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {highlightsEntry.meta!.highlights!.map((h, i) => (
              <span key={i} style={{
                fontSize: 'var(--font-size-base)', padding: '6px 14px', borderRadius: '20px',
                background: `${accentColor}12`, color: accentColor, fontWeight: '500',
              }}>{h}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
