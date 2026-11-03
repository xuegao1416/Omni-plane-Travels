import { useState } from 'react';
import { Users } from 'lucide-react';
import EmptyState from '../../shared/EmptyState';
import { useStoredImageUrls } from '../../../hooks/useStoredImageUrl';
import type { CharacterGridProps } from './characterGrid/types';
import { NPCCard } from './characterGrid/NPCCard';
import { NPCDetail } from './characterGrid/NPCDetail';
import { selectPlayerKnownNPCs } from '../../../engine/playerKnowledge';

export default function CharacterGrid({ gameState, worldId, onUpdateChronicles, onMergeChronicles, onDeleteNpc }: CharacterGridProps) {
  const npcs = selectPlayerKnownNPCs(gameState);
  const [selected, setSelected] = useState<string | null>(null);

  const sorted = Object.entries(npcs).sort((a, b) => (b[1]?.关系数据?.好感度 ?? -Infinity) - (a[1]?.关系数据?.好感度 ?? -Infinity));

  const portraitUrls = useStoredImageUrls(Object.fromEntries(sorted.map(([id, npc]) => [id, (npc as any).portraitBlobKey || `portrait-${id}`])));

  return (
    <div style={{ padding: '12px 16px' }}>
      <div className="grid-responsive" style={{ '--grid-card-min': '220px', gap: '12px' } as React.CSSProperties}>
        {sorted.map(([id, npc]) => (
          <NPCCard key={id} id={id} npc={npc} portraitSrc={portraitUrls[id]} onClick={() => setSelected(id)} />
        ))}
      </div>
      {sorted.length === 0 && (
        <EmptyState icon={Users} message="暂无人物档案" />
      )}
      {selected && npcs[selected] && (
        <NPCDetail
          key={selected} npc={npcs[selected]!} npcId={selected}
          truth={gameState.人物档案?.[selected]}
          onClose={() => setSelected(null)}
          onUpdateChronicles={onUpdateChronicles}
          onMergeChronicles={onMergeChronicles}
          onDeleteNpc={onDeleteNpc}
          worldId={worldId}
          onDeleted={() => setSelected(null)}
        />
      )}
    </div>
  );
}
