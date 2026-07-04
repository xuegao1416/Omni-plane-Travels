import type { StepWorldDetailProps } from './stepWorldDetail/types';
import { WorldOverview, DefaultFreeMode } from './stepWorldDetail/WorldOverview';
import { WorldStats } from './stepWorldDetail/WorldStats';
import { WorldEntries } from './stepWorldDetail/WorldEntries';

export default function StepWorldDetail({
  selectedWorld, allWorlds, worldEntry, onNext, onPrev, onEditWorld,
}: StepWorldDetailProps) {
  const world = allWorlds.find(w => w.id === selectedWorld);

  // No world selected -> free mode
  if (!world) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <DefaultFreeMode worldEntry={worldEntry} />
        <NavButtons onPrev={onPrev} onNext={onNext} />
      </div>
    );
  }

  const accentColor = world.coverColor || 'var(--accent)';
  const entries = world.worldBookEntries;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <WorldOverview world={world} accentColor={accentColor} worldEntry={worldEntry} onEditWorld={onEditWorld} />
      <WorldEntries entries={entries} accentColor={accentColor} worldEntry={worldEntry} />
      <WorldStats entries={entries} accentColor={accentColor} />
      <NavButtons onPrev={onPrev} onNext={onNext} />
    </div>
  );
}

function NavButtons({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
      <button className="btn-secondary" onClick={onPrev} style={{ padding: '10px 24px' }}>← 上一步</button>
      <button className="btn-primary" onClick={onNext} style={{ padding: '10px 32px', fontSize: 'var(--font-size-lg)' }}>下一步 →</button>
    </div>
  );
}
