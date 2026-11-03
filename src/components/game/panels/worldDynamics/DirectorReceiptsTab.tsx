import type { DirectorState } from '../../../../director/types';
import { EmptyLine, PanelCard, StatusPill, VerificationDetails } from './directorUi';
import { directorLabel, planTitle, turnTitle, isSupplementaryRecord } from './directorDisplay';
export function DirectorReceiptsTab({ director }: { director?: DirectorState }) {
  const receipts=[...(director?.receipts??[])].reverse();
  if(!receipts.length) return <EmptyLine text="还没有落实回执；指令不会因为被注入就自动算发生。"/>;
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>{receipts.map(r=><PanelCard key={r.id} title={turnTitle(r.turnId)} right={<StatusPill>{r.directiveId?'有关联指令':'无关联指令'}</StatusPill>}>
    {(r.outcomes ?? []).map((o,i)=><div key={`${o.planId}:${i}`} style={{padding:'6px 0',borderTop:i?'1px solid var(--border)':'none',fontSize:12}}><b>{directorLabel(o.outcome)}</b> · {planTitle(director,o.planId)}{isSupplementaryRecord(director?.plans[o.planId]?.intent,r.id,r.directiveId,o.evidence)&&<div style={{color:'var(--text-muted)',marginTop:3}}>存档补记</div>}</div>)}
    <VerificationDetails data={r}/>
  </PanelCard>)}</div>;
}
