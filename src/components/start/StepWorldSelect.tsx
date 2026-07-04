import { Globe, Pencil, Check, Plus } from 'lucide-react';
import type { WorldDef } from '../../data/worldLoader';
import { WORLDS } from '../../data/worldLoader';

interface StepWorldSelectProps {
  selectedWorld: string;
  setSelectedWorld: (id: string) => void;
  createdWorlds: WorldDef[];
  onNext: () => void;
  onEditWorld: (world: WorldDef) => void;
  onCreateWorld: () => void;
  t: (key: string) => string;
}

export default function StepWorldSelect({
  selectedWorld, setSelectedWorld,
  createdWorlds, onNext, onEditWorld, onCreateWorld, t,
}: StepWorldSelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Globe size={18} strokeWidth={1.5} />选择剧本
        </h3>
        <div className="scenario-grid">
          <div
            className={`scenario-card${selectedWorld === 'default' ? ' selected' : ''}`}
            onClick={() => setSelectedWorld('default')}
          >
            <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Globe size={14} />默认自由模式
            </div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '1.4' }}>无特定世界观限制，自由穿越</div>
            {selectedWorld === 'default' && <div style={{ marginTop: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--accent)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={12} /> 已选择</div>}
          </div>
          {WORLDS.map(w => (
            <div
              key={w.id}
              className={`scenario-card${selectedWorld === w.id ? ' selected' : ''}`}
              onClick={() => setSelectedWorld(w.id)}
            >
              <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', marginBottom: '4px' }}>{w.name}</div>
              {w.description && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '1.4' }}>{w.description}</div>}
              {w.tags && w.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {w.tags.slice(0, 3).map(tag => <span key={tag} style={{ fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: '8px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{tag}</span>)}
                </div>
              )}
              {selectedWorld === w.id && <div style={{ marginTop: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--accent)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={12} /> 已选择</div>}
            </div>
          ))}
          {createdWorlds.map(w => (
            <div
              key={w.id}
              className={`scenario-card${selectedWorld === w.id ? ' selected' : ''}`}
              onClick={() => setSelectedWorld(w.id)}
              style={{ position: 'relative' }}
            >
              <button
                onClick={e => { e.stopPropagation(); onEditWorld(w); }}
                title="编辑世界"
                style={{ position: 'absolute', top: 8, right: 8, border: 'none', background: 'var(--bg-tertiary)', width: 24, height: 24, borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
              ><Pencil size={12} /></button>
              <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', marginBottom: '4px', paddingRight: 28 }}>{w.name}</div>
              {w.description && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '1.4' }}>{w.description}</div>}
              {w.tags && w.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {w.tags.slice(0, 3).map(tag => <span key={tag} style={{ fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: '8px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{tag}</span>)}
                </div>
              )}
              {selectedWorld === w.id && <div style={{ marginTop: '8px', fontSize: 'var(--font-size-xs)', color: 'var(--accent)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={12} /> 已选择</div>}
            </div>
          ))}
          <div
            className="scenario-card create-world"
            onClick={onCreateWorld}
          >
            <Plus size={20} strokeWidth={1.5} />
            <span style={{ fontSize: 'var(--font-size-base)' }}>新建世界</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '0.5rem' }}>
        <button className="btn-primary" onClick={onNext} style={{ padding: '10px 32px', fontSize: 'var(--font-size-lg)' }}>下一步 →</button>
      </div>
    </div>
  );
}
