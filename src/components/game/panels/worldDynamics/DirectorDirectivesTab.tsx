import type { DirectorState } from '../../../../director/types';
import { EmptyLine, PanelCard, StatusPill, VerificationDetails } from './directorUi';
import { directorTitle, turnTitle, isSupplementaryRecord } from './directorDisplay';
export function DirectorDirectivesTab({ director }: { director?: DirectorState }) {
  const directives = Object.values(director?.directives ?? {}).sort((a,b)=>b.createdAt-a.createdAt);
  if(!directives.length) return <EmptyLine text="还没有生成导演指令"/>;
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>{directives.map(d=><PanelCard key={d.id} title="导演指令" right={<StatusPill>{`基于${turnTitle(d.basedOnTurnId)}`}</StatusPill>}>
    {[...(d.primary?[{item:d.primary,primary:true}]:[]),...(d.secondary??[]).map(item=>({item,primary:false}))].map(({item,primary},index)=><div key={`${item.planId}:${index}`} style={{padding:'7px 0',borderTop:index?'1px solid var(--border)':'none'}}>
      <div style={{display:'flex',gap:6,alignItems:'center'}}><StatusPill>{primary?'主要安排':'次要安排'}</StatusPill><b style={{fontSize:13}}>{directorTitle(item.intent)}</b></div>
      <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>优先级：{item.priority}{isSupplementaryRecord(item.intent,d.id,d.directorRunId)?' · 存档补记':''}</div>
      {item.constraints?.length?<div style={{fontSize:12,marginTop:5}}>约束：{item.constraints.join('；')}</div>:null}
      {item.deferIf?.length?<div style={{fontSize:12,marginTop:3}}>暂缓：{item.deferIf.join('；')}</div>:null}
      {item.forbiddenKnowledge?.length?<div style={{fontSize:12,marginTop:3}}>禁止泄露：{item.forbiddenKnowledge.join('；')}</div>:null}
    </div>)}
    <VerificationDetails data={d}/>
  </PanelCard>)}</div>;
}
