import type { SimulationState } from '../../../../simulation/types';
import { PanelCard, StatusPill } from './directorUi';
export function DirectorDiagnosticsTab({ simState }: { simState: SimulationState }) {
  const d=simState.director; const plans=Object.values(d?.plans??{}); const unknown=plans.flatMap(p=>p.dependencies.filter(x=>x.truth==='unknown'||x.truth===undefined).map(x=>({plan:p.id,dep:x})));
  const off=Object.values(d?.offscreenReceipts??{}); const failures=off.filter(r=>r.consumers.variables==='failed'||r.consumers.memory==='failed');
  const checks=[
    ['已有游戏规则结算记录', Boolean(simState.mechanics||simState.lastMechanicalSummary!==undefined)],
    ['幕后消费者无失败', failures.length===0],
    ['旧数据迁移已登记', Boolean(d?.legacyMigrated)],
  ] as const;
  return <div style={{display:'flex',flexDirection:'column',gap:10}}>
    <PanelCard title="运行记录">{checks.map(([label,ok])=><div key={label} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',fontSize:13}}><span>{label}</span><StatusPill>{ok?'已确认':'暂无记录或待处理'}</StatusPill></div>)}</PanelCard>
    <PanelCard title={`待确认前提 · ${unknown.length}`}>{unknown.length?unknown.slice(0,80).map((x,i)=><div key={i} style={{fontSize:12,padding:'4px 0',borderTop:i?'1px solid var(--border)':'none'}}>{d?.plans[x.plan]?.intent}：{x.dep.note || x.dep.ref}</div>):<div style={{fontSize:12,color:'var(--text-muted)'}}>当前没有待确认前提。</div>}</PanelCard>
    <PanelCard title="原始 DirectorState"><details><summary style={{fontSize:12,cursor:'pointer'}}>展开 JSON</summary><pre style={{fontSize:10,whiteSpace:'pre-wrap',overflow:'auto'}}>{JSON.stringify(d??{},null,2)}</pre></details></PanelCard>
  </div>;
}
