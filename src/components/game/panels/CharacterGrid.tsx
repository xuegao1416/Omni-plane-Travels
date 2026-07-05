import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import EmptyState from '../../shared/EmptyState';
import { imageDb } from '../../../storage/imageDb';
import type { CharacterGridProps } from './characterGrid/types';
import { NPCCard } from './characterGrid/NPCCard';
import { NPCDetail } from './characterGrid/NPCDetail';

export default function CharacterGrid({ gameState, worldId, onUpdateChronicles, onMergeChronicles }: CharacterGridProps) {
  const npcs = gameState.人物档案;
  const [selected, setSelected] = useState<{ id: string; data: import('../../../schema/variables').NPCData } | null>(null);
  const [portraitUrls, setPortraitUrls] = useState<Record<string, string>>({});

  const sorted = Object.entries(npcs).sort((a, b) => (b[1].关系数据?.好感度 ?? 0) - (a[1].关系数据?.好感度 ?? 0));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const urls: Record<string, string> = {};
      for (const [id, npc] of sorted) {
        const ext = npc as any;
        const blobKey = ext.portraitBlobKey || `portrait-${id}`;
        try {
          const record = await imageDb.getBlob(blobKey);
          if (!cancelled && record?.blob) {
            urls[id] = URL.createObjectURL(record.blob);
          }
        } catch { /* no portrait */ }
      }
      if (!cancelled) setPortraitUrls(urls);
    })();
    return () => { cancelled = true; };
  }, [sorted.map(([id]) => id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ padding: '12px 16px' }}>
      <div className="grid-responsive" style={{ '--grid-card-min': '220px', gap: '12px' } as React.CSSProperties}>
        {sorted.map(([id, npc]) => (
          <NPCCard key={id} id={id} npc={npc} portraitSrc={portraitUrls[id]} onClick={() => setSelected({ id, data: npc })} />
        ))}
      </div>
      {sorted.length === 0 && (
        <EmptyState icon={Users} message="暂无人物档案" />
      )}
      {selected && (
        <NPCDetail
          npc={selected.data} npcId={selected.id}
          onClose={() => setSelected(null)}
          onUpdateChronicles={onUpdateChronicles}
          onMergeChronicles={onMergeChronicles}
          worldId={worldId}
        />
      )}
    </div>
  );
}
