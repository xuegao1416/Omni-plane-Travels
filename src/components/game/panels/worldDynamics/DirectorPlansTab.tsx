import { useMemo, useState } from 'react';
import type { DirectorState, PlotPlanStatus } from '../../../../director/types';
import { EmptyLine, PanelCard, StatusPill } from './directorUi';

const statuses: Array<'all'|PlotPlanStatus> = ['all','ready','directed','waiting','blocked','occurred','invalid','superseded'];
export function DirectorPlansTab({ director }: { director?: DirectorState }) {
  const [filter,setFilter] = useState<(typeof statuses)[number]>('all');
  const [view,setView] = useState<'cards'|'graph'|'json'>('cards');
  const plans = useMemo(()=>Object.values(director?.plans ?? {}).sort((a,b)=>b.priority-a.priority),[director]);
  const shown = filter==='all' ? plans : plans.filter(p=>p.status===filter);
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
      {statuses.map(s=><button key={s} className={filter===s?'btn-primary btn-xs':'btn-ghost btn-xs'} onClick={()=>setFilter(s)}>{s} {s==='all'?plans.length:plans.filter(p=>p.status===s).length}</button>)}
      <span style={{flex:1}}/><button className={view==='cards'?'btn-primary btn-xs':'btn-ghost btn-xs'} onClick={()=>setView('cards')}>卡片</button><button className={view==='graph'?'btn-primary btn-xs':'btn-ghost btn-xs'} onClick={()=>setView('graph')}>依赖</button><button className={view==='json'?'btn-primary btn-xs':'btn-ghost btn-xs'} onClick={()=>setView('json')}>JSON</button>
    </div>
    {shown.length===0 && <EmptyLine text="当前筛选下没有计划"/>}
    {view==='json' ? <pre style={{whiteSpace:'pre-wrap',fontSize:11,background:'var(--bg-secondary)',padding:12,borderRadius:8,overflow:'auto'}}>{JSON.stringify(shown,null,2)}</pre> : shown.map(plan=><PanelCard key={plan.id} title={plan.intent} right={<><StatusPill>{plan.status}</StatusPill> <StatusPill>P{plan.priority}</StatusPill></>}>
      <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:6}}>{plan.id} · source:{plan.source}{plan.sourceRef?` / ${plan.sourceRef}`:''}</div>
      <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:6}}>{plan.participants.map(x=><StatusPill key={x}>{x}</StatusPill>)}</div>
      {view==='graph' && <div style={{display:'flex',flexDirection:'column',gap:4}}>{plan.dependencies.length ? plan.dependencies.map((d,i)=><div key={i} style={{fontSize:12,padding:'5px 7px',background:'var(--bg-tertiary)',borderRadius:6}}>{d.kind}:{d.ref} → <b>{d.truth ?? 'unknown'}</b>{d.note?` · ${d.note}`:''}</div>) : <div style={{fontSize:12,color:'var(--text-muted)'}}>无前置依赖</div>}</div>}
      {view==='cards' && <>{plan.constraints?.length ? <div style={{fontSize:12}}>约束：{plan.constraints.join('；')}</div>:null}{plan.mutableRange?.length ? <div style={{fontSize:12}}>可变范围：{plan.mutableRange.join('；')}</div>:null}{plan.preserveDirection?.length ? <div style={{fontSize:12}}>保留方向：{plan.preserveDirection.join('；')}</div>:null}</>}
    </PanelCard>)}
  </div>;
}
