import type { ProgressionModuleSchema } from '../../../modules/schema';
import { inputStyle, labelStyle, setPathInClone } from './shared';
import { ConditionListEditor, CostListEditor, EffectListEditor } from './GameplayRuleEditors';

const TIER_STAT_FIELDS = [
  ['attrAMax', '生命上限'], ['attrBMax', '能量上限'],
  ['dim1Max', '属性一上限'], ['dim2Max', '属性二上限'], ['dim3Max', '属性三上限'],
  ['dim4Max', '属性四上限'], ['dim5Max', '属性五上限'], ['dim6Max', '属性六上限'],
] as const;

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

  const addActivity = () => onChange({ ...JSON.parse(JSON.stringify(data)), activityRewards: [...(data.activityRewards || []), { id: `activity_${Date.now()}`, label: '新活动', keywords: [], rate: 0.1 }] });
  const removeActivity = (i: number) => onChange({ ...JSON.parse(JSON.stringify(data)), activityRewards: (data.activityRewards || []).filter((_, index) => index !== i) });
  const addBreakthrough = () => onChange({ ...JSON.parse(JSON.stringify(data)), breakthroughs: [...(data.breakthroughs || []), { tierIndex: 0, conditions: [], costs: [], rewards: [], description: '' }] });
  const removeBreakthrough = (i: number) => onChange({ ...JSON.parse(JSON.stringify(data)), breakthroughs: (data.breakthroughs || []).filter((_, index) => index !== i) });

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
            <div key={i} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, padding: '9px 38px 9px 9px', border: '1px solid var(--border)', borderRadius: 8, background: 'color-mix(in srgb, var(--bg-primary) 55%, transparent)', minWidth: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6, alignItems: 'end', minWidth: 0 }}>
                <label style={labelStyle}>第 {i + 1} 段<input style={inputStyle} value={tier.name} onChange={e => set(`tiers.${i}.name`, e.target.value)} placeholder="段位名称" /></label>
                <label style={labelStyle}>段位描述<input style={inputStyle} value={tier.description} onChange={e => set(`tiers.${i}.description`, e.target.value)} placeholder="这一阶段的特征" /></label>
                <label style={labelStyle}>累计经验要求<input style={inputStyle} type="number" min="0" value={tier.xpRequired ?? 0} onChange={e => set(`tiers.${i}.xpRequired`, Math.max(0, Number(e.target.value) || 0))} /></label>
                <button aria-label={`删除第 ${i + 1} 段`} onClick={() => removeTier(i)} style={{ position: 'absolute', top: 8, right: 8, border: 'none', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, padding: '5px' }}>✕</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 5 }}>
                {TIER_STAT_FIELDS.map(([key, label]) => <label key={key} style={labelStyle}>{label}<input style={inputStyle} type="number" min="1" value={tier.statBonuses?.[key] ?? ''} onChange={e => set(`tiers.${i}.statBonuses.${key}`, Math.max(1, Number(e.target.value) || 1))} /></label>)}
              </div>
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
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>经验与升级规则</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        <input style={inputStyle} type="number" value={data.xpFormula.scaleFactor} placeholder="经验缩放" onChange={e => set('xpFormula.scaleFactor', Number(e.target.value) || 1)} />
        <input style={inputStyle} type="number" value={data.pointsPerTier?.attribute ?? 0} placeholder="属性点/次" onChange={e => set('pointsPerTier.attribute', Number(e.target.value) || 0)} />
        <input style={inputStyle} type="number" value={data.pointsPerTier?.talent ?? 0} placeholder="天赋点/次" onChange={e => set('pointsPerTier.talent', Number(e.target.value) || 0)} />
        <input style={inputStyle} type="number" value={data.pointsPerTier?.skill ?? 0} placeholder="技能点/次" onChange={e => set('pointsPerTier.skill', Number(e.target.value) || 0)} />
        <input style={inputStyle} value={data.narrativeStyle?.upgradeDesc || ''} placeholder="升级叙事描述" onChange={e => set('narrativeStyle.upgradeDesc', e.target.value)} />
        <input style={inputStyle} value={(data.narrativeStyle?.keywords || []).join(',')} placeholder="叙事关键词" onChange={e => set('narrativeStyle.keywords', e.target.value.split(',').map(v => v.trim()).filter(Boolean))} />
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>活动经验来源</div>
      {(data.activityRewards || []).map((item, i) => <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 4, minWidth: 0 }}>
        <input style={inputStyle} value={item.label} onChange={e => set(`activityRewards.${i}.label`, e.target.value)} placeholder="名称" />
        <input style={inputStyle} value={item.keywords.join(',')} onChange={e => set(`activityRewards.${i}.keywords`, e.target.value.split(',').map(v => v.trim()).filter(Boolean))} placeholder="关键词" />
        <input aria-label="经验比例" title="经验比例" style={inputStyle} type="number" step="0.01" min="0" max="1" value={item.rate} onChange={e => set(`activityRewards.${i}.rate`, Number(e.target.value) || 0)} placeholder="经验比例" />
        <button className="btn-ghost" onClick={() => removeActivity(i)} style={{ color: 'var(--danger)', padding: '2px 5px' }}>✕</button>
      </div>)}
      <button className="btn-ghost" onClick={addActivity} style={{ alignSelf: 'flex-start', padding: '2px 8px' }}>+ 添加经验来源</button>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>突破规则</div>
      {(data.breakthroughs || []).map((item, i) => <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 5, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr auto', gap: 4 }}><input style={inputStyle} type="number" value={item.tierIndex} onChange={e => set(`breakthroughs.${i}.tierIndex`, Number(e.target.value) || 0)} placeholder="目标段位" /><input style={inputStyle} value={item.description || ''} onChange={e => set(`breakthroughs.${i}.description`, e.target.value)} placeholder="突破描述" /><button className="btn-ghost" onClick={() => removeBreakthrough(i)} style={{ color: 'var(--danger)', padding: '2px 5px' }}>✕</button></div>
        <span style={{ color: 'var(--text-muted)' }}>条件</span><ConditionListEditor value={item.conditions} onChange={conditions => set(`breakthroughs.${i}.conditions`, conditions)} />
        <span style={{ color: 'var(--text-muted)' }}>消耗</span><CostListEditor value={item.costs} onChange={costs => set(`breakthroughs.${i}.costs`, costs)} />
        <span style={{ color: 'var(--text-muted)' }}>奖励</span><EffectListEditor value={item.rewards} onChange={rewards => set(`breakthroughs.${i}.rewards`, rewards)} />
      </div>)}
      <button className="btn-ghost" onClick={addBreakthrough} style={{ alignSelf: 'flex-start', padding: '2px 8px' }}>+ 添加突破规则</button>
    </div>
  );
}
