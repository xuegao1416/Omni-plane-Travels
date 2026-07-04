import {
  ChevronLeft, ChevronRight as ChevronRightNav,
  ChevronDown, ChevronRight, RotateCcw, Save,
} from 'lucide-react';
import type { SnapshotLayer } from './types';
import { SNAPSHOT_PAGE_SIZE, formatTime, getSnapshotPreview } from './types';
import { ToolBtn } from './shared';

export function SnapshotTab({
  layers, totalLayers, page, totalPages, expandedLayers, layerModified,
  onPageChange, onToggleLayer, getEditText, onEdit, onLoadLatest, onRollback,
}: {
  layers: SnapshotLayer[];
  totalLayers: number;
  page: number;
  totalPages: number;
  expandedLayers: Set<string>;
  layerModified: Set<string>;
  onPageChange: (p: number) => void;
  onToggleLayer: (id: string) => void;
  getEditText: (layer: SnapshotLayer) => string;
  onEdit: (id: string, text: string) => void;
  onLoadLatest: (layer: SnapshotLayer) => void;
  onRollback: (layer: SnapshotLayer) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '8px 0' }}>
          <ToolBtn onClick={() => onPageChange(Math.max(0, page - 1))} disabled={page === 0}>
            <ChevronLeft size={14} />
          </ToolBtn>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
            第 {page + 1} / {totalPages} 页 · 共 {totalLayers} 层
          </span>
          <ToolBtn onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
            <ChevronRightNav size={14} />
          </ToolBtn>
        </div>
      )}

      {layers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 'var(--font-size-base)' }}>
          暂无快照数据。进行几轮对话后会自动生成快照。
        </div>
      ) : (
        layers.map((layer, idx) => {
          const isExpanded = expandedLayers.has(layer.id);
          const isModified = layerModified.has(layer.id);
          const isLatest = idx === 0 && page === 0;
          const globalIdx = page * SNAPSHOT_PAGE_SIZE + idx;
          const preview = getSnapshotPreview(layer.snapshot);

          return (
            <div key={layer.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              background: isLatest ? 'var(--accent-dim)' : 'var(--bg-secondary)',
            }}>
              <div
                onClick={() => onToggleLayer(layer.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary, rgba(255,255,255,0.03))'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: '700', color: isLatest ? 'var(--accent)' : 'var(--text-muted)', minWidth: 28 }}>
                  #{globalIdx}
                </span>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {formatTime(layer.snapshotTime)}
                </span>
                {preview && (
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {preview}
                  </span>
                )}
                {isLatest && (
                  <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', fontWeight: '600', background: 'var(--accent)', color: '#fff' }}>最新</span>
                )}
                {isModified && (
                  <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', fontWeight: '600', background: '#f0883e', color: '#fff' }}>已修改</span>
                )}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {isLatest ? (
                    <ToolBtn onClick={(e) => { e.stopPropagation(); onLoadLatest(layer); }} title="加载编辑后的状态" disabled={!isModified}>
                      <Save size={12} />
                    </ToolBtn>
                  ) : (
                    <ToolBtn onClick={(e) => { e.stopPropagation(); onRollback(layer); }} title="回滚到此层">
                      <RotateCcw size={12} />
                    </ToolBtn>
                  )}
                </div>
              </div>

              {isExpanded && (
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                  <textarea
                    value={getEditText(layer)}
                    onChange={e => onEdit(layer.id, e.target.value)}
                    readOnly={!isLatest}
                    spellCheck={false}
                    style={{
                      width: '100%', minHeight: 200, maxHeight: 400, padding: '10px',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                      background: isLatest ? 'var(--bg-secondary)' : 'var(--bg-tertiary, rgba(255,255,255,0.02))',
                      color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)',
                      fontFamily: "var(--font-mono, 'Consolas', monospace)",
                      lineHeight: 1.6, resize: 'vertical', outline: 'none',
                    }}
                  />
                  {isLatest && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <button onClick={() => onLoadLatest(layer)} style={{
                        padding: '6px 16px', border: 'none', borderRadius: 'var(--radius-sm)',
                        background: 'var(--accent)', color: '#fff', fontSize: 'var(--font-size-sm)', fontWeight: '600', cursor: 'pointer',
                      }}>应用编辑</button>
                      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', lineHeight: '28px' }}>
                        编辑 JSON 后点击应用，将覆盖当前变量状态
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
