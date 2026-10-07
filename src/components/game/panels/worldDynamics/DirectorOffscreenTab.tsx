import type { DirectorState } from '../../../../director/types';
import { EmptyLine, PanelCard, StatusPill, VerificationDetails } from './directorUi';
import { directorLabel, directorTitle, isSupplementaryRecord, participantName, type ParticipantNames } from './directorDisplay';
export function DirectorOffscreenTab({ director, participantNames }: { director?: DirectorState; participantNames?: ParticipantNames }) {
  const proposals=Object.values(director?.offscreenProposals??{}).sort((a,b)=>b.createdAt-a.createdAt);
  if(!proposals.length) return <EmptyLine text="暂无结构化幕后事件提案"/>;
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>{proposals.map(p=>{const r=director?.offscreenReceipts[p.logicalEventKey];return <PanelCard key={p.logicalEventKey} title={directorTitle(p.description, directorLabel(p.kind))} right={<><StatusPill>{directorLabel(p.kind)}</StatusPill><StatusPill>{directorLabel(r?.status??'pending')}</StatusPill></>}>
    {isSupplementaryRecord(p.description,p.logicalEventKey,p.directorRunId,r?.id)&&<div style={{fontSize:11,color:'var(--text-muted)'}}>存档补记</div>}
    <div style={{fontSize:12,marginTop:5}}>主体：{(p.subjectIds ?? []).map(id=>participantName(id,participantNames,director)).join('、')||'未指定'} · 可见性：{directorLabel(p.visibility)} · 时间：{p.occurredAt||'未注明'}</div>
    {r&&<div style={{display:'flex',gap:6,marginTop:6}}><StatusPill>变量处理：{directorLabel(r.consumers?.variables)}</StatusPill><StatusPill>记忆处理：{directorLabel(r.consumers?.memory)}</StatusPill></div>}
    <VerificationDetails data={{proposal:p,receipt:r}}/>
  </PanelCard>})}</div>;
}
