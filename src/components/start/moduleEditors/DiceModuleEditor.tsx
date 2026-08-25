import type { DiceModuleSchema } from '../../../modules/schema';
import { inputStyle, labelStyle, setPathInClone } from './shared';

export function DiceModuleEditor({ data, onChange }: { data: DiceModuleSchema; onChange: (d: DiceModuleSchema) => void }) {
  const set = (path: string, value: unknown) => onChange(setPathInClone(data as unknown as Record<string, unknown>, path, value) as unknown as DiceModuleSchema);
  const tiers = data.resultTiers || {};
  const resultLabels = {
    criticalFailure: '大失败',
    failure: '失败',
    partial: '部分成功',
    success: '成功',
    criticalSuccess: '大成功',
  } as const;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 4 }}>
      <div><label style={labelStyle}>骰子面数</label><input style={inputStyle} type="number" min="2" value={data.sides ?? 20} onChange={e => set('sides', Math.max(2, Number(e.target.value) || 20))} /></div>
      <div><label style={labelStyle}>默认难度</label><input style={inputStyle} type="number" value={data.defaultDC ?? 10} onChange={e => set('defaultDC', Number(e.target.value) || 0)} /></div>
      <div><label style={labelStyle}>历史上限</label><input style={inputStyle} type="number" min="1" value={data.historyLimit ?? 10} onChange={e => set('historyLimit', Math.max(1, Number(e.target.value) || 10))} /></div>
      <div><label style={labelStyle}>基础修正</label><input style={inputStyle} type="number" value={data.modifierBase ?? 0} onChange={e => set('modifierBase', Number(e.target.value) || 0)} /></div>
      <div><label style={labelStyle}>修正步长</label><input style={inputStyle} type="number" value={data.modifierStep ?? 1} onChange={e => set('modifierStep', Number(e.target.value) || 0)} /></div>
      <div><label style={labelStyle}>大成功骰面</label><input style={inputStyle} type="number" value={data.criticalSuccess ?? 20} onChange={e => set('criticalSuccess', Number(e.target.value) || 20)} /></div>
      <div><label style={labelStyle}>大失败骰面</label><input style={inputStyle} type="number" value={data.criticalFailure ?? 1} onChange={e => set('criticalFailure', Number(e.target.value) || 1)} /></div>
      <div><label style={labelStyle}>部分成功差值</label><input style={inputStyle} type="number" value={data.partialSuccessMargin ?? 2} onChange={e => set('partialSuccessMargin', Number(e.target.value) || 0)} /></div>
    </div>
    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: 4 }}>结果等级文案</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 4 }}>
      {(Object.keys(resultLabels) as Array<keyof typeof resultLabels>).map(key => <label key={key} style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', alignItems: 'center', gap: 4, minWidth: 0 }}><span style={{ color: 'var(--text-muted)' }}>{resultLabels[key]}</span><input style={inputStyle} value={tiers[key] || ''} onChange={e => set(`resultTiers.${key}`, e.target.value)} placeholder="结果描述" /></label>)}
    </div>
  </div>;
}
