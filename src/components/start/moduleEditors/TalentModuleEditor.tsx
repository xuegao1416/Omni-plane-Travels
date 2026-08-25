import { useState } from 'react';
import { Sparkles, Plus, Trash2 } from 'lucide-react';
import type { TalentModuleSchema } from '../../../modules/schema';
import { inputStyle, labelStyle } from './shared';
import { ConditionListEditor, CostListEditor, EffectListEditor } from './GameplayRuleEditors';

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

  const setPointRule = (field: keyof NonNullable<TalentModuleSchema['pointRules']>, value: number) => {
    commit({
      ...data,
      pointRules: { ...data.pointRules, [field]: Math.max(0, Math.trunc(value || 0)) },
    });
  };

  const addSkill = () => {
    commit({
      ...data,
      skills: [...(data.skills ?? []), {
        id: `skill_${Date.now()}`, name: '新技能', description: '', rarity: '普通',
        maxRank: 1, pointCost: 1, cooldownTicks: 0, tags: [],
      }],
    });
  };

  const setSkillField = (index: number, field: string, value: unknown) => {
    const skills = (data.skills ?? []).map((skill, skillIndex) => skillIndex === index ? { ...skill, [field]: value } : skill);
    commit({ ...data, skills });
  };

  const removeSkill = (index: number) => {
    commit({ ...data, skills: (data.skills ?? []).filter((_, skillIndex) => skillIndex !== index) });
  };

  const setSkillPath = (index: number, path: string, value: unknown) => {
    const next = JSON.parse(JSON.stringify(data)) as TalentModuleSchema;
    let target: any = next.skills![index];
    const parts = path.split('.');
    parts.slice(0, -1).forEach(part => { target[part] ??= {}; target = target[part]; });
    target[parts.at(-1)!] = value;
    commit(next);
  };

  const addEquipmentSlot = () => commit({ ...data, equipmentSlots: [...(data.equipmentSlots ?? []), { id: `slot_${Date.now()}`, name: '新装备槽', capacity: 1, description: '' }] });
  const removeEquipmentSlot = (index: number) => commit({ ...data, equipmentSlots: (data.equipmentSlots ?? []).filter((_, i) => i !== index) });

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
        {([
          ['initialTalentPoints', '初始天赋点'], ['initialSkillPoints', '初始技能点'],
          ['talentPointsPerTier', '每阶天赋点'], ['skillPointsPerTier', '每阶技能点'],
        ] as const).map(([field, label]) => (
          <label key={field} style={{ ...labelStyle, margin: 0 }}>
            <span>{label}</span>
            <input
              type="number" min={0} max={99}
              style={{ ...inputStyle, width: '100%', marginTop: 3 }}
              value={data.pointRules?.[field] ?? (field.startsWith('initial') ? 1 : 1)}
              onChange={event => setPointRule(field, Number(event.target.value))}
            />
          </label>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong style={{ fontSize: 'var(--font-size-sm)' }}>装备槽与洗点</strong><button className="btn-ghost" onClick={addEquipmentSlot} style={{ padding: '2px 8px' }}><Plus size={12} /> 添加槽位</button></div>
        {(data.equipmentSlots ?? []).map((slot, index) => <div key={slot.id} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 60px 1fr auto', gap: 4, marginTop: 4 }}>
          <input style={inputStyle} value={slot.id} onChange={e => { const next = JSON.parse(JSON.stringify(data)); next.equipmentSlots[index].id = e.target.value; commit(next); }} placeholder="槽位 ID" />
          <input style={inputStyle} value={slot.name} onChange={e => { const next = JSON.parse(JSON.stringify(data)); next.equipmentSlots[index].name = e.target.value; commit(next); }} placeholder="槽位名称" />
          <input style={inputStyle} type="number" min={1} value={slot.capacity ?? 1} onChange={e => { const next = JSON.parse(JSON.stringify(data)); next.equipmentSlots[index].capacity = Math.max(1, Number(e.target.value) || 1); commit(next); }} placeholder="容量" />
          <input style={inputStyle} value={slot.description ?? ''} onChange={e => { const next = JSON.parse(JSON.stringify(data)); next.equipmentSlots[index].description = e.target.value; commit(next); }} placeholder="说明" />
          <button className="btn-ghost" onClick={() => removeEquipmentSlot(index)} style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
        </div>)}
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6 }}><input type="checkbox" checked={data.respec?.enabled !== false} onChange={e => commit({ ...data, respec: { ...(data.respec ?? {}), enabled: e.target.checked } })} />允许洗点</label>
        <CostListEditor value={data.respec?.cost} onChange={cost => commit({ ...data, respec: { ...(data.respec ?? {}), cost } })} />
      </div>

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
          <button onClick={() => removeCategory(ci)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '4px' }}>✕</button>
        </div>
      ))}

      {/* 添加大类按钮 */}
      <button className="btn-ghost" onClick={() => setAddCatOpen(true)} style={{ fontSize: 'var(--font-size-xs)', padding: '4px 8px', alignSelf: 'flex-start' }}>
        <Plus size={12} aria-hidden="true" /> 添加天赋大类
      </button>

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>技能 <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{data.skills?.length ?? 0}</span></span>
          <button className="btn-ghost" onClick={addSkill} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', padding: '3px 8px' }}>
            <Plus size={12} aria-hidden="true" /> 添加技能
          </button>
        </div>
        {(data.skills ?? []).map((skill, index) => (
          <div key={skill.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) 68px 54px 54px 54px 28px', gap: 4, marginBottom: 5, alignItems: 'center' }}>
            <input style={inputStyle} value={skill.name} onChange={event => setSkillField(index, 'name', event.target.value)} placeholder="技能名" />
            <select style={inputStyle} value={skill.rarity} onChange={event => setSkillField(index, 'rarity', event.target.value)}>
              {RARITY_OPTIONS.map(rarity => <option key={rarity}>{rarity}</option>)}
            </select>
            <input type="number" min={0} title="技能点消耗" style={{ ...inputStyle, width: '100%' }} value={skill.pointCost ?? 1} onChange={event => setSkillField(index, 'pointCost', Number(event.target.value))} />
            <input type="number" min={0} title="冷却轮次" style={{ ...inputStyle, width: '100%' }} value={skill.cooldownTicks ?? 0} onChange={event => setSkillField(index, 'cooldownTicks', Number(event.target.value))} />
            <input type="number" min={1} title="技能最大等级" style={{ ...inputStyle, width: '100%' }} value={skill.maxRank ?? 1} onChange={event => setSkillField(index, 'maxRank', Math.max(1, Number(event.target.value) || 1))} />
            <button className="btn-ghost" onClick={() => removeSkill(index)} title="删除技能" aria-label={`删除技能 ${skill.name}`} style={{ padding: 4, color: 'var(--danger)' }}>
              <Trash2 size={13} aria-hidden="true" />
            </button>
            <input style={{ ...inputStyle, gridColumn: '1 / -1' }} value={skill.description} onChange={event => setSkillField(index, 'description', event.target.value)} placeholder="技能描述" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, gridColumn: '1 / -1' }}>
              <input style={inputStyle} value={(skill.tags ?? []).join(',')} onChange={e => setSkillField(index, 'tags', e.target.value.split(',').map(v => v.trim()).filter(Boolean))} placeholder="标签（逗号分隔）" />
              <input style={inputStyle} value={(skill.prerequisites ?? []).join(',')} onChange={e => setSkillField(index, 'prerequisites', e.target.value.split(',').map(v => v.trim()).filter(Boolean))} placeholder="前置能力 ID" />
              <input style={inputStyle} value={skill.exclusiveGroup ?? ''} onChange={e => setSkillField(index, 'exclusiveGroup', e.target.value || undefined)} placeholder="互斥分支组" />
              <input style={inputStyle} value={skill.branch ?? ''} onChange={e => setSkillField(index, 'branch', e.target.value || undefined)} placeholder="分支标识" />
              <input style={inputStyle} value={skill.categoryId ?? ''} onChange={e => setSkillField(index, 'categoryId', e.target.value || undefined)} placeholder="所属大类 ID" />
              <input style={inputStyle} value={skill.equipmentSlot ?? ''} onChange={e => setSkillField(index, 'equipmentSlot', e.target.value || undefined)} placeholder="装备槽 ID" />
              <input style={inputStyle} type="number" value={skill.diceModifier ?? 0} onChange={e => setSkillField(index, 'diceModifier', Number(e.target.value) || 0)} placeholder="骰子修正" />
              <input style={inputStyle} value={(skill.rankCosts ?? []).join(',')} onChange={e => setSkillField(index, 'rankCosts', e.target.value.split(',').map(v => Number(v.trim())).filter(Number.isFinite))} placeholder="各级消耗" />
              <input style={inputStyle} type="number" value={skill.graph?.x ?? ''} onChange={e => setSkillPath(index, 'graph.x', Number(e.target.value) || 0)} placeholder="树 X%" />
              <input style={inputStyle} type="number" value={skill.graph?.y ?? ''} onChange={e => setSkillPath(index, 'graph.y', Number(e.target.value) || 0)} placeholder="树 Y%" />
              <input style={inputStyle} type="number" value={skill.graph?.column ?? ''} onChange={e => setSkillPath(index, 'graph.column', e.target.value === '' ? undefined : Number(e.target.value))} placeholder="树列" />
              <input style={inputStyle} type="number" value={skill.graph?.row ?? ''} onChange={e => setSkillPath(index, 'graph.row', e.target.value === '' ? undefined : Number(e.target.value))} placeholder="树行" />
              <input style={inputStyle} type="number" min={0} value={skill.proficiency?.gainPerUse ?? 0} onChange={e => setSkillPath(index, 'proficiency.gainPerUse', Number(e.target.value) || 0)} placeholder="熟练度/次" />
              <input style={inputStyle} type="number" min={1} value={skill.proficiency?.thresholdPerRank ?? 10} onChange={e => setSkillPath(index, 'proficiency.thresholdPerRank', Number(e.target.value) || 1)} placeholder="熟练度阈值" />
              <input style={inputStyle} type="number" min={1} value={skill.proficiency?.maxRank ?? skill.maxRank ?? 1} onChange={e => setSkillPath(index, 'proficiency.maxRank', Number(e.target.value) || 1)} placeholder="熟练度上限" />
            </div>
            <span style={{ color: 'var(--text-muted)' }}>解锁条件</span><ConditionListEditor value={skill.unlockConditions} onChange={value => setSkillField(index, 'unlockConditions', value)} />
            <span style={{ color: 'var(--text-muted)' }}>激活消耗</span><CostListEditor value={skill.activation?.costs} onChange={value => setSkillPath(index, 'activation.costs', value)} />
            <span style={{ color: 'var(--text-muted)' }}>激活效果</span><EffectListEditor value={skill.activation?.effects} onChange={value => setSkillPath(index, 'activation.effects', value)} />
            <span style={{ color: 'var(--text-muted)' }}>激活奖励</span><EffectListEditor value={skill.activation?.rewards?.flatMap(reward => reward.effects) ?? []} onChange={value => setSkillPath(index, 'activation.rewards', value.length ? [{ effects: value }] : [])} />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'var(--text-muted)' }}><input type="checkbox" checked={Boolean(skill.awakening)} onChange={e => setSkillField(index, 'awakening', e.target.checked ? { name: '新觉醒', description: '', conditions: [], pointCost: 1, effects: [] } : undefined)} />启用技能觉醒</label>
            {skill.awakening && <div style={{ gridColumn: '1 / -1', borderLeft: '2px solid var(--border)', paddingLeft: 6 }}><div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 70px', gap: 4 }}><input style={inputStyle} value={skill.awakening.id ?? ''} onChange={e => setSkillField(index, 'awakening', { ...skill.awakening, id: e.target.value || undefined })} placeholder="觉醒 ID" /><input style={inputStyle} value={skill.awakening.name} onChange={e => setSkillField(index, 'awakening', { ...skill.awakening, name: e.target.value })} placeholder="觉醒名称" /><input style={inputStyle} value={skill.awakening.description} onChange={e => setSkillField(index, 'awakening', { ...skill.awakening, description: e.target.value })} placeholder="觉醒描述" /><input style={inputStyle} type="number" value={skill.awakening.pointCost ?? 0} onChange={e => setSkillField(index, 'awakening', { ...skill.awakening, pointCost: Number(e.target.value) || 0 })} placeholder="点数" /></div><ConditionListEditor value={skill.awakening.conditions} onChange={conditions => setSkillField(index, 'awakening', { ...skill.awakening, conditions })} /><EffectListEditor value={skill.awakening.effects} onChange={effects => setSkillField(index, 'awakening', { ...skill.awakening, effects })} /></div>}
          </div>
        ))}
      </div>

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
                    <button onClick={() => removeTalent(ti)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}>✕</button>
                  </div>
                  <input style={{ ...inputStyle }} value={tal.description} onChange={e => setTalentField(ti, 'description', e.target.value)} placeholder="描述..." />
                  <input style={{ ...inputStyle }} value={(tal.effects ?? []).join('、')} onChange={e => setTalentField(ti, 'effects', e.target.value.split('、').map(v => v.trim()).filter(Boolean))} placeholder="效果说明（用、分隔）" />
                  <div style={{ display: 'grid', gridTemplateColumns: '58px 58px 1fr 1fr', gap: 4 }}>
                    <input type="number" min={1} max={99} style={inputStyle} value={tal.maxRank ?? 1} onChange={e => setTalentField(ti, 'maxRank', Math.max(1, Number(e.target.value) || 1))} title="最大等级" placeholder="最大级" />
                    <input type="number" min={0} style={inputStyle} value={tal.pointCost ?? 1} onChange={e => setTalentField(ti, 'pointCost', Math.max(0, Number(e.target.value) || 0))} title="点数消耗" placeholder="消耗" />
                    <input style={inputStyle} value={(tal.prerequisites ?? []).join(',')} onChange={e => setTalentField(ti, 'prerequisites', e.target.value.split(',').map(v => v.trim()).filter(Boolean))} placeholder="前置节点 ID（逗号分隔）" />
                    <input style={inputStyle} value={tal.exclusiveGroup ?? ''} onChange={e => setTalentField(ti, 'exclusiveGroup', e.target.value || undefined)} placeholder="互斥分支组" />
                    <input style={inputStyle} value={tal.branch ?? ''} onChange={e => setTalentField(ti, 'branch', e.target.value || undefined)} placeholder="分支标识" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                    <input type="number" min={0} max={100} style={inputStyle} value={tal.graph?.x ?? ''} onChange={e => setTalentField(ti, 'graph', { ...(tal.graph ?? { y: 10 }), x: Number(e.target.value) })} placeholder="树 X%" />
                    <input type="number" min={0} max={100} style={inputStyle} value={tal.graph?.y ?? ''} onChange={e => setTalentField(ti, 'graph', { ...(tal.graph ?? { x: 10 }), y: Number(e.target.value) })} placeholder="树 Y%" />
                    <input style={inputStyle} value={tal.equipmentSlot ?? ''} onChange={e => setTalentField(ti, 'equipmentSlot', e.target.value || undefined)} placeholder="装备槽 ID" />
                    <input style={inputStyle} value={(tal.rankCosts ?? []).join(',')} onChange={e => setTalentField(ti, 'rankCosts', e.target.value.split(',').map(v => Number(v.trim())).filter(Number.isFinite))} placeholder="各级消耗" />
                    <input style={inputStyle} type="number" value={tal.diceModifier ?? 0} onChange={e => setTalentField(ti, 'diceModifier', Number(e.target.value) || 0)} placeholder="骰子修正" />
                    <input style={inputStyle} type="number" value={tal.graph?.column ?? ''} onChange={e => setTalentField(ti, 'graph', { ...(tal.graph ?? { x: 10, y: 10 }), column: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="树列" />
                    <input style={inputStyle} type="number" value={tal.graph?.row ?? ''} onChange={e => setTalentField(ti, 'graph', { ...(tal.graph ?? { x: 10, y: 10 }), row: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="树行" />
                  </div>
                  <span style={{ color: 'var(--text-muted)' }}>解锁条件</span>
                  <ConditionListEditor value={tal.unlockConditions} onChange={value => setTalentField(ti, 'unlockConditions', value)} />
                  <span style={{ color: 'var(--text-muted)' }}>机械效果</span>
                  <EffectListEditor value={tal.mechanics?.passive} onChange={effects => setTalentField(ti, 'mechanics', { ...(tal.mechanics ?? {}), passive: effects })} />
                  <EffectListEditor value={tal.mechanics?.onUnlock} onChange={effects => setTalentField(ti, 'mechanics', { ...(tal.mechanics ?? {}), onUnlock: effects })} />
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center', color: 'var(--text-muted)' }}><input type="checkbox" checked={Boolean(tal.awakening)} onChange={e => setTalentField(ti, 'awakening', e.target.checked ? { name: '新觉醒', description: '', conditions: [], pointCost: 1, effects: [] } : undefined)} />启用觉醒</label>
                  {tal.awakening && <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr 70px', gap: 4 }}><input style={inputStyle} value={tal.awakening.id ?? ''} onChange={e => setTalentField(ti, 'awakening', { ...tal.awakening, id: e.target.value || undefined })} placeholder="觉醒 ID" /><input style={inputStyle} value={tal.awakening.name} onChange={e => setTalentField(ti, 'awakening', { ...tal.awakening, name: e.target.value })} placeholder="觉醒名称" /><input style={inputStyle} value={tal.awakening.description} onChange={e => setTalentField(ti, 'awakening', { ...tal.awakening, description: e.target.value })} placeholder="觉醒描述" /><input style={inputStyle} type="number" value={tal.awakening.pointCost ?? 0} onChange={e => setTalentField(ti, 'awakening', { ...tal.awakening, pointCost: Number(e.target.value) || 0 })} placeholder="点数" /></div>
                    <ConditionListEditor value={tal.awakening.conditions} onChange={conditions => setTalentField(ti, 'awakening', { ...tal.awakening, conditions })} />
                    <EffectListEditor value={tal.awakening.effects} onChange={effects => setTalentField(ti, 'awakening', { ...tal.awakening, effects })} />
                  </div>}
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
