/**
 * 世界动态面板 — 暗线列表标签页
 */

import { Trash2 } from 'lucide-react';
import { getSimulationEngine } from '../../../../simulation/SimulationApi';
import type { CharacterStoryline } from '../../../../simulation/types';
import { StorylineEntry } from './StorylineEntry';
import { EmptyState } from './EmptyState';

interface StorylinesTabProps {
  offscreenNpcs: [string, { 姓名: string }][];
  storylines: Record<string, CharacterStoryline>;
}

export function StorylinesTab({ offscreenNpcs, storylines }: StorylinesTabProps) {
  return (
    <>
      {Object.keys(storylines).length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button
            onClick={() => getSimulationEngine().clearAllStorylines()}
            className="btn-ghost btn-xs"
            style={{ color: 'var(--danger)', fontSize: 'var(--font-size-xs)' }}
          >
            <Trash2 size={10} style={{ marginRight: '4px' }} />
            全部清除
          </button>
        </div>
      )}
      {offscreenNpcs.length === 0 && Object.keys(storylines).length === 0 ? (
        <EmptyState />
      ) : (
        offscreenNpcs.map(([npcId, npc]) => (
          <StorylineEntry key={npcId} npcId={npcId} npcName={npc.姓名} />
        ))
      )}
      {Object.entries(storylines)
        .filter(([id]) => !offscreenNpcs.some(([nid]) => nid === id))
        .map(([npcId]) => (
          <StorylineEntry key={npcId} npcId={npcId} npcName={npcId} />
        ))}
    </>
  );
}
