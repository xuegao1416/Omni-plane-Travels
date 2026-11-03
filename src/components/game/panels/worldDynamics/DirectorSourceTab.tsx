import type { SimulationState } from '../../../../simulation/types';
import { PanelCard, StatusPill } from './directorUi';
export function DirectorSourceTab({ simState }: { simState: SimulationState }) {
  const source=simState.director?.sourceBinding;
  const stage = source?.stages?.find(item => item.id === source.currentStageId);
  const start = source?.stages?.find(item => item.id === source.startStageId);
  const role = Object.entries(source?.roleBinding ?? {}).find(([, id]) => id === 'player')?.[0];
  return <div style={{display:'flex',flexDirection:'column',gap:10}}>
    <PanelCard title="存档固定主线版本" right={<StatusPill>{source ? source.type === 'novel' ? '小说主线' : '原创主线' : '自由世界'}</StatusPill>}>
      {source?<div style={{fontSize:13,lineHeight:1.8}}><div>当前阶段：{source.exhausted ? '原稿已结束' : stage?.title ?? '等待可用阶段'}</div><div>开局起点：{start?.title ?? '默认起点'}</div><div>玩家身份：{role ? source.actorNames?.[role] ?? role : '自创角色'}</div><div>绑定时间：{new Date(source.boundAt).toLocaleString()}</div><details><summary>来源标识与版本</summary><div>{source.sourceId}</div><div>{source.version}</div></details></div>:<div style={{fontSize:13,color:'var(--text-muted)'}}>此存档没有绑定作者/小说主线。导演仍可处理自由世界与角色发展。</div>}
    </PanelCard>
    {!!source?.stages?.length && <PanelCard title="主线阶段">{source.stages.map(item => <div key={item.id} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'6px 0'}}><span>{item.title}</span><StatusPill>{{pending:'尚未开始',active:'当前阶段',completed:'已落实',failed:'未达成'}[item.status]}</StatusPill></div>)}</PanelCard>}
    {simState.mainline&&<PanelCard title="旧主线历史"><details><summary>查看归档记录</summary><pre style={{fontSize:11,whiteSpace:'pre-wrap'}}>{JSON.stringify(simState.mainline,null,2)}</pre></details></PanelCard>}
    <PanelCard title="版本规则"><div style={{fontSize:12,lineHeight:1.8,color:'var(--text-secondary)'}}>主线在开局时固定，编辑世界模板不会改变此存档。原稿结束后停止安排新主线，世界和人物仍可继续日常发展。</div></PanelCard>
  </div>;
}
