import { Globe, ScrollText, Pencil } from 'lucide-react';
import type { WorldDef } from '../../../data/worlds-schema';
import { WORLDS } from '../../../data/worldLoader';
import type { WorldBookEntry } from '../../../worldbook/index';
import { WorldIcon } from '../../shared/worldIcons';

interface WorldOverviewProps {
  world: WorldDef;
  accentColor: string;
  worldEntry: WorldBookEntry | null;
  onEditWorld: (world: WorldDef) => void;
}

/** Banner section showing world name, description, tags, and difficulty */
export function WorldOverview({ world, accentColor, worldEntry, onEditWorld }: WorldOverviewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header banner */}
      <div style={{
        background: `linear-gradient(135deg, ${accentColor}22, ${accentColor}08)`,
        border: `1px solid ${accentColor}33`,
        borderRadius: 'var(--radius-lg)', padding: '1.25rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          {world.icon && <WorldIcon name={world.icon} size={28} />}
          <h3 style={{ fontSize: '1.3rem', fontWeight: '700', color: accentColor, flex: 1 }}>{world.name}</h3>
          {!WORLDS.find(w => w.id === world.id) && (
            <button
              className="btn-secondary"
              onClick={() => onEditWorld(world)}
              style={{ padding: '4px 14px', fontSize: 'var(--font-size-sm)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
            ><Pencil size={12} /> 编辑</button>
          )}
        </div>
        <p style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: '1.5' }}>{world.description}</p>
        {world.tags && world.tags.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
            {world.tags.map(tag => (
              <span key={tag} style={{
                fontSize: 'var(--font-size-xs)', padding: '2px 10px', borderRadius: '12px',
                background: `${accentColor}18`, color: accentColor, fontWeight: '500',
              }}>{tag}</span>
            ))}
            {world.difficulty && (
              <span style={{
                fontSize: 'var(--font-size-xs)', padding: '2px 10px', borderRadius: '12px',
                background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: world.difficulty === 'easy' ? '#22c55e' : world.difficulty === 'medium' ? '#f59e0b' : '#ef4444',
                }} />
                {world.difficulty === 'easy' ? '简单' : world.difficulty === 'medium' ? '中等' : '困难'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* World setting narrative */}
      {worldEntry && (
        <div className="surface-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ScrollText size={14} />世界设定
          </div>
          <div style={{ fontSize: 'var(--font-size-md)', lineHeight: '1.8', color: 'var(--text-primary)', maxHeight: '400px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
            {worldEntry.content.length > 2000 ? worldEntry.content.substring(0, 2000) + '...' : worldEntry.content}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fallback display when no world is selected (free mode) */
export function DefaultFreeMode({ worldEntry }: { worldEntry: WorldBookEntry | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{
        background: 'linear-gradient(135deg, var(--accent)22, var(--accent)08)',
        border: '1px solid var(--accent)33',
        borderRadius: 'var(--radius-lg)', padding: '1.25rem',
      }}>
        <h3 style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--accent)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Globe size={20} />默认自由模式
        </h3>
        <p style={{ fontSize: 'var(--font-size-md)', color: 'var(--text-secondary)', lineHeight: '1.5' }}>无特定世界观限制，自由穿越到任何想象中的世界。</p>
      </div>
      {worldEntry && (
        <div className="surface-card" style={{ padding: '1.25rem' }}>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ScrollText size={14} />世界设定
          </div>
          <div style={{ fontSize: 'var(--font-size-md)', lineHeight: '1.8', color: 'var(--text-primary)', maxHeight: '400px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
            {worldEntry.content.length > 2000 ? worldEntry.content.substring(0, 2000) + '...' : worldEntry.content}
          </div>
        </div>
      )}
    </div>
  );
}
