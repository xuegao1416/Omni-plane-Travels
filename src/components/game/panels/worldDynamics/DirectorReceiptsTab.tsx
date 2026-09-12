import type { DirectorState } from '../../../../director/types';
import { EmptyLine, PanelCard, StatusPill } from './directorUi';
export function DirectorReceiptsTab({ director }: { director?: DirectorState }) {
  const receipts=[...(director?.receipts??[])].reverse();
  if(!receipts.length) return <EmptyLine text="还没有落实回执；指令不会因为被注入就自动算发生。"/>;
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>{receipts.map(r=><PanelCard key={r.id} title={`Turn · ${r.turnId}`} right={<StatusPill>{r.directiveId??'no directive'}</StatusPill>}>
    {r.outcomes.map((o,i)=><div key={`${o.planId}:${i}`} style={{padding:'6px 0',borderTop:i?'1px solid var(--border)':'none',fontSize:12}}><b>{o.outcome}</b> · {o.planId}{o.evidence?<div style={{color:'var(--text-muted)',marginTop:3}}>证据：{o.evidence}</div>:null}</div>)}
  </PanelCard>)}</div>;
}
