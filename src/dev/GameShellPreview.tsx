import { useState } from 'react';
import { UISettingsProvider } from '../context/UISettingsContext';
import DesktopLayout from '../components/game/gameScreen/DesktopLayout';
import MobileLayout from '../components/game/gameScreen/MobileLayout';
import ChatPanel from '../components/game/chat/ChatPanel';
import { navButtons,buildMobileNavItems } from '../components/game/gameScreen/navConfig';
import { DOSSIER_META,normalizeDossierPanel } from '../components/game/shared/journeyDossierMeta';
import type { OverlayPanel } from '../components/game/gameScreen/types';
import type { ChatMessage } from '../engine/types';
import type { PipelineStatus } from '../engine/pipelineTypes';
import { useMediaQuery } from '../hooks/useIsMobile';
import { useMemoryStore } from '../memory/memoryStore';
import type { NarrativeMemoryRuntime } from '../memory/types';
import ProfilePanel from '../components/game/panels/ProfilePanel';
import CharacterGrid from '../components/game/panels/CharacterGrid';
import TaskPanel from '../components/game/panels/TaskPanel';
import NotebookPanel from '../components/game/panels/NotebookPanel';
import WorldBookPanel from '../components/game/panels/WorldBookPanel';
import WorldDynamicsPanel from '../components/game/panels/WorldDynamicsPanel';
import RightPanel from '../components/game/panels/RightPanel';
import JourneyDossierContent from '../components/game/shared/JourneyDossierContent';
import { VariableManager } from '../engine/variableManager';
import { createSampleGameState } from './gamePanelsSample';
import EconomyLedger from '../components/game/panels/EconomyLedger';
import { buildEconomyViewModel } from '../domains/economy/viewModel';
import ResourcesLedger from '../components/game/panels/ResourcesLedger';
import { buildResourcesViewModel } from '../domains/resources/viewModel';
import { getWorldById } from '../data/worldLoader';
import type { BusinessModuleSchema,SurvivalModuleSchema } from '../modules/schema';
import VariableSnapshotPanel from '../components/game/panels/VariableSnapshotPanel';
import ProfessionTreePanel from '../components/game/panels/ProfessionTreePanel';
import { MemorySettingsOverlay } from '../components/settings/memory/MemorySettingsOverlay';
import EventConfigPanel from '../components/event/EventConfigPanel';
import { findWorldDef } from '../data/worldLoader';
import { resolveProfessionBinding } from '../data/professions/professionLibrary';
import '../ui/screens/game.css';
import '../ui/screens/game-story.css';
import '../ui/screens/game-dossier.css';
import '../ui/screens/game-panels.css';

/**
 * Localhost-only visual QA harness for the in-game shell (`?plshot=game`).
 * Renders the real layouts and chat panel with fixed sample turns; no engine,
 * storage or network is touched.
 */
const SAMPLE: ChatMessage[] = [
  { id: 'a1', role: 'assistant', round: 1, timestamp: 0, rawText: '暮色压在青石街上。你在城门下站定，守卫的灯笼被风吹得一晃一晃，照出一张写满倦意的脸。\n\n「入城的？」他抬了抬下巴，「天黑之后，东市不太平。」\n\n远处传来钟声，一共七下。' },
  { id: 'u1', role: 'user', round: 1, timestamp: 1, rawText: '向守卫打听东市最近出了什么事。' },
  { id: 'a2', role: 'assistant', round: 2, timestamp: 2, rawText: '守卫左右看了看，压低声音：「三天里丢了两个更夫。衙门说是醉倒在河里，可尸首一个都没捞着。」\n\n他把灯笼往你这边递了递。「你要真去，就走北边那条巷子，别碰河。」' },
];

/** Sample turn pipeline for `?plshot=game&pipeline=1`: a mix of finished, running, failed and skipped tasks. */
function samplePipeline(): PipelineStatus {
  const t = 1_700_000_000_000;
  const done = (label: string, start: number, ms: number, dataLength?: number) => ({ status: 'success' as const, label, startTime: t + start, endTime: t + start + ms, dataLength });
  return {
    round: 2,
    startTime: t,
    stages: {
      main: done('正文', 0, 8420, 612),
      memory_write: done('叙事写入', 8500, 3120),
      memory_summary: done('结构化摘要', 8500, 2740),
      memory_vector: { status: 'error', label: '长期向量', startTime: t + 8500, endTime: t + 9900, error: 'HTTP 429 Too Many Requests\n{"error":{"message":"Rate limit reached for requests","type":"requests"}}' },
      memory_query_rewrite: done('检索改写', 11700, 1380),
      memory_retrieve_plan: done('检索规划', 13100, 2210),
      memory_multi_round: { status: 'skipped', label: '多轮检索', skipped: true },
      memory_rerank: { status: 'warning', label: '精排', startTime: t + 15400, endTime: t + 17000 },
      memory_retrieve_finalize: done('检索收尾', 17000, 42),
      memory_compile: { status: 'running', label: '记忆编译', startTime: t + 17100 },
      variable: { status: 'pending', label: '变量' },
      settlement: { status: 'pending', label: '结算' },
    },
  } as PipelineStatus;
}

const SAMPLE_MEMORY = {
  sceneAnchor: { timeLabel: '第三日 · 黄昏', locationLabel: '临安城 · 北城门', presentEntities: ['e1', 'e2', 'e3'], immediateGoal: '打探师兄下落', immediateRisk: '官府盘查', conversationFocus: '听雨楼的密信', recentChange: '得到半张地图', confidence: 0.8 },
  activeThreads: [{ id: 't1', title: '寻找师兄', status: 'open' }, { id: 't2', title: '密信来源', status: 'blocked' }],
  entityCards: [
    { id: 'e1', name: '林惊鸿', entityType: 'character', summary: '青衫剑客，寻找失踪师兄' },
    { id: 'e2', name: '听雨楼', entityType: 'faction', summary: '江南情报楼' },
    { id: 'e3', name: '临安城', entityType: 'location', summary: '雨夜的城' },
  ],
  eventCards: [{ id: 'v1', title: '雨夜截信', summary: '在北门截下密信', importance: 3, status: 'hot', entityRefs: ['e1', 'e2'] }],
  stateSlots: [], relationEdges: [], relationNetwork: [], archiveCards: [], checkpoints: [], summarySaveHistory: [], mutationLog: [],
};

export default function GameShellPreview() {
  const params = new URLSearchParams(window.location.search);
  // `memory=sample` fills the memory store so the runtime graph has something to draw.
  useState(() => {
    if (params.get('memory') !== 'sample') return;
    const current = useMemoryStore.getState().memoryRuntime;
    useMemoryStore.setState({ memoryRuntime: { ...(current ?? {}), ...SAMPLE_MEMORY } as unknown as NarrativeMemoryRuntime });
  });
  const initialPanel = (params.get('panel') as OverlayPanel) ?? null;
  const [overlay, setOverlay] = useState<OverlayPanel>(initialPanel);
  const [mobilePanel, setMobilePanel] = useState<OverlayPanel>(initialPanel);
  const [rightCollapsed, setRightCollapsed] = useState(params.get('right') === 'off');
  const [leftOpen, setLeftOpen] = useState(params.get('nav') === 'open');
  const [rightOpen, setRightOpen] = useState(params.get('info') === 'open');
  const isMobile = useMediaQuery('(max-width: 640px)');
  const noop = () => undefined;
  const moduleConfig = <T,>(worldId: string, moduleId: string) => getWorldById(worldId)?.modules?.find(module => module.moduleId === moduleId)?.moduleConfig as T | undefined;
  const businessBase = moduleConfig<BusinessModuleSchema>('border_trade', 'business');
  // `&assets=1` fills the ledger with an owned stall, a shop for sale and a short log.
  const businessPreview = businessBase && params.get('assets') ? {
    ...businessBase,
    funds: 1280,
    assets: [
      { id: 'stall', name: '口岸货摊', type: '零售', level: 2, maxLevel: 4, description: '黑河口岸边的临时货摊，卖羽绒服和方便面给俄商。', income: { base: 60, perLevel: 25, cycle: '趟' }, maintenance: 20, upgradeCost: 400, upgradeMaterials: { 木板: 6 }, staff: { current: 2, max: 3, efficiency: 1.2 }, risk: { level: 'medium' as const, description: '海关抽查' }, status: 'active' as const },
      { id: 'warehouse', name: '江边仓库', type: '仓储', level: 1, maxLevel: 3, description: '能囤两车货的旧仓库。', initiallyOwned: false, purchaseCost: 900, purchaseMaterials: { 铁皮: 4 }, income: { base: 40, perLevel: 20, cycle: '趟' }, maintenance: 15, status: 'active' as const },
    ],
    transactionLog: [
      { cycle: 3, type: 'income' as const, description: '货摊卖出 12 件羽绒服', amount: 960 },
      { cycle: 3, type: 'expense' as const, description: '打点口岸', amount: -120 },
      { cycle: 4, type: 'upgrade' as const, description: '货摊扩到两张桌子', amount: -400 },
    ],
  } as BusinessModuleSchema : businessBase;
  const economyPreview = businessPreview ? buildEconomyViewModel(createSampleGameState(), findWorldDef('border_trade')) : null;
  const survivalPreview = moduleConfig<SurvivalModuleSchema>('stranded_island', 'survival');
  const resourcesPreview = survivalPreview ? buildResourcesViewModel(createSampleGameState(), findWorldDef('stranded_island')) : null;

  const ledger = (
    <div className="game-journey__status-panel">
      <div className="surface-card game-journey__status-card">
        <h4>世界状态</h4>
        <div style={{ fontSize: 13, display: 'grid', gap: 4 }}><span>第三日 · 酉时</span><span>临安城 · 北城门</span><span>微雨</span></div>
      </div>
      <div className="surface-card game-journey__status-card">
        <h4>当前目标</h4>
        <div style={{ fontSize: 14, color: 'var(--accent)' }}>查明东市更夫失踪的真相</div>
      </div>
      <div className="surface-card game-journey__status-card">
        <h4>生存状态</h4>
        {[['血量', 82, 'var(--danger)'], ['体力', 54, 'var(--warning)']].map(([label, value, color]) => (
          <div key={label as string} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 32, color: 'var(--text-muted)' }}>{label}</span>
            <div className="game-status-meter"><div style={{ width: `${value}%`, height: '100%', backgroundColor: color as string, borderRadius: 999 }} /></div>
            <span style={{ width: 48, textAlign: 'right' }}>{value}/100</span>
          </div>
        ))}
      </div>
    </div>
  );

  const [sample] = useState(() => createSampleGameState());
  const [varMgr] = useState(() => new VariableManager(sample));
  const livePanel = (panel: OverlayPanel) => {
    switch (panel) {
      case 'profile': return <ProfilePanel gameState={sample} hasBusinessModule={false} variableManager={varMgr} />;
      case 'characters': return <CharacterGrid gameState={sample} worldId={params.get('world') ?? 'wuxia_world'} />;
      case 'tasks': return <TaskPanel gameState={sample} />;
      case 'notebook': return <NotebookPanel gameState={sample} />;
      case 'worldbook': return <WorldBookPanel worldId={params.get('world') ?? 'wuxia_world'} />;
      case 'dynamics': return <WorldDynamicsPanel gameState={sample} onManualTick={async () => undefined} isSimulating={false} />;
      case 'variables': return <VariableSnapshotPanel messages={SAMPLE} varMgr={varMgr} onRollbackToSnapshot={noop} onPrepareStateJSON={() => null} onCommitState={() => true} />;
      case 'profession': {
        const mod = findWorldDef('wuxia_world')?.modules?.find(m => m.moduleId === 'profession');
        const cfg = mod?.moduleConfig ? resolveProfessionBinding(mod.moduleConfig) : undefined;
        const prof = cfg?.professions[0];
        const first = prof?.abilities[0];
        const withProf = prof ? { ...sample, 玩家: { ...sample.玩家, 能力系统: { ...sample.玩家.能力系统, 职业状态: { 职业ID: prof.id, 职业名称: prof.name, 职业等级: 2, 能力点: 1, 已解锁能力: first ? { [first.id]: { 名称: first.name, 类型: first.type, 等级: 1, 解锁轮次: 1 } } : {} } } } } as typeof sample : sample;
        return <ProfessionTreePanel config={cfg} gameState={withProf} currentTick={0} onUnlock={noop} onUse={noop} />;
      }
      case 'memory': return <MemorySettingsOverlay visible onClose={noop} onSave={noop} messages={SAMPLE} mode="inline" />;
      case 'modules': return <EventConfigPanel worldDef={findWorldDef(params.get('world') ?? 'wuxia_world')} />;
      default: return null;
    }
  };
  const panelBody = (panel: OverlayPanel) => panel && livePanel(panel) ? <JourneyDossierContent panel={normalizeDossierPanel(panel)}>{livePanel(panel)}</JourneyDossierContent> : panel ? (
    <div style={{ display: 'grid', gap: 12, fontSize: 14, lineHeight: 1.7 }}>
      <p style={{ margin: 0 }}>此处是「{DOSSIER_META[normalizeDossierPanel(panel)].title}」卷宗的内容区域。</p>
      <div className="surface-card" style={{ padding: 14 }}>示例条目 · 卷宗面板内容由各业务组件渲染。</div>
    </div>
  ) : null;
  const meta = (panel: OverlayPanel) => panel ? DOSSIER_META[normalizeDossierPanel(panel)] : undefined;

  const chat = (
    <ChatPanel
      messages={params.get('empty') ? [] : SAMPLE}
      isGenerating={params.get('gen') === '1'}
      pipelineStatus={params.get('pipeline') ? samplePipeline() : null}
      worldName="武侠世界"
      worldSceneUrl="/art/theme/worlds/wuxia_world-scene.png"
      onSend={async () => ({ accepted: true }) as never}
      onCancel={noop} onDelete={noop} onEdit={noop} onResend={noop} onResendFromHere={noop}
    />
  );

  return (
    <UISettingsProvider>
      {isMobile ? (
        <MobileLayout
          worldName="武侠世界" isFullscreen={false} onToggleFullscreen={noop}
          showLeftOverlay={leftOpen} onShowLeftOverlay={setLeftOpen}
          mobileNavItems={buildMobileNavItems({ navigate: noop, setShowLeftOverlay: setLeftOpen, setMobileActivePanel: setMobilePanel })}
          showRightOverlay={rightOpen} onShowRightOverlay={setRightOpen}
          mobileActivePanel={mobilePanel} onMobileActivePanelChange={setMobilePanel}
          panelTitle={meta(mobilePanel)?.title ?? ''} panelSubtitle={meta(mobilePanel)?.subtitle} panelIcon={meta(mobilePanel)?.icon}
          panelContent={panelBody(mobilePanel)}
          rightPanel={params.get('ledger') === 'mock' ? ledger : <RightPanel gameState={sample} worldId={params.get('world') ?? 'wuxia_world'} />}
        >{chat}</MobileLayout>
      ) : (
        <DesktopLayout
          navButtons={navButtons} overlay={overlay} onOverlayChange={setOverlay} onNavigate={noop}
          isFullscreen={false} onToggleFullscreen={noop}
          drawerTitle={meta(overlay)?.title ?? ''} drawerSubtitle={meta(overlay)?.subtitle} drawerIcon={meta(overlay)?.icon}
          drawerContent={panelBody(overlay)}
          rightCollapsed={rightCollapsed} onToggleRightPanel={() => setRightCollapsed(value => !value)}
          rightPanel={params.get('ledger') === 'mock' ? ledger : <RightPanel gameState={sample} worldId={params.get('world') ?? 'wuxia_world'} />}
        >{chat}</DesktopLayout>
      )}
      {params.get('overlay') === 'business' && economyPreview && <EconomyLedger open view={economyPreview} onClose={noop} />}
      {params.get('overlay') === 'survival' && resourcesPreview && <ResourcesLedger open view={resourcesPreview} onGather={noop} onCraft={noop} onClose={noop} />}
    </UISettingsProvider>
  );
}
