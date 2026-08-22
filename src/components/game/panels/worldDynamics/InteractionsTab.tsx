/**
 * 世界动态面板 — NPC 主动交互标签页
 */

import { Trash2, Radio } from 'lucide-react';
import { getSimulationEngine } from '../../../../simulation/SimulationApi';
import type { NpcProactiveInteraction } from '../../../../simulation/types';
import { NpcInteractionCard } from './NpcInteractionCard';

interface InteractionsTabProps {
  interactions: NpcProactiveInteraction[];
  onUseAction?: (text: string) => void;
}

export function InteractionsTab({ interactions, onUseAction }: InteractionsTabProps) {
  return (
    <>
      <div style={{ padding: '6px 8px', marginBottom: 8, color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', lineHeight: 1.5 }}>
        这里是后台角色提出的联系候选。只有放入主输入框并由正文承接后，才算旅程中真正发生的交互。
      </div>
      {interactions.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <button
            onClick={() => getSimulationEngine().clearAllInteractions()}
            className="btn-ghost btn-xs"
            style={{ color: 'var(--danger)', fontSize: 'var(--font-size-xs)' }}
          >
            <Trash2 size={10} style={{ marginRight: '4px' }} />
            全部清除
          </button>
        </div>
      )}
      {interactions.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '32px 16px', gap: '8px',
          color: 'var(--text-muted)', textAlign: 'center',
        }}>
          <Radio size={32} opacity={0.4} />
          <div style={{ fontSize: 'var(--font-size-base)' }}>暂无 NPC 主动联系</div>
          <div style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>
            当离场角色有重要事务时，会在此处显示
          </div>
        </div>
      ) : (
        interactions.map(interaction => (
          <NpcInteractionCard key={interaction.id} interaction={interaction} onUseAction={onUseAction} />
        ))
      )}
    </>
  );
}
