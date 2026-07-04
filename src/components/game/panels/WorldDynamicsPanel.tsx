/**
 * 世界动态面板 — 展示后台推演的世界事件和玩家切入点
 *
 * 薄编排层：子组件已拆分至 ./worldDynamics/ 子目录
 */

import { useState } from 'react';
import { Globe } from 'lucide-react';
import { useSimulationStore } from '../../../stores/simulationStore';

import type { WorldDynamicsPanelProps } from './worldDynamics/types';
import { EventsTab } from './worldDynamics/EventsTab';
import { StorylinesTab } from './worldDynamics/StorylinesTab';
import { InteractionsTab } from './worldDynamics/InteractionsTab';
import { SimSettings } from './worldDynamics/SimSettings';

export default function WorldDynamicsPanel({ gameState, onManualTick, isSimulating }: WorldDynamicsPanelProps) {
  const { simState } = useSimulationStore();
  const [activeTab, setActiveTab] = useState<'events' | 'storylines' | 'interactions' | 'settings'>('events');

  const eventsMap = simState.events ?? {};
  const activeEvents = Object.values(eventsMap).filter(
    e => e.status === 'active' || e.status === 'brewing',
  );
  activeEvents.sort((a, b) => b.severity - a.severity);

  const offscreenNpcs = gameState
    ? Object.entries(gameState.人物档案 ?? {})
        .filter(([, npc]) => (npc.人物分类 === '离场' || npc.人物分类 === '重点') && npc.重要NPC)
        .slice(0, 10)
    : [];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden',
    }}>
      {/* 标题栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Globe size={16} color="var(--accent)" />
          <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>
            世界动态
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['events', 'storylines', 'interactions', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={activeTab === tab ? 'btn-primary btn-xs' : 'btn-ghost btn-xs'}
              style={tab === 'interactions' ? { position: 'relative' } : undefined}
            >
              {tab === 'events' ? '事件' : tab === 'storylines' ? '暗线' : tab === 'interactions' ? '交互' : '设置'}
              {tab === 'interactions' && (simState.pendingInteractions ?? []).length > 0 && (
                <span className="notification-dot">
                  {simState.pendingInteractions.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {activeTab === 'events' && (
          <EventsTab
            activeEvents={activeEvents}
            tickCount={simState.tickCount}
            worldNewsSummary={simState.worldNewsSummary}
            onManualTick={onManualTick}
            isSimulating={isSimulating}
          />
        )}

        {activeTab === 'storylines' && (
          <StorylinesTab offscreenNpcs={offscreenNpcs} storylines={simState.storylines ?? {}} />
        )}

        {activeTab === 'interactions' && (
          <InteractionsTab interactions={simState.pendingInteractions ?? []} />
        )}

        {activeTab === 'settings' && (
          <SimSettings />
        )}
      </div>
    </div>
  );
}
