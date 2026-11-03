import type { DirectorState } from '../../../../director/types';
import { EmptyLine, PanelCard, StatusPill } from './directorUi';
export function DirectorDirectivesTab({ director }: { director?: DirectorState }) {
  const directives = Object.values(director?.directives ?? {}).sort((a,b)=>b.createdAt-a.createdAt);
  if(!directives.length) return <EmptyLine text="还没有生成导演指令"/>;
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>{directives.map(d=><PanelCard key={d.id} title={`Directive · ${d.id}`} right={<StatusPill>{d.basedOnTurnId}</StatusPill>}>
    {[d.primary,...d.secondary].filter(Boolean).map((item,index)=><div key={item!.planId} style={{padding:'7px 0',borderTop:index?'1px solid var(--border)':'none'}}>
      <div style={{display:'flex',gap:6,alignItems:'center'}}><StatusPill>{index===0?'PRIMARY':'SECONDARY'}</StatusPill><b style={{fontSize:13}}>{item!.intent}</b></div>
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>{item!.planId} · priority {item!.priority}</div>
      {item!.constraints?.length?<div style={{fontSize:12,marginTop:5}}>约束：{item!.constraints!.join('；')}</div>:null}
      {item!.deferIf?.length?<div style={{fontSize:12,marginTop:3}}>暂缓：{item!.deferIf!.join('；')}</div>:null}
      {item!.forbiddenKnowledge?.length?<div style={{fontSize:12,marginTop:3}}>禁止泄露：{item!.forbiddenKnowledge!.join('；')}</div>:null}
    </div>)}
  </PanelCard>)}</div>;
}
