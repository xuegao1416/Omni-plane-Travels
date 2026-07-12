import type { StatModuleSchema } from '../../../modules/schema';
import { inputStyle, labelStyle, setPathInClone } from './shared';

/** 数值属性编辑器 */
export function StatModuleEditor({ data, onChange }: { data: StatModuleSchema; onChange: (d: StatModuleSchema) => void }) {
  const set = (path: string, value: unknown) => {
    onChange(setPathInClone(data as unknown as Record<string, unknown>, path, value) as unknown as StatModuleSchema);
  };

  const addSpecial = () => {
    if (data.special.length >= 4) return;
    const next = JSON.parse(JSON.stringify(data));
    next.special.push({ id: `special_${Date.now()}`, name: '新特色属性', value: 50, range: [0, 100], description: '' });
    onChange(next);
  };

  const removeSpecial = (i: number) => {
    const next = JSON.parse(JSON.stringify(data));
    next.special.splice(i, 1);
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div><label style={labelStyle}>生命类名称</label><input style={inputStyle} value={data.attrA.name} onChange={e => set('attrA.name', e.target.value)} /></div>
        <div><label style={labelStyle}>能量类名称</label><input style={inputStyle} value={data.attrB.name} onChange={e => set('attrB.name', e.target.value)} /></div>
      </div>
      {/* 六维属性（选了数值模块就是固定六维，只能改名） */}
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>六维属性</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {(['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const).map(key => {
          const dim = data[key];
          return (
            <div key={key}>
              <label style={labelStyle}>{key}</label>
              <input style={inputStyle} value={dim?.name ?? ''} onChange={e => set(`${key}.name`, e.target.value)} placeholder="属性名" />
            </div>
          );
        })}
      </div>
      {/* 特色属性（0~4个） */}
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>
        特色属性（0~4个，数值型）
        {data.special.length >= 4 && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>已达上限</span>}
      </div>
      {data.special.map((sp, i) => (
        <div key={sp.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input style={{ ...inputStyle, width: 80 }} value={sp.name} onChange={e => set(`special.${i}.name`, e.target.value)} placeholder="属性名" />
          <input style={{ ...inputStyle, width: 50 }} type="number" value={sp.range[0]} onChange={e => set(`special.${i}.range`, [Number(e.target.value) || 0, sp.range[1]])} placeholder="最小" title="最小值" />
          <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>~</span>
          <input style={{ ...inputStyle, width: 50 }} type="number" value={sp.range[1]} onChange={e => set(`special.${i}.range`, [sp.range[0], Number(e.target.value) || 0])} placeholder="最大" title="最大值" />
          <input style={{ ...inputStyle, flex: 1 }} value={sp.description} onChange={e => set(`special.${i}.description`, e.target.value)} placeholder="属性描述（如：领悟武学本质的境界）" />
          <button onClick={() => removeSpecial(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}>✕</button>
        </div>
      ))}
      {data.special.length < 4 && (
        <button className="btn-ghost" onClick={addSpecial} style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}>+ 添加特色属性</button>
      )}
    </div>
  );
}
