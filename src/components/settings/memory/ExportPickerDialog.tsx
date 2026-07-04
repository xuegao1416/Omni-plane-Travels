// ============================================================
// 导出记忆弹窗 — 使用共享组件重写
// ============================================================

import { useState, useCallback } from 'react';
import { FileText, Image } from 'lucide-react';
import { useDialog } from '../../shared/Dialog';
import type { NarrativeMemoryRuntime, VectorMemoryItem } from '../../../memory/types';
import { createMemoryDataPngBlob, getMemoryExportFileName } from '../../../memory/narrativePng';

interface Props {
  onClose: () => void;
  store: { toJSON: () => unknown };
  vectorMemory: VectorMemoryItem[];
  memoryRuntime: NarrativeMemoryRuntime | null;
}

export function ExportPickerDialog({ onClose, store, vectorMemory, memoryRuntime }: Props) {
  const { DialogUI, alert: dlgAlert } = useDialog();
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async (format: 'json' | 'png') => {
    setExporting(true);
    try {
      const payload = {
        format: 'yishijie-memory-runtime-pack',
        version: 1,
        meta: { title: '记忆运行态', exportedAt: Date.now() },
        runtime: {
          memoryRuntime: (memoryRuntime as unknown as Record<string, unknown>) ?? {},
          vectorMemory: vectorMemory as unknown[],
        },
      };

      if (format === 'png') {
        const blob = await createMemoryDataPngBlob(payload as Parameters<typeof createMemoryDataPngBlob>[0]);
        downloadBlob(blob, getMemoryExportFileName('memory_export', 'png'));
      } else {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        downloadBlob(blob, getMemoryExportFileName('memory_export', 'json'));
      }
      onClose();
    } catch (err) {
      dlgAlert(`导出失败：${err instanceof Error ? err.message : String(err)}`, { title: '导出失败' });
    } finally {
      setExporting(false);
    }
  }, [memoryRuntime, vectorMemory, onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1600,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={() => !exporting && onClose()}
    >
      {DialogUI}
      <div
        style={{
          width: '90%', maxWidth: 560, borderRadius: 'var(--radius-xl)',
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>导出记忆运行态</h3>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: '6px' }}>
            为当前存档选择导出格式。导出内容包含记忆运行态、向量事实、摘要历史与调试日志，但不包含剧情原文历史。
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '16px 20px' }}>
          <ExportOption
            icon={<FileText size={18} />}
            title="JSON 导出"
            desc="导出为可读 JSON，适合备份、版本管理与手工检查。"
            disabled={exporting}
            onClick={() => handleExport('json')}
          />
          <ExportOption
            icon={<Image size={18} />}
            title="PNG 导出"
            desc="生成可分享的数据型 PNG，并在图片内部嵌入完整记忆运行态。"
            disabled={exporting}
            onClick={() => handleExport('png')}
          />
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-secondary)' }}>
          <button
            disabled={exporting}
            onClick={onClose}
            style={{
              padding: '6px 16px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)', fontSize: 'var(--font-size-base)', cursor: 'pointer',
            }}
          >
            {exporting ? '导出中...' : '取消'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportOption({ icon, title, desc, disabled, onClick }: {
  icon: React.ReactNode; title: string; desc: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: '16px', borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'flex-start', gap: '12px',
        textAlign: 'left', color: 'var(--text-primary)',
        opacity: disabled ? 0.55 : 1,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-dim)'; } }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-secondary)'; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 'var(--radius-md)',
        background: 'var(--accent-dim)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--accent)', flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 'var(--font-size-md)', fontWeight: '600' }}>{title}</div>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: '4px' }}>{desc}</div>
      </div>
    </button>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
