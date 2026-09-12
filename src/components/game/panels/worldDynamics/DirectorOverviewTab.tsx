import type { SimulationState } from '../../../../simulation/types';
import { PanelCard, StatusPill } from './directorUi';

export function DirectorOverviewTab({ simState }: { simState: SimulationState }) {
  const director = simState.director;
  const plans = Object.values(director?.plans ?? {});
  const directives = Object.values(director?.directives ?? {});
  const receipts = director?.receipts ?? [];
  const offscreen = Object.values(director?.offscreenReceipts ?? {});
  const latestDirective = [...directives].sort((a,b)=>b.createdAt-a.createdAt)[0];
  const mode = !director?.sourceBinding ? 'free_world' : director.sourceBinding.exhausted ? 'authored_story_exhausted' : 'authored_story';
  const stat = (label:string, value:number|string) => <div style={{ minWidth:110, flex:'1 1 110px', padding:10, background:'var(--bg-tertiary)', borderRadius:8 }}><div style={{fontSize:20,fontWeight:700}}>{value}</div><div style={{fontSize:11,color:'var(--text-muted)'}}>{label}</div></div>;
  return <div style={{display:'flex',flexDirection:'column',gap:10}}>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      {stat('计划总数', plans.length)}{stat('可调度', plans.filter(p=>p.status==='ready').length)}{stat('导演指令', directives.length)}{stat('落实回执', receipts.length)}{stat('幕后回执', offscreen.length)}{stat('机械 Tick', simState.mechanics?.tickCount ?? 0)}
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:10}}>
      <PanelCard title="当前导演指令" right={<StatusPill>{latestDirective ? `基于 ${latestDirective.basedOnTurnId}` : '尚未生成'}</StatusPill>}>
        {latestDirective?.primary ? <><div style={{fontWeight:600}}>{latestDirective.primary.intent}</div><div style={{marginTop:6,fontSize:12,color:'var(--text-muted)'}}>Primary · {latestDirective.primary.planId}</div><div style={{marginTop:6,fontSize:12}}>Secondary：{latestDirective.secondary.length}</div></> : <div style={{color:'var(--text-muted)',fontSize:13}}>等待首个可调度计划。</div>}
      </PanelCard>
      <PanelCard title="计划图谱">
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{['waiting','ready','directed','occurred','blocked','invalid','superseded'].map(s=><StatusPill key={s}>{s} {plans.filter(p=>p.status===s).length}</StatusPill>)}</div>
        <div style={{marginTop:8,fontSize:12,color:'var(--text-muted)'}}>依赖采用 true / false / unknown 三值逻辑；未知信息不会被当作失败。</div>
      </PanelCard>
      <PanelCard title="幕后消费者">
        <div style={{fontSize:13}}>variables done：{offscreen.filter(r=>r.consumers.variables==='done').length}</div>
        <div style={{fontSize:13}}>memory done：{offscreen.filter(r=>r.consumers.memory==='done').length}</div>
        <div style={{fontSize:13}}>memory failed/pending：{offscreen.filter(r=>r.consumers.memory!=='done').length}</div>
      </PanelCard>
      <PanelCard title="主线来源" right={<StatusPill>{mode}</StatusPill>}>
        {director?.sourceBinding ? <><div>{director.sourceBinding.type} · {director.sourceBinding.sourceId}</div><div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>version {director.sourceBinding.version} · {director.sourceBinding.exhausted ? '已耗尽' : '推进中'}</div></> : <div style={{color:'var(--text-muted)',fontSize:13}}>自由世界模式：没有固定作者/小说主线。</div>}
      </PanelCard>
    </div>
    <PanelCard title="权限边界">
      <div style={{fontSize:12,lineHeight:1.8,color:'var(--text-secondary)'}}>Directive ≠ Fact · Proposal ≠ Fact · accepted + committed Event Receipt 才表示幕后事实发生 · Outcome Receipt 才能推进 PlotPlan 实际进度 · 玩家已知资料不与后台真相自动同步。</div>
    </PanelCard>
  </div>;
}
