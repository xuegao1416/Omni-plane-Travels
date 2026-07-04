import { useRef, useCallback } from 'react';
import { Layers, Download, Upload, RefreshCw } from 'lucide-react';
import type { SnapshotLayer } from './types';
import { ToolBtn } from './shared';

interface Props {
  snapshotLayers: SnapshotLayer[];
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
  onRefresh: () => void;
}

export function SnapshotToolbar({ snapshotLayers, onExport, onImport, onRefresh }: Props) {
  const importRef = useRef<HTMLInputElement>(null);

  const handleImportChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onImport(file);
    if (importRef.current) importRef.current.value = '';
  }, [onImport]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 16px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 'var(--radius-md)',
          background: 'var(--accent-dim)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)',
        }}>
          <Layers size={18} />
        </div>
        <div>
          <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: '700', color: 'var(--text-primary)' }}>
            数据快照
          </div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
            {snapshotLayers.length} 层快照
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImportChange}
        />
        <ToolBtn onClick={onExport} title="导出快照"><Download size={14} /></ToolBtn>
        <ToolBtn onClick={() => importRef.current?.click()} title="导入快照"><Upload size={14} /></ToolBtn>
        <ToolBtn onClick={onRefresh} title="刷新"><RefreshCw size={14} /></ToolBtn>
      </div>
    </div>
  );
}
