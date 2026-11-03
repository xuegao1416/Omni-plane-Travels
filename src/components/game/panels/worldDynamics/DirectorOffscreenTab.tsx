import type { DirectorState } from '../../../../director/types';
import { EmptyLine, PanelCard, StatusPill } from './directorUi';
export function DirectorOffscreenTab({ director }: { director?: DirectorState }) {
  const proposals=Object.values(director?.offscreenProposals??{}).sort((a,b)=>b.createdAt-a.createdAt);
  if(!proposals.length) return <EmptyLine text="暂无结构化幕后事件提案"/>;
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>{proposals.map(p=>{const r=director?.offscreenReceipts[p.logicalEventKey];return <PanelCard key={p.logicalEventKey} title={p.description||p.kind} right={<><StatusPill>{p.kind}</StatusPill><StatusPill>{r?.status??'pending'}</StatusPill></>}>
    <div style={{fontSize:11,color:'var(--text-muted)'}}>{p.logicalEventKey} · base {p.baseStateVersion}</div>
    <div style={{fontSize:12,marginTop:5}}>主体：{p.subjectIds.join('、')||'—'} · 可见性：{p.visibility} · 时间：{p.occurredAt||'—'}</div>
    {r&&<div style={{display:'flex',gap:6,marginTop:6}}><StatusPill>variables:{r.consumers.variables}</StatusPill><StatusPill>memory:{r.consumers.memory}</StatusPill></div>}
    <details style={{marginTop:7,fontSize:12}}><summary>payload / prerequisites</summary><pre style={{whiteSpace:'pre-wrap',fontSize:11}}>{JSON.stringify({payload:p.payload,prerequisites:p.prerequisites},null,2)}</pre></details>
  </PanelCard>})}</div>;
}
