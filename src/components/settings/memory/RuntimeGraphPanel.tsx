import { useState, useCallback } from 'react';
import { Download, Activity } from 'lucide-react';
import { useMemoryStore } from '../../../memory/memoryStore';
import { Button } from '../SettingsUIComponents';
import type { RuntimeGraphPanelProps } from './runtimeGraph/types';
import { RUNTIME_TABS } from './runtimeGraph/constants';
import { StatPill } from './runtimeGraph/StatPill';
import { PreviewCards } from './runtimeGraph/PreviewCards';
import { TabContent } from './runtimeGraph/TabContent';
import { GraphView } from './runtimeGraph/GraphView';

export function RuntimeGraphPanel({
  config, memoryRuntime, vectorMemory, stats, search, activeTab,
  onSearchChange, onTabChange, onOpenEditor,
  onOpenExportPicker, onOpenVectorExtract,
  isExporting,
}: RuntimeGraphPanelProps) {
  const rt = memoryRuntime;
  const isSimple = config.memoryMode === 'simple';
  const visibleTabs = isSimple ? RUNTIME_TABS.filter(t => t.key !== 'vector') : RUNTIME_TABS;
  const activeTabLabel = RUNTIME_TABS.find(t => t.key === activeTab)?.label ?? activeTab;
  const [viewMode, setViewMode] = useState<'graph' | 'json'>('graph');

  const getTabData = useCallback((): unknown[] => {
    if (!rt) return [];
    switch (activeTab) {
      case 'scene': return rt.sceneAnchor ? [rt.sceneAnchor] : [];
      case 'threads': return rt.activeThreads ?? [];
      case 'states': return rt.stateSlots ?? [];
      case 'relations': return rt.relationEdges ?? [];
      case 'relationNetwork': return rt.relationNetwork ?? [];
      case 'events': return rt.eventCards ?? [];
      case 'entities': return rt.entityCards ?? [];
      case 'archives': return rt.archiveCards ?? [];
      case 'vector': return vectorMemory ?? [];
      case 'mutations': return rt.mutationLog ?? [];
      case 'checkpoints': return rt.checkpoints ?? [];
      case 'logs': return [...(rt.writeDebugLogs ?? []), ...(rt.retrieveDebugLogs ?? []), ...(rt.compileDebugLogs ?? [])];
      case 'summary': return rt.summarySaveHistory ?? [];
      default: return [];
    }
  }, [rt, vectorMemory, activeTab]);
  const tabData = getTabData();
  const filteredData = search.trim()
    ? tabData.filter(item => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()))
    : tabData;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 标题 + 操作按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>运行态图谱</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button disabled={isExporting} onClick={onOpenExportPicker} icon={<Download size={12} />}>
            导出记忆
          </Button>
        </div>
      </div>

      {/* 统计 Pill */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }}>
        <StatPill label="模式" value={config.enabled ? '已启用' : '已关闭'} />
        <StatPill label="对象总量" value={stats.totalObjects} />
        <StatPill label="写入游标" value={stats.lastIngestCursor} />
        <StatPill label="Mutation" value={stats.mutationCount} />
        <StatPill label="Checkpoint" value={stats.checkpointCount} />
        {!isSimple && <StatPill label="向量事实" value={vectorMemory.length} />}
      </div>
      {/* 预览卡片网格 */}
      <PreviewCards rt={rt} isSimple={isSimple} config={config} vectorMemory={vectorMemory} onOpenVectorExtract={onOpenVectorExtract} />
      {/* 搜索 + Tab */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <input
          type="text"
          placeholder="搜索当前图谱节点 / 标签 / 摘要关键词"
          value={search} onChange={e => onSearchChange(e.target.value)}
          style={{
            maxWidth: '420px', padding: '7px 10px',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)',
            fontSize: 'var(--font-size-base)', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {visibleTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              style={{
                padding: '5px 12px',
                border: `1px solid ${activeTab === tab.key ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                background: activeTab === tab.key ? 'var(--accent-dim)' : 'var(--bg-secondary)',
                color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 'var(--font-size-sm)', fontWeight: activeTab === tab.key ? '600' : '400',
                cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {/* 图谱 Shell */}
      <GraphView rt={rt} vectorMemory={vectorMemory} activeTab={activeTab} search={search}>
        {({ graphDefinition, nodeDetails }) => (
          <TabContent
            filteredData={filteredData}
            tabData={tabData}
            activeTabLabel={activeTabLabel}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            graphDefinition={graphDefinition}
            nodeDetails={nodeDetails}
            onOpenEditor={onOpenEditor}
            activeTab={activeTab}
          />
        )}
      </GraphView>
      {/* 调试日志 */}
      {config.debug.enabled && (
        <details style={{ marginTop: 16, background: 'var(--bg-secondary)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)' }}>
          <summary style={{ cursor: 'pointer', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', color: 'var(--accent)' }}>调试日志</span>
              <span style={{
                padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
                background: (rt?.writeDebugLogs?.length ?? 0) > 0
                  ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'var(--bg-tertiary)',
                color: (rt?.writeDebugLogs?.length ?? 0) > 0 ? 'var(--success)' : 'var(--text-muted)',
              }}>
                写入 {(rt?.writeDebugLogs?.length ?? 0)} / 检索 {(rt?.retrieveDebugLogs?.length ?? 0)} / 编译 {(rt?.compileDebugLogs?.length ?? 0)}
              </span>
            </div>
          </summary>
          <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Button onClick={() => { const store = useMemoryStore.getState(); store.clearDebugLogs(); }}>
              清空日志
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}
