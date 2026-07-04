import { GitBranch, Code } from 'lucide-react';
import { Button } from '../../SettingsUIComponents';
import { MermaidGraphPanel, type NodeDetail } from '../../../shared/MermaidGraphPanel';

interface TabContentProps {
  filteredData: unknown[];
  tabData: unknown[];
  activeTabLabel: string;
  viewMode: 'graph' | 'json';
  onViewModeChange: (mode: 'graph' | 'json') => void;
  graphDefinition: string;
  nodeDetails: Record<string, NodeDetail>;
  onOpenEditor: (tabKey: string) => void;
  activeTab: string;
}

export function TabContent({
  filteredData, tabData, activeTabLabel, viewMode, onViewModeChange,
  graphDefinition, nodeDetails, onOpenEditor, activeTab,
}: TabContentProps) {
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      {/* Header with view mode toggle */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: '700', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '2px' }}>
            记忆图谱
          </span>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
            当前标签：{activeTabLabel} ｜ 命中 {filteredData.length} 项
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => onViewModeChange('graph')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', border: `1px solid ${viewMode === 'graph' ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
              background: viewMode === 'graph' ? 'var(--accent-dim)' : 'transparent',
              color: viewMode === 'graph' ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: viewMode === 'graph' ? '600' : '400',
            }}
          >
            <GitBranch size={12} />图谱
          </button>
          <button
            onClick={() => onViewModeChange('json')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', border: `1px solid ${viewMode === 'json' ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
              background: viewMode === 'json' ? 'var(--accent-dim)' : 'transparent',
              color: viewMode === 'json' ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', fontWeight: viewMode === 'json' ? '600' : '400',
            }}
          >
            <Code size={12} />JSON
          </button>
        </div>
      </div>

      {/* Content area */}
      {filteredData.length === 0 ? (
        <div style={{ padding: '16px', textAlign: 'center', fontSize: 'var(--font-size-base)', color: 'var(--text-muted)' }}>当前分类暂无数据。</div>
      ) : viewMode === 'graph' ? (
        <div style={{ padding: 12 }}>
          <MermaidGraphPanel
            graphDefinition={graphDefinition}
            nodeDetails={nodeDetails}
            title={activeTabLabel}
            subtitle={`${filteredData.length} 个节点`}
            style={{ minHeight: 360, maxHeight: 520 }}
          />
        </div>
      ) : (
        <div style={{ padding: 16, maxHeight: 400, overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              显示 {filteredData.length} / {tabData.length} 项
            </span>
            <Button onClick={() => onOpenEditor(activeTab)}>编辑原始内容</Button>
          </div>
          <pre style={{
            padding: '12px', minHeight: 120, maxHeight: 300,
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-primary)', color: 'var(--text-primary)',
            fontSize: 12, fontFamily: "var(--font-mono, 'Consolas', monospace)",
            lineHeight: 1.6, whiteSpace: 'pre-wrap', overflow: 'auto',
            pointerEvents: 'none', resize: 'vertical',
          }}>
            {JSON.stringify(filteredData.slice(0, 20), null, 2)}
            {filteredData.length > 20 && `\n\n... 还有 ${filteredData.length - 20} 项`}
          </pre>
        </div>
      )}
    </div>
  );
}
