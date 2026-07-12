import type { ProgressionModuleSchema } from '../../../modules/schema';
import { inputStyle, labelStyle, setPathInClone } from './shared';

/** 成长体系编辑器（段位制/等级制分支） */
export function ProgressionModuleEditor({ data, onChange }: { data: ProgressionModuleSchema; onChange: (d: ProgressionModuleSchema) => void }) {
  const set = (path: string, value: unknown) => {
    onChange(setPathInClone(data as unknown as Record<string, unknown>, path, value) as unknown as ProgressionModuleSchema);
  };

  // 切换模式时初始化对应数据
  const switchMode = (mode: string) => {
    const next = JSON.parse(JSON.stringify(data));
    next.mode = mode;
    if (mode === 'tiered' && !next.tiers) {
      next.tiers = [];
    }
    if (mode === 'level' && !next.levelData) {
      next.levelData = {
        maxLevel: 100,
        baseStats: { attrAMax: 100, attrBMax: 100, dim1Max: 100, dim2Max: 100, dim3Max: 100, dim4Max: 100, dim5Max: 100, dim6Max: 100 },
        growthPerLevel: { attrAMax: 10, attrBMax: 10, dim1Max: 8, dim2Max: 8, dim3Max: 8, dim4Max: 8, dim5Max: 8, dim6Max: 8 },
      };
    }
    onChange(next);
  };

  const addTier = () => {
    const next = JSON.parse(JSON.stringify(data));
    if (!next.tiers) next.tiers = [];
    next.tiers.push({
      name: '新段位', description: '', xpRequired: 0,
      statBonuses: { attrAMax: 100, attrBMax: 100, dim1Max: 100, dim2Max: 100, dim3Max: 100, dim4Max: 100, dim5Max: 100, dim6Max: 100 },
    });
    onChange(next);
  };

  const removeTier = (i: number) => {
    const next = JSON.parse(JSON.stringify(data));
    next.tiers.splice(i, 1);
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={labelStyle}>模式</label>
        <select style={{ ...inputStyle, width: 'auto' }} value={data.mode} onChange={e => switchMode(e.target.value)}>
          <option value="tiered">段位制</option>
          <option value="level">等级制</option>
        </select>
      </div>

      {/* ── 段位制 ── */}
      {data.mode === 'tiered' && (
        <>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>段位列表</div>
          {(data.tiers || []).map((tier, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', minWidth: 16 }}>{i + 1}.</span>
              <input style={{ ...inputStyle, flex: 1 }} value={tier.name} onChange={e => set(`tiers.${i}.name`, e.target.value)} placeholder="段位名" />
              <input style={{ ...inputStyle, flex: 2 }} value={tier.description} onChange={e => set(`tiers.${i}.description`, e.target.value)} placeholder="描述" />
              <button onClick={() => removeTier(i)} style={{ border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}>✕</button>
            </div>
          ))}
          <button className="btn-ghost" onClick={addTier} style={{ fontSize: 'var(--font-size-xs)', padding: '2px 8px' }}>+ 添加段位</button>
        </>
      )}

      {/* ── 等级制 ── */}
      {data.mode === 'level' && data.levelData && (() => {
        const ld = data.levelData;
        // 属性名称映射（英文 → 中文）
        const statNameMap: Record<string, string> = {
          attrAMax: '生命上限',
          attrBMax: '能量上限',
          dim1Max: '属性1上限',
          dim2Max: '属性2上限',
          dim3Max: '属性3上限',
          dim4Max: '属性4上限',
          dim5Max: '属性5上限',
          dim6Max: '属性6上限',
        };
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <div>
                <label style={labelStyle}>最大等级</label>
                <input style={inputStyle} type="number" value={ld.maxLevel} onChange={e => set('levelData.maxLevel', Math.max(1, Number(e.target.value) || 100))} />
              </div>
              <div>
                <label style={labelStyle}>基础经验</label>
                <input style={inputStyle} type="number" value={data.xpFormula.baseXP} onChange={e => set('xpFormula.baseXP', Math.max(1, Number(e.target.value) || 100))} />
              </div>
              <div>
                <label style={labelStyle}>经验指数</label>
                <input style={inputStyle} type="number" step="0.1" value={data.xpFormula.exponent} onChange={e => set('xpFormula.exponent', Number(e.target.value) || 1.5)} />
              </div>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>0级属性天花板</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {(['attrAMax', 'attrBMax', 'dim1Max', 'dim2Max', 'dim3Max', 'dim4Max', 'dim5Max', 'dim6Max'] as const).map(key => (
                <div key={key}>
                  <label style={labelStyle}>{statNameMap[key] || key}</label>
                  <input style={inputStyle} type="number" value={ld.baseStats?.[key] ?? 0} onChange={e => set(`levelData.baseStats.${key}`, Number(e.target.value) || 0)} />
                </div>
              ))}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>每级属性增长</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {(['attrAMax', 'attrBMax', 'dim1Max', 'dim2Max', 'dim3Max', 'dim4Max', 'dim5Max', 'dim6Max'] as const).map(key => (
                <div key={key}>
                  <label style={labelStyle}>{statNameMap[key] || key}</label>
                  <input style={inputStyle} type="number" value={ld.growthPerLevel?.[key] ?? 0} onChange={e => set(`levelData.growthPerLevel.${key}`, Number(e.target.value) || 0)} />
                </div>
              ))}
            </div>
          </>
        );
      })()}
    </div>
  );
}
