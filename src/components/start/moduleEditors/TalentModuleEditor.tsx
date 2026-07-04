import { useState } from 'react';
import { Sparkles, Plus, Loader } from 'lucide-react';
import type { TalentModuleSchema } from '../../../modules/schema';
import { inputStyle, labelStyle } from './shared';

/** 天赋体系编辑器 — 弹窗式 */
export function TalentModuleEditor({ data, onChange, onAiGenerate, isGenerating }: {
  data: TalentModuleSchema;
  onChange: (d: Record<string, unknown>) => void;
  onAiGenerate?: (categoryIndex: number, count: number) => void;
  isGenerating?: boolean;
}) {
  const RARITY_OPTIONS = ['普通', '精良', '稀有', '史诗', '传说'] as const;
  const [editingCat, setEditingCat] = useState<number | null>(null);
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [genCount, setGenCount] = useState(5);

  const commit = (next: TalentModuleSchema) => onChange(next as any);

  const addCategory = () => {
    if (!newCatName.trim()) return;
    const next = JSON.parse(JSON.stringify(data));
    next.categories.push({ id: `cat_${Date.now()}`, name: newCatName.trim(), description: newCatDesc.trim(), talents: [] });
    commit(next);
    setNewCatName(''); setNewCatDesc(''); setAddCatOpen(false);
  };

  const removeCategory = (ci: number) => {
    const next = JSON.parse(JSON.stringify(data));
    next.categories.splice(ci, 1);
    commit(next);
  };

  const addTalent = () => {
    if (editingCat === null) return;
    const next = JSON.parse(JSON.stringify(data));
    next.categories[editingCat].talents.push({ id: `tal_${Date.now()}`, name: '新天赋', description: '', rarity: '普通', effects: [] });
    commit(next);
  };

  const removeTalent = (ti: number) => {
    if (editingCat === null) return;
    const next = JSON.parse(JSON.stringify(data));
    next.categories[editingCat].talents.splice(ti, 1);
    commit(next);
  };

  const setTalentField = (ti: number, field: string, value: unknown) => {
    if (editingCat === null) return;
    const next = JSON.parse(JSON.stringify(data));
    next.categories[editingCat].talents[ti][field] = value;
    commit(next);
  };

  const setCatField = (field: string, value: unknown) => {
    if (editingCat === null) return;
    const next = JSON.parse(JSON.stringify(data));
    next.categories[editingCat][field] = value;
    commit(next);
  };

  const editing = editingCat !== null ? data.categories[editingCat] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* 大类列表 */}
      {data.categories.map((cat, ci) => (
        <div key={cat.id} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{cat.name}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              {cat.description || '无描述'} · {cat.talents.length} 个天赋
            </div>
          </div>
          <button className="btn-ghost" onClick={() => setEditingCat(ci)} style={{ fontSize: 'var(--font-size-xs)', padding: '3px 10px' }}>编辑</button>
          <button onClick={() => removeCategory(ci)} style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '4px' }}>✕</button>
        </div>
      ))}

      {/* 添加大类按钮 */}
      <button className="btn-ghost" onClick={() => setAddCatOpen(true)} style={{ fontSize: 'var(--font-size-xs)', padding: '4px 8px', alignSelf: 'flex-start' }}>
        + 添加天赋大类
      </button>

      {/* ── 添加大类弹窗 ── */}
      {addCatOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setAddCatOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, maxWidth: 360, width: '90%' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 'var(--font-size-lg)' }}>添加天赋大类</h3>
            <div className="form-group">
              <label>大类名称</label>
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="如：灵根、体质、血脉..." autoFocus />
            </div>
            <div className="form-group">
              <label>描述</label>
              <input value={newCatDesc} onChange={e => setNewCatDesc(e.target.value)} placeholder="可选" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setAddCatOpen(false)}>取消</button>
              <button className="btn-primary" onClick={addCategory} disabled={!newCatName.trim()}>添加</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 编辑大类弹窗 ── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setEditingCat(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, maxWidth: 500, width: '92%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>{editing.name}</h3>
              <button onClick={() => setEditingCat(null)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)', padding: '0 4px' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 8 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 'var(--font-size-xs)', marginBottom: 2, display: 'block' }}>大类名称</label>
                <input value={editing.name} onChange={e => setCatField('name', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 'var(--font-size-xs)', marginBottom: 2, display: 'block' }}>描述</label>
                <input value={editing.description} onChange={e => setCatField('description', e.target.value)} placeholder="可选" />
              </div>
            </div>

            {/* 天赋列表 */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  天赋列表
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>{editing.talents.length}</span>
                </span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {onAiGenerate && (
                    <>
                      <input
                        type="number" min={1} max={20}
                        style={{ ...inputStyle, width: 38, textAlign: 'center', padding: '3px 4px', fontSize: 'var(--font-size-xs)' }}
                        value={genCount}
                        onChange={e => setGenCount(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
                      />
                      <button
                        className="btn-ghost"
                        onClick={() => onAiGenerate(editingCat!, genCount)}
                        disabled={isGenerating}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--font-size-xs)', padding: '3px 10px' }}
                      >
                        <Sparkles size={12} />
                        {isGenerating ? '生成中' : 'AI 生成'}
                      </button>
                    </>
                  )}
                  <button
                    className="btn-ghost"
                    onClick={addTalent}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--font-size-xs)', padding: '3px 10px' }}
                  >
                    <Plus size={12} /> 添加
                  </button>
                </div>
              </div>

              {editing.talents.length === 0 && (
                <div style={{
                  fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
                  padding: '16px 0', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 6,
                }}>
                  暂无天赋
                </div>
              )}

              {editing.talents.map((tal, ti) => (
                <div key={tal.id} style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: '6px 8px', marginBottom: 4,
                  border: '1px solid var(--border)', borderRadius: 4,
                }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input style={{ ...inputStyle, flex: 1 }} value={tal.name} onChange={e => setTalentField(ti, 'name', e.target.value)} placeholder="天赋名" />
                    <select style={{ ...inputStyle, width: 60 }} value={tal.rarity} onChange={e => setTalentField(ti, 'rarity', e.target.value)}>
                      {RARITY_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button onClick={() => removeTalent(ti)} style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}>✕</button>
                  </div>
                  <input style={{ ...inputStyle }} value={tal.description} onChange={e => setTalentField(ti, 'description', e.target.value)} placeholder="描述..." />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn-primary" onClick={() => setEditingCat(null)} style={{ padding: '6px 20px' }}>完成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
