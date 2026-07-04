// ============================================================
// 向量提取弹窗 — 使用共享组件重写
// ============================================================

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '../SettingsUIComponents';

interface Props {
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', fontSize: 'var(--font-size-base)', outline: 'none',
  width: '100%', transition: 'border-color 0.15s, box-shadow 0.15s',
};

export function VectorExtractDialog({ onClose }: Props) {
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(10);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleExtract = async () => {
    setExtracting(true);
    setResult(null);
    try {
      setResult({ success: true, message: `将从第 ${start} 层提取到第 ${end} 层。（功能待接入 memorySystem hook）` });
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1600,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={() => !extracting && onClose()}
    >
      <div
        style={{
          width: '90%', maxWidth: 500, borderRadius: 'var(--radius-xl)',
          background: 'var(--bg-primary)', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ paddingBottom: '14px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>手动提取向量事实</h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginTop: '6px' }}>
              选择一个层数区间进行强制提取。如果在该区间内已有旧的提取记录，它们将被替换。
            </p>
          </div>

          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: '600' }}>起始层数 (从 1 开始)</span>
              <input type="number" min={1} value={start} onChange={e => setStart(Number(e.target.value))} style={inputStyle} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', fontWeight: '600' }}>结束层数 (按可提取层数计)</span>
              <input type="number" min={1} value={end} onChange={e => setEnd(Number(e.target.value))} style={inputStyle} />
            </div>
          </div>

          {result && (
            <div style={{
              padding: '10px 14px', borderRadius: 'var(--radius-md)',
              border: `1px solid ${result.success ? 'var(--success)' : 'var(--danger)'}`,
              background: `color-mix(in srgb, ${result.success ? 'var(--success)' : 'var(--danger)'} 10%, transparent)`,
              fontSize: 'var(--font-size-sm)', color: result.success ? 'var(--success)' : 'var(--danger)',
            }}>
              {result.message}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
            <Button disabled={extracting} onClick={onClose}>取消</Button>
            <Button primary disabled={extracting} onClick={handleExtract} icon={<Sparkles size={14} />}>
              {extracting ? '提取中...' : '开始提取'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
