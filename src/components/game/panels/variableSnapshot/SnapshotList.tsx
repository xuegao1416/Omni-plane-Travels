import { useState, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, RotateCcw, Save,
  ChevronLeft, ChevronRight as ChevronRightNav,
} from 'lucide-react';
import type { SnapshotLayer } from './types';
import { formatTime, getSnapshotPreview } from './types';
import { ToolBtn } from './shared';
import { SNAPSHOT_PAGE_SIZE } from './constants';
import { SnapshotDetail } from './SnapshotDetail';

interface Props {
  snapshotLayers: SnapshotLayer[];
  getLayerEditText: (layer: SnapshotLayer) => string;
  layerModified: Set<string>;
  onLoadLatest: (layer: SnapshotLayer) => void;
  onRollbackRequest: (layer: SnapshotLayer) => void;
  onLayerEdit: (layerId: string, text: string) => void;
}

export function SnapshotList({
  snapshotLayers, getLayerEditText, layerModified,
  onLoadLatest, onRollbackRequest, onLayerEdit,
}: Props) {
  const [snapshotPage, setSnapshotPage] = useState(0);
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());

  const totalPages = Math.ceil(snapshotLayers.length / SNAPSHOT_PAGE_SIZE);
  const pagedLayers = snapshotLayers.slice(
    snapshotPage * SNAPSHOT_PAGE_SIZE,
    (snapshotPage + 1) * SNAPSHOT_PAGE_SIZE,
  );

  const toggleLayer = useCallback((layerId: string) => {
    setExpandedLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }, []);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
      {/* 分页控制 */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: '8px 0',
          marginBottom: '12px',
        }}>
          <ToolBtn onClick={() => setSnapshotPage(Math.max(0, snapshotPage - 1))} disabled={snapshotPage === 0}>
            <ChevronLeft size={14} />
          </ToolBtn>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
            第 {snapshotPage + 1} / {totalPages} 页 · 共 {snapshotLayers.length} 层
          </span>
          <ToolBtn onClick={() => setSnapshotPage(Math.min(totalPages - 1, snapshotPage + 1))} disabled={snapshotPage >= totalPages - 1}>
            <ChevronRightNav size={14} />
          </ToolBtn>
        </div>
      )}

      {/* 层列表 */}
      {pagedLayers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 'var(--font-size-base)' }}>
          暂无快照数据。进行几轮对话后会自动生成快照。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pagedLayers.map((layer, idx) => {
            const isExpanded = expandedLayers.has(layer.id);
            const isModified = layerModified.has(layer.id);
            const isLatest = idx === 0 && snapshotPage === 0;
            const globalIdx = snapshotPage * SNAPSHOT_PAGE_SIZE + idx;
            const preview = getSnapshotPreview(layer.snapshot);

            return (
              <div key={layer.id} style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                background: isLatest ? 'var(--accent-dim)' : 'var(--bg-secondary)',
              }}>
                {/* 层头 */}
                <div
                  onClick={() => toggleLayer(layer.id)}
                  className="wb-entry-toggle"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}

                  <span style={{
                    fontSize: 'var(--font-size-sm)', fontWeight: '700',
                    color: isLatest ? 'var(--accent)' : 'var(--text-muted)',
                    minWidth: 28,
                  }}>
                    #{globalIdx}
                  </span>

                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatTime(layer.snapshotTime)}
                  </span>

                  {preview && (
                    <span style={{
                      fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      flex: 1,
                    }}>
                      {preview}
                    </span>
                  )}

                  {isLatest && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--font-size-sm)', fontWeight: '600',
                      background: 'var(--accent)', color: 'var(--color-on-accent)',
                    }}>最新</span>
                  )}

                  {isModified && (
                    <span style={{
                      padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--font-size-sm)', fontWeight: '600',
                      background: 'var(--warning)', color: 'var(--color-on-accent)',
                    }}>已修改</span>
                  )}

                  {/* 操作按钮 */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {isLatest ? (
                      <ToolBtn
                        onClick={(e) => { e.stopPropagation(); onLoadLatest(layer); }}
                        title="加载编辑后的状态"
                        disabled={!isModified}
                      >
                        <Save size={12} />
                      </ToolBtn>
                    ) : (
                      <ToolBtn
                        onClick={(e) => { e.stopPropagation(); onRollbackRequest(layer); }}
                        title="回滚到此层"
                      >
                        <RotateCcw size={12} />
                      </ToolBtn>
                    )}
                  </div>
                </div>

                {/* 展开内容 */}
                {isExpanded && (
                  <SnapshotDetail
                    layer={layer}
                    editText={getLayerEditText(layer)}
                    isLatest={isLatest}
                    onEditTextChange={(text) => onLayerEdit(layer.id, text)}
                    onApply={() => onLoadLatest(layer)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
