import type { StatModuleSchema } from '../../../modules/schema';
import { getSixDimSemantic } from '../../../modules/xpAlgorithm';
import { inputStyle, labelStyle, setPathInClone } from './shared';

/** 数值属性编辑器 */
export function StatModuleEditor({ data, onChange }: { data: StatModuleSchema; onChange: (d: StatModuleSchema) => void }) {
  const specials = data.special || [];
  const set = (path: string, value: unknown) => {
    onChange(setPathInClone(data as unknown as Record<string, unknown>, path, value) as unknown as StatModuleSchema);
  };

  const addSpecial = () => {
    if (specials.length >= 4) return;
    const next = JSON.parse(JSON.stringify(data));
    next.special = next.special || [];
    next.special.push({ id: `special_${Date.now()}`, name: '新特色属性', value: 50, range: [0, 100], description: '' });
    onChange(next);
  };

  const removeSpecial = (i: number) => {
    const next = JSON.parse(JSON.stringify(data));
    next.special = next.special || [];
    next.special.splice(i, 1);
    onChange(next);
  };

  const addDerived = () => onChange({ ...JSON.parse(JSON.stringify(data)), derived: [...(data.derived || []), { id: `derived_${Date.now()}`, name: '新派生属性', inputs: ['attrA'], formula: 'sum', scale: 1, offset: 0 }] });
  const removeDerived = (i: number) => onChange({ ...JSON.parse(JSON.stringify(data)), derived: (data.derived || []).filter((_, index) => index !== i) });
  const addModifier = () => onChange({ ...JSON.parse(JSON.stringify(data)), modifiers: [...(data.modifiers || []), { id: `modifier_${Date.now()}`, statId: 'attrA', delta: 1, mode: 'flat', source: '', permanent: true }] });
  const removeModifier = (i: number) => onChange({ ...JSON.parse(JSON.stringify(data)), modifiers: (data.modifiers || []).filter((_, index) => index !== i) });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div><label style={labelStyle}>生命类名称</label><input style={inputStyle} value={data.attrA.name} onChange={e => set('attrA.name', e.target.value)} /><div style={{ display: 'flex', gap: 4, marginTop: 3 }}><input style={inputStyle} type="number" value={data.attrA.current} onChange={e => set('attrA.current', Number(e.target.value) || 0)} placeholder="当前" /><input style={inputStyle} type="number" value={data.attrA.max} onChange={e => set('attrA.max', Number(e.target.value) || 0)} placeholder="上限" /></div></div>
        <div><label style={labelStyle}>能量类名称</label><input style={inputStyle} value={data.attrB.name} onChange={e => set('attrB.name', e.target.value)} /><div style={{ display: 'flex', gap: 4, marginTop: 3 }}><input style={inputStyle} type="number" value={data.attrB.current} onChange={e => set('attrB.current', Number(e.target.value) || 0)} placeholder="当前" /><input style={inputStyle} type="number" value={data.attrB.max} onChange={e => set('attrB.max', Number(e.target.value) || 0)} placeholder="上限" /></div></div>
      </div>
      {/* 六维属性（选了数值模块就是固定六维，只能改名） */}
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>六维属性</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {(['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const).map(key => {
          const dim = data[key];
          return (
            <div key={key}>
              <label style={labelStyle}>{key} · {getSixDimSemantic(key, dim).label}</label>
              <input style={inputStyle} value={dim?.name ?? ''} onChange={e => set(`${key}.name`, e.target.value)} placeholder="属性名" />
              {dim && <input style={{ ...inputStyle, marginTop: 3 }} value={dim.description ?? ''} onChange={e => set(`${key}.description`, e.target.value)} placeholder="这一属性具体影响什么" />}
              {dim && <div style={{ display: 'flex', gap: 3, marginTop: 3 }}><input style={inputStyle} type="number" value={dim.value} onChange={e => set(`${key}.value`, Number(e.target.value) || 0)} placeholder="当前" /><input style={inputStyle} type="number" value={dim.range[0]} onChange={e => set(`${key}.range`, [Number(e.target.value) || 0, dim.range[1]])} placeholder="最小" /><input style={inputStyle} type="number" value={dim.range[1]} onChange={e => set(`${key}.range`, [dim.range[0], Number(e.target.value) || 0])} placeholder="最大" /></div>}
            </div>
          );
        })}
      </div>
      {/* 特色属性（0~4个） */}
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>
        特色属性（0~4个，数值型）
        {specials.length >= 4 && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>已达上限</span>}
      </div>
      {specials.map((sp, i) => (
        <div key={sp.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input style={{ ...inputStyle, width: 80 }} value={sp.name} onChange={e => set(`special.${i}.name`, e.target.value)} placeholder="属性名" />
          <input style={{ ...inputStyle, width: 50 }} type="number" value={sp.value ?? 0} onChange={e => set(`special.${i}.value`, Number(e.target.value) || 0)} placeholder="当前" title="当前值" />
          <input style={{ ...inputStyle, width: 50 }} type="number" value={sp.range[0]} onChange={e => set(`special.${i}.range`, [Number(e.target.value) || 0, sp.range[1]])} placeholder="最小" title="最小值" />
          <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>~</span>
          <input style={{ ...inputStyle, width: 50 }} type="number" value={sp.range[1]} onChange={e => set(`special.${i}.range`, [sp.range[0], Number(e.target.value) || 0])} placeholder="最大" title="最大值" />
          <input style={{ ...inputStyle, flex: 1 }} value={sp.description} onChange={e => set(`special.${i}.description`, e.target.value)} placeholder="属性描述（如：领悟武学本质的境界）" />
          <button onClick={() => removeSpecial(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}>✕</button>
        </div>
      ))}
      {specials.length < 4 && (
        <button className="btn-ghost" onClick={addSpecial} style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}>+ 添加特色属性</button>
      )}
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>派生属性</div>
      {(data.derived || []).map((item, i) => <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 5, padding: 5, display: 'grid', gridTemplateColumns: '90px 1fr 82px 1fr auto', gap: 4, alignItems: 'center' }}>
        <input style={inputStyle} value={item.id} placeholder="ID" onChange={e => set(`derived.${i}.id`, e.target.value)} />
        <input style={inputStyle} value={item.name} placeholder="名称" onChange={e => set(`derived.${i}.name`, e.target.value)} />
        <select style={inputStyle} value={item.formula || 'sum'} onChange={e => set(`derived.${i}.formula`, e.target.value)}><option value="sum">求和</option><option value="average">平均</option><option value="min">最小</option><option value="max">最大</option><option value="ratio">比例</option></select>
        <input style={inputStyle} value={item.inputs.join(',')} placeholder="输入属性 ID（逗号分隔）" onChange={e => set(`derived.${i}.inputs`, e.target.value.split(',').map(v => v.trim()).filter(Boolean))} />
        <button className="btn-ghost" onClick={() => removeDerived(i)} style={{ color: 'var(--danger)', padding: '2px 5px' }}>✕</button>
        <div style={{ gridColumn: '2 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
          <input style={inputStyle} type="number" value={item.scale ?? 1} placeholder="倍率" onChange={e => set(`derived.${i}.scale`, Number(e.target.value) || 0)} />
          <input style={inputStyle} type="number" value={item.offset ?? 0} placeholder="偏移" onChange={e => set(`derived.${i}.offset`, Number(e.target.value) || 0)} />
          <input style={inputStyle} type="number" value={item.min ?? ''} placeholder="最小（可选）" onChange={e => set(`derived.${i}.min`, e.target.value === '' ? undefined : Number(e.target.value))} />
          <input style={inputStyle} type="number" value={item.max ?? ''} placeholder="最大（可选）" onChange={e => set(`derived.${i}.max`, e.target.value === '' ? undefined : Number(e.target.value))} />
        </div>
      </div>)}
      <button className="btn-ghost" onClick={addDerived} style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}>+ 添加派生属性</button>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>属性修正器</div>
      {(data.modifiers || []).map((item, i) => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '90px 90px 70px 78px 1fr 80px 46px auto', gap: 4, alignItems: 'center' }}>
        <input style={inputStyle} value={item.id} placeholder="ID" onChange={e => set(`modifiers.${i}.id`, e.target.value)} />
        <input style={inputStyle} value={item.statId} placeholder="属性 ID" onChange={e => set(`modifiers.${i}.statId`, e.target.value)} />
        <input style={inputStyle} type="number" value={item.delta} onChange={e => set(`modifiers.${i}.delta`, Number(e.target.value) || 0)} />
        <select style={inputStyle} value={item.mode || 'flat'} onChange={e => set(`modifiers.${i}.mode`, e.target.value)}><option value="flat">固定</option><option value="percent">百分比</option></select>
        <input style={inputStyle} value={item.source || ''} placeholder="来源" onChange={e => set(`modifiers.${i}.source`, e.target.value)} />
        <input style={inputStyle} type="number" value={item.durationTicks ?? ''} placeholder="持续 tick" onChange={e => set(`modifiers.${i}.durationTicks`, e.target.value === '' ? undefined : Number(e.target.value))} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }} title="永久修正不会自动过期"><input type="checkbox" checked={item.permanent !== false} onChange={e => set(`modifiers.${i}.permanent`, e.target.checked)} />永久</label>
        <button className="btn-ghost" onClick={() => removeModifier(i)} style={{ color: 'var(--danger)', padding: '2px 5px' }}>✕</button>
      </div>)}
      <button className="btn-ghost" onClick={addModifier} style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}>+ 添加修正器</button>
    </div>
  );
}
