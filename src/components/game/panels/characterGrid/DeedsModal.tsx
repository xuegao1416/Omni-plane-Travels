import { useState, useEffect } from 'react';
import { ScrollText, X, Edit3, Trash2, Plus } from 'lucide-react';
import EmptyState from '../../../shared/EmptyState';

export function DeedsModal({ npcId, npcName, chronicles: initialChronicles, onClose, onUpdate, onMerge }: {
  npcId: string; npcName: string; chronicles: string[];
  onClose: () => void; onUpdate: (npcId: string, chronicles: string[]) => void;
  onMerge?: (npcId: string, startIndex: number, endIndex: number) => Promise<boolean>;
}) {
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
    const updated = [...chronicles];
    updated[idx] = editText.trim();
    setChronicles(updated);
    onUpdate(npcId, updated);
    setEditingIndex(null);
  };

  const handleDelete = (idx: number) => {
    const updated = chronicles.filter((_, i) => i !== idx);
    setChronicles(updated);
    onUpdate(npcId, updated);
  };

  const handleAdd = () => {
    if (!addText.trim()) return;
    const updated = [...chronicles, addText.trim()];
    setChronicles(updated);
    onUpdate(npcId, updated);
    setAddText(''); setAdding(false);
  };

  const handleMergeClick = (idx: number) => {
    if (mergeStart === null) { setMergeStart(idx); setMergeEnd(idx); }
    else if (mergeEnd !== null && idx > mergeStart) { setMergeEnd(idx); }
    else { setMergeStart(idx); setMergeEnd(idx); }
  };

  const handleMergeConfirm = async () => {
    if (mergeStart === null || mergeEnd === null || !onMerge) return;
    setMerging(true);
    try {
      const ok = await onMerge(npcId, mergeStart, mergeEnd);
      if (ok) { setMergeMode(false); setMergeStart(null); setMergeEnd(null); }
    } finally { setMerging(false); }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1100, animation: 'fadeIn 0.15s ease',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        width: '90%', maxWidth: '520px', maxHeight: '75vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)',
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
                  <button onClick={() => { setMergeMode(false); setMergeStart(null); setMergeEnd(null); }} style={{
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
            <button onClick={onClose} className="btn-ghost btn-icon-sm" style={{ background: 'var(--bg-tertiary)' }}><X size={14} /></button>
          </div>
        </div>

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
                      <button onClick={() => { setEditingIndex(i); setEditText(c); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px', flexShrink: 0 }} title="编辑"><Edit3 size={13} /></button>
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
            <button onClick={() => setAdding(true)} style={{
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
