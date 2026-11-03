import { useState,useEffect,useRef } from 'react';
import { ScrollText,X,Edit3,Trash2,Plus } from 'lucide-react';
import EmptyState from '../../../shared/EmptyState';
import type { ChronicleMergeOptions } from './chronicleActions';

export function DeedsModal({ npcId, chronicles: initialChronicles, onClose, onUpdate, onMerge }: {
  npcId: string; chronicles: string[];
  onClose: () => void; onUpdate: (npcId: string, chronicles: string[], expectedChronicles?: string[]) => boolean | void;
  onMerge?: (npcId: string, startIndex: number, endIndex: number, options?: ChronicleMergeOptions) => Promise<boolean>;
}) {
  const mergeRef = useRef<AbortController | null>(null);
  const editBaseline = useRef<string[]>(initialChronicles);
  const addBaseline = useRef<string[]>(initialChronicles);
  const [error, setError] = useState('');
  useEffect(() => () => { mergeRef.current?.abort(); }, [npcId]);
  const close = () => { mergeRef.current?.abort(); onClose(); };
  const [chronicles, setChronicles] = useState<string[]>(initialChronicles);

  useEffect(() => { setChronicles(initialChronicles); }, [initialChronicles]);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addText, setAddText] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeStart, setMergeStart] = useState<number | null>(null);
  const [mergeEnd, setMergeEnd] = useState<number | null>(null);

  const handleSave = (idx: number) => {
    const updated = [...editBaseline.current];
    updated[idx] = editText.trim();
    mergeRef.current?.abort(); mergeRef.current = null; setMerging(false);
    if (onUpdate(npcId, updated, editBaseline.current) === false) { setError('事迹已变化，编辑内容保留；请取消编辑并核对最新记录。'); return; }
    setError(''); setChronicles(updated);
    setEditingIndex(null);
  };

  const handleDelete = (idx: number) => {
    const updated = chronicles.filter((_, i) => i !== idx);
    mergeRef.current?.abort(); mergeRef.current = null; setMerging(false);
    if (onUpdate(npcId, updated, chronicles) === false) { setError('事迹已变化，请核对最新记录后再删除。'); return; }
    setError(''); setChronicles(updated);
  };

  const handleAdd = () => {
    if (!addText.trim()) return;
    const updated = [...addBaseline.current, addText.trim()];
    mergeRef.current?.abort(); mergeRef.current = null; setMerging(false);
    if (onUpdate(npcId, updated, addBaseline.current) === false) { setError('事迹已变化，新增内容保留；请核对最新记录。'); return; }
    setError(''); setChronicles(updated);
    setAddText(''); setAdding(false);
  };

  const handleMergeClick = (idx: number) => {
    if (mergeStart === null) { setMergeStart(idx); setMergeEnd(idx); }
    else if (mergeEnd !== null && idx > mergeStart) { setMergeEnd(idx); }
    else { setMergeStart(idx); setMergeEnd(idx); }
  };

  const handleMergeConfirm = async () => {
    if (mergeStart === null || mergeEnd === null || !onMerge) return;
    if (mergeRef.current) return;
    const controller = new AbortController(); mergeRef.current = controller;
    setMerging(true); setError('');
    try {
      const ok = await onMerge(npcId, mergeStart, mergeEnd, { signal: controller.signal, expectedChronicles: [...chronicles] });
      if (controller.signal.aborted) return;
      if (ok) { setMergeMode(false); setMergeStart(null); setMergeEnd(null); }
      else setError('合并没有应用，原记录保留。请核对当前人物事迹后重试。');
    } catch (failure) {
      if (!controller.signal.aborted) setError(`合并失败：${failure instanceof Error ? failure.message : String(failure)}`);
    } finally { if (mergeRef.current === controller) { mergeRef.current = null; if (!controller.signal.aborted) setMerging(false); } }
  };

  return (
    <div className="game-journey__nested-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1100, animation: 'fadeIn 0.15s ease',
    }} onClick={close}>
      <div className="game-journey__nested-panel" onClick={e => e.stopPropagation()} style={{
        borderRadius: 'var(--radius-lg)',
        width: '90%', maxWidth: '520px', maxHeight: '75vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontWeight: '600', fontSize: 'var(--font-size-lg)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ScrollText size={16} />人物事迹
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', fontWeight: '400' }}>
              {chronicles.length > 0 ? `共 ${chronicles.length} 条` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {chronicles.length >= 2 && onMerge && (
              mergeMode ? (
                <>
                  <button onClick={() => { setMergeStart(0); setMergeEnd(chronicles.length - 1); }} style={{
                    border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 'var(--font-size-sm)',
                    background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: '500',
                  }}>全选</button>
                  {mergeStart !== null && mergeEnd !== null && mergeEnd > mergeStart && (
                    <button onClick={handleMergeConfirm} disabled={merging} style={{
                      border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 'var(--font-size-sm)',
                      background: merging ? 'var(--bg-tertiary)' : 'var(--accent-dim)',
                      color: merging ? 'var(--text-muted)' : 'var(--accent)', cursor: merging ? 'wait' : 'pointer', fontWeight: '500',
                    }}>{merging ? '合并中...' : `合并 ${mergeStart + 1}-${mergeEnd + 1}`}</button>
                  )}
                  <button onClick={() => { mergeRef.current?.abort(); mergeRef.current = null; setMerging(false); setMergeMode(false); setMergeStart(null); setMergeEnd(null); }} style={{
                    border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 'var(--font-size-sm)',
                    background: 'var(--bg-tertiary)', color: 'var(--text-muted)', cursor: 'pointer',
                  }}>取消</button>
                </>
              ) : (
                <button onClick={() => setMergeMode(true)} style={{
                  border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 'var(--font-size-sm)',
                  background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer', fontWeight: '500',
                }}>合并事迹</button>
              )
            )}
            <button onClick={close} className="btn-ghost btn-icon-sm" style={{ background: 'var(--bg-tertiary)' }}><X size={14} /></button>
          </div>
        </div>

        {error && <p role="alert" style={{ padding: '0 20px', color: 'var(--danger)' }}>{error}</p>}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {chronicles.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {chronicles.map((c, i) => {
                const inMergeRange = mergeMode && mergeStart !== null && mergeEnd !== null && i >= mergeStart && i <= mergeEnd;
                const isMergeStart = mergeMode && mergeStart === i;
                const isMergeEnd = mergeMode && mergeEnd === i;
                return (
                <div key={i} onClick={() => mergeMode ? handleMergeClick(i) : undefined} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', borderBottom: '1px solid var(--border)',
                  background: inMergeRange ? 'var(--accent-dim)' : 'transparent',
                  cursor: mergeMode ? 'pointer' : 'default',
                  borderRadius: inMergeRange ? 'var(--radius-sm)' : undefined,
                  borderLeft: isMergeStart ? '3px solid var(--accent)' : isMergeEnd ? '3px solid var(--accent)' : '3px solid transparent',
                }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', flexShrink: 0, marginTop: '2px' }}>{i + 1}.</span>
                  {editingIndex === i ? (
                    <div style={{ flex: 1, display: 'flex', gap: '6px' }}>
                      <textarea value={editText} onChange={e => setEditText(e.target.value)} style={{
                        flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)',
                        resize: 'vertical', minHeight: '60px', fontFamily: 'inherit',
                      }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <button onClick={() => handleSave(i)} style={{ border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }}>保存</button>
                        <button onClick={() => setEditingIndex(null)} style={{ border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--bg-tertiary)', color: 'var(--text-muted)', cursor: 'pointer' }}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: 'var(--font-size-sm)', lineHeight: '1.5' }}>{c}</span>
                      <button onClick={() => { editBaseline.current = [...chronicles]; setEditingIndex(i); setEditText(c); setError(''); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }} title="编辑"><Edit3 size={13} /></button>
                      <button onClick={() => handleDelete(i)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }} title="删除"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={ScrollText} message="暂无事迹记录" />
          )}
        </div>

        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          {adding ? (
            <div style={{ display: 'flex', gap: '6px' }}>
              <textarea value={addText} onChange={e => setAddText(e.target.value)} placeholder="输入新事迹..." style={{
                flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)',
                resize: 'vertical', minHeight: '50px', fontFamily: 'inherit',
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button onClick={handleAdd} style={{ border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--accent-dim)', color: 'var(--accent)', cursor: 'pointer' }}>添加</button>
                <button onClick={() => { setAdding(false); setAddText(''); }} style={{ border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 10px', fontSize: 'var(--font-size-sm)', background: 'var(--bg-tertiary)', color: 'var(--text-muted)', cursor: 'pointer' }}>取消</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { addBaseline.current = [...chronicles]; setAdding(true); setError(''); }} style={{
              width: '100%', padding: '8px', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)',
              background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
            }}><Plus size={14} /> 添加事迹</button>
          )}
        </div>
      </div>
    </div>
  );
}
