/** 剧情导演控制台：计划、指导、回执、幕后事件、来源版本与机械日志。 */
import { useMemo, useState } from 'react';
import { Clapperboard, RefreshCw } from 'lucide-react';
import { useSimulationStore } from '../../../stores/simulationStore';
import type { WorldDynamicsPanelProps } from './worldDynamics/types';
import { DirectorOverviewTab } from './worldDynamics/DirectorOverviewTab';
import { DirectorPlansTab } from './worldDynamics/DirectorPlansTab';
import { DirectorDirectivesTab } from './worldDynamics/DirectorDirectivesTab';
import { DirectorReceiptsTab } from './worldDynamics/DirectorReceiptsTab';
import { DirectorOffscreenTab } from './worldDynamics/DirectorOffscreenTab';
import { DirectorSourceTab } from './worldDynamics/DirectorSourceTab';
import { DirectorDiagnosticsTab } from './worldDynamics/DirectorDiagnosticsTab';
import { EffectLogTab } from './worldDynamics/EffectLogTab';
import { SimSettings } from './worldDynamics/SimSettings';

type TabId='overview'|'plans'|'directives'|'receipts'|'offscreen'|'source'|'diagnostics'|'mechanics'|'settings';
export default function WorldDynamicsPanel({ gameState,onManualTick,isSimulating }:WorldDynamicsPanelProps){
  const {simState,lastError,isMainlineReviewing,isBackgroundReviewing}=useSimulationStore(); const [active,setActive]=useState<TabId>('overview');
  const reviewing = isSimulating || isMainlineReviewing || isBackgroundReviewing;
  const director=simState.director; const effectLog=gameState?.simulationRuntime?.effectLog??[];
  const variableLabels=useMemo(()=>Object.fromEntries(Object.entries(gameState?.玩家?.生存资源??{}).map(([id,r])=>[id,String((r as any).name||(r as any).名称||id)])),[gameState]);
  const tabs:Array<{id:TabId;label:string;badge?:number}>=[
    {id:'overview',label:'总览'},{id:'plans',label:'计划图谱',badge:Object.keys(director?.plans??{}).length},{id:'directives',label:'当前指令',badge:Object.keys(director?.directives??{}).length},{id:'receipts',label:'落实回执',badge:director?.receipts?.length??0},{id:'offscreen',label:'幕后事件',badge:Object.keys(director?.offscreenReceipts??{}).length},{id:'source',label:'主线版本'},{id:'diagnostics',label:'依据诊断'},{id:'mechanics',label:'机械日志',badge:effectLog.length},{id:'settings',label:'设置'}];
  return <div className="game-director-panel">
    <div className="game-director-header">
      <Clapperboard size={17} color="var(--accent)"/><strong style={{fontSize:'var(--font-size-lg)'}}>剧情导演控制台</strong>
      <span style={{fontSize:11,color:'var(--text-muted)'}}>{simState.config.enabled?'已启用':'已暂停 · 游戏规则照常结算'}</span>
      <span className="game-director-header__spacer"/>
      <button className="btn-ghost btn-xs" disabled={reviewing} onClick={onManualTick}><RefreshCw size={12}/>{reviewing?'审查中':'手动审查'}</button>
    </div>
    {lastError && <div role="alert" className="game-director-error">{lastError}</div>}
    <div className="game-director-tabs">{tabs.map(t=><button key={t.id} className={active===t.id?'btn-primary btn-xs':'btn-ghost btn-xs'} onClick={()=>setActive(t.id)} style={{whiteSpace:'nowrap'}}>{t.label}{t.badge?` ${t.badge}`:''}</button>)}</div>
    <div className="game-director-body">
      {active==='overview'&&<DirectorOverviewTab simState={simState}/>} {active==='plans'&&<DirectorPlansTab director={director}/>} {active==='directives'&&<DirectorDirectivesTab director={director}/>} {active==='receipts'&&<DirectorReceiptsTab director={director}/>} {active==='offscreen'&&<DirectorOffscreenTab director={director}/>} {active==='source'&&<DirectorSourceTab simState={simState}/>} {active==='diagnostics'&&<DirectorDiagnosticsTab simState={simState}/>} {active==='mechanics'&&<EffectLogTab effectLog={effectLog} variableLabels={variableLabels}/>} {active==='settings'&&<SimSettings/>} 
    </div>
  </div>;
}

