import type { SurvivalModuleSchema } from '../../../modules/schema';

/** 生存资源编辑器 */
export function SurvivalModuleEditor({ data, onChange }: {
  data: SurvivalModuleSchema; onChange: (d: Record<string, unknown>) => void;
}) {
  const commit = (next: SurvivalModuleSchema) => onChange(next as any);

  const addResource = () => {
    const next = JSON.parse(JSON.stringify(data));
    next.resources.push({ id: `res_${Date.now()}`, name: '新资源', symbol: '📦', amount: 5, max: 10, scarce: false, gatherRate: '', usage: '', description: '' });
    commit(next);
  };

  const removeResource = (i: number) => {
    const next = JSON.parse(JSON.stringify(data));
    next.resources.splice(i, 1);
    commit(next);
  };

  const setResField = (i: number, field: string, value: unknown) => {
    const next = JSON.parse(JSON.stringify(data));
    next.resources[i][field] = value;
    commit(next);
  };

  const setRulesField = (field: string, value: unknown) => {
    const next = JSON.parse(JSON.stringify(data));
    if (!next.rules) next.rules = { cycleName: '一天', consumePerCycle: '', criticalThreshold: 2 };
    next.rules[field] = value;
    commit(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--font-size-xs)' }}>
      {/* 整体描述 */}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ color: 'var(--text-muted)' }}>整体描述</span>
        <input value={data.description || ''} onChange={e => commit({ ...data, description: e.target.value })} placeholder="一句话描述生存资源系统" style={{ padding: '4px 8px', fontSize: 'var(--font-size-xs)' }} />
      </label>

      {/* 生存规则 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: 'var(--text-muted)' }}>结算周期</span>
          <input value={data.rules?.cycleName || '一天'} onChange={e => setRulesField('cycleName', e.target.value)} style={{ padding: '4px 8px', fontSize: 'var(--font-size-xs)' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: 'var(--text-muted)' }}>危机阈值</span>
          <input type="number" value={data.rules?.criticalThreshold ?? 2} onChange={e => setRulesField('criticalThreshold', Number(e.target.value))} style={{ padding: '4px 8px', fontSize: 'var(--font-size-xs)' }} />
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ color: 'var(--text-muted)' }}>每周期消耗 <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>(AI参考描述，非固定值)</span></span>
        <input value={data.rules?.consumePerCycle || ''} onChange={e => setRulesField('consumePerCycle', e.target.value)} placeholder="如：每人每天消耗1份口粮+1份水，人数增加时等比增长" style={{ padding: '4px 8px', fontSize: 'var(--font-size-xs)' }} />
      </label>

      {/* 资源列表 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>资源列表</span>
        <button className="btn-ghost" onClick={addResource} style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}>+ 添加</button>
      </div>
      {data.resources.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>暂无资源，点击"添加"创建</div>
      )}
      {data.resources.map((res, i) => (
        <div key={res.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input value={res.symbol} onChange={e => setResField(i, 'symbol', e.target.value)} style={{ width: 32, textAlign: 'center', padding: '4px', fontSize: 'var(--font-size-sm)' }} placeholder="图标" />
            <input value={res.name} onChange={e => setResField(i, 'name', e.target.value)} style={{ flex: 1, padding: '4px 8px', fontSize: 'var(--font-size-xs)' }} placeholder="资源名" />
            <input type="number" value={res.amount} onChange={e => setResField(i, 'amount', Number(e.target.value))} style={{ width: 48, padding: '4px', fontSize: 'var(--font-size-xs)' }} title="初始数量" />
            <span style={{ color: 'var(--text-muted)' }}>/</span>
            <input type="number" value={res.max} onChange={e => setResField(i, 'max', Number(e.target.value))} style={{ width: 48, padding: '4px', fontSize: 'var(--font-size-xs)' }} title="上限" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 2, color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={res.scarce} onChange={e => setResField(i, 'scarce', e.target.checked)} /> 稀缺
            </label>
            <button className="btn-ghost" onClick={() => removeResource(i)} style={{ color: '#ef4444', padding: '2px 6px', fontSize: 'var(--font-size-xs)' }}>✕</button>
          </div>
          <input value={res.description || ''} onChange={e => setResField(i, 'description', e.target.value)} placeholder="获取方式与用途" style={{ padding: '4px 8px', fontSize: 'var(--font-size-xs)' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <input value={res.gatherRate || ''} onChange={e => setResField(i, 'gatherRate', e.target.value)} placeholder="采集描述（如：初期每天3单位，后期可增长）" style={{ padding: '4px 8px', fontSize: 'var(--font-size-xs)' }} />
            <input value={res.usage || ''} onChange={e => setResField(i, 'usage', e.target.value)} placeholder="消耗描述（如：初期每天1单位，人数增加时等比）" style={{ padding: '4px 8px', fontSize: 'var(--font-size-xs)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
