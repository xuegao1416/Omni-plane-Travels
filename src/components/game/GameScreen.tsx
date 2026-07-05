import { useState, useEffect, useCallback, useMemo } from 'react';
import { useGame } from '../../context/GameContext';
import { useUISettings } from '../../context/UISettingsContext';
import { useConfigStore } from '../../stores/configStore';
import { useMediaQuery } from '../../hooks/useIsMobile';
import ChatPanel from './chat/ChatPanel';
import ProfilePanel from './panels/ProfilePanel';
import CharacterGrid from './panels/CharacterGrid';
import NotebookPanel from './panels/NotebookPanel';
import VariableSnapshotPanel from './panels/VariableSnapshotPanel';
import WorldBookPanel from './panels/WorldBookPanel';
import RightPanel from './panels/RightPanel';
import BusinessOverlay from './panels/BusinessOverlay';
import SurvivalOverlay from './panels/SurvivalOverlay';
import { MemorySettingsOverlay } from '../settings/memory/MemorySettingsOverlay';
import WorldDynamicsPanel from './panels/WorldDynamicsPanel';
import { findWorldDef } from '../../data/worldLoader';
import { eventBus, EVENTS } from '../../engine/eventBus';
import type { WorldSystemData, DiceRoll, BusinessModuleSchema } from '../../modules/schema';
import type { OverlayPanel } from './gameScreen/types';
import { navButtons, buildMobileNavItems } from './gameScreen/navConfig';
import DesktopLayout from './gameScreen/DesktopLayout';
import MobileLayout from './gameScreen/MobileLayout';
import { useSimulation } from './gameScreen/hooks/useSimulation';
import { useSurvivalCraft } from './gameScreen/hooks/useSurvivalCraft';
import { useSurvivalSettlement } from './gameScreen/hooks/useSurvivalSettlement';
import { useBusinessSettlement } from './gameScreen/hooks/useBusinessSettlement';

export default function GameScreen() {
  const { state, navigate, engine } = useGame();
  const { t } = useUISettings();
  const isMobile = useMediaQuery('(max-width: 900px)');

  // ── State ──
  const [overlay, setOverlay] = useState<OverlayPanel>(null);
  const [businessOverlayOpen, setBusinessOverlayOpen] = useState(false);
  const [survivalOverlayOpen, setSurvivalOverlayOpen] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLeftOverlay, setShowLeftOverlay] = useState(false);
  const [showRightOverlay, setShowRightOverlay] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<OverlayPanel>(null);
  const [stateVersion, setStateVersion] = useState(0);
  const [notification, setNotification] = useState<string | null>(null);
  const [lastDiceRoll, setLastDiceRoll] = useState<DiceRoll | null>(null);
  // ── Fullscreen ──
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {}
  }, []);
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  // 窄视口自动折叠右侧面板
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => { if (e.matches) setRightCollapsed(true); };
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Derived data ──
  const gameState = engine.variableManager.getState();
  const apiConfig = useConfigStore(s => s.apiConfig);
  const worldDef = useMemo(() => {
    try { return findWorldDef(state.selectedWorld); } catch { return undefined; }
  }, [state.selectedWorld]);
  const hasBusinessModule = !!worldDef?.modules?.some(m => m.moduleId === 'business' && m.enabled);
  const hasSurvivalModule = !!worldDef?.modules?.some(m => m.moduleId === 'survival' && m.enabled);
  const worldSystem = useMemo((): WorldSystemData => {
    if (!worldDef?.modules) return {};
    const keyMap: Record<string, string> = {
      stat: '数值属性', progression: '成长体系', survival: '生存资源',
      business: '经营资产', dice: '骰子检定', talent: '天赋体系',
    };
    const result: WorldSystemData = {};
    for (const mod of worldDef.modules) {
      if (!mod.enabled) continue;
      const key = keyMap[mod.moduleId];
      if (key && mod.moduleConfig) (result as any)[key] = mod.moduleConfig;
    }
    return result;
  }, [worldDef]);
  // ── Extracted hooks ──
  const bumpVersion = useCallback(() => setStateVersion(v => v + 1), []);
  const { isSimulating, handleManualTick } = useSimulation(engine, worldDef, apiConfig);
  const {
    runtimeRecipes, isGeneratingRecipe,
    handleSurvivalCraft, handleSurvivalGenerateRecipe, handleSurvivalDeleteRecipe,
  } = useSurvivalCraft(engine, apiConfig, worldDef, setNotification, bumpVersion);
  useBusinessSettlement(engine, worldDef, bumpVersion);
  const { getChangeLog: getSurvivalChangeLog, clearChangeLog: clearSurvivalChangeLog } = useSurvivalSettlement(engine, worldDef, bumpVersion);
  // ── Event effects ──
  useEffect(() => {
    const onUpdate = () => setStateVersion(v => v + 1);
    const onFail = () => { setNotification('变量提取失败，游戏状态可能未更新'); setTimeout(() => setNotification(null), 4000); };
    eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, onUpdate);
    eventBus.on(EVENTS.VARIABLE_EXTRACTION_FAILED, onFail);
    return () => { eventBus.off(EVENTS.VARIABLE_UPDATE_ENDED, onUpdate); eventBus.off(EVENTS.VARIABLE_EXTRACTION_FAILED, onFail); };
  }, []);
  // ── Callbacks ──
  const handleDiceRoll = useCallback((roll: DiceRoll) => setLastDiceRoll(roll), []);
  const handleUpdateChronicles = useCallback((npcId: string, chronicles: string[]) => {
    const s = engine.variableManager.getState();
    const npc = s.人物档案?.[npcId];
    if (!npc) return;
    (npc as any).人物事迹 = chronicles;
    engine.variableManager.setState(s);
    bumpVersion();
  }, [engine, bumpVersion]);
  const handleMergeChronicles = useCallback(async (npcId: string, startIndex: number, endIndex: number) => {
    if (!apiConfig) return false;
    const ok = await engine.variableManager.mergeNpcChronicles(npcId, startIndex, endIndex, apiConfig);
    if (ok) bumpVersion();
    return ok;
  }, [engine, apiConfig, bumpVersion]);
  // ── Panel rendering (shared between desktop and mobile) ──
  const renderPanelContent = (panel: OverlayPanel, onClose: () => void) => {
    switch (panel) {
      case 'profile': return <ProfilePanel gameState={gameState} hasBusinessModule={hasBusinessModule} />;
      case 'characters': return <CharacterGrid gameState={gameState} worldId={state.selectedWorld} onUpdateChronicles={handleUpdateChronicles} onMergeChronicles={handleMergeChronicles} />;
      case 'notebook': return <NotebookPanel gameState={gameState} />;
      case 'variables': return <VariableSnapshotPanel messages={engine.messages} varMgr={engine.variableManager} onRestoreSnapshot={(snap) => { engine.variableManager.restoreSnapshot(snap); bumpVersion(); }} onSave={bumpVersion} />;
      case 'worldbook': return <WorldBookPanel worldId={state.selectedWorld} engine={engine} />;
      case 'memory': return <MemorySettingsOverlay visible={true} onClose={onClose} onSave={() => {}} mode="inline" />;
      case 'dynamics': return <WorldDynamicsPanel gameState={gameState} onManualTick={handleManualTick} isSimulating={isSimulating} />;
      default: return null;
    }
  };
  const getPanelTitle = (panel: OverlayPanel): string => {
    const btn = navButtons.find(b => b.id === panel);
    return btn ? t(btn.labelKey) : '';
  };
  const mobileNavItems = useMemo(() => buildMobileNavItems({
    navigate, setShowLeftOverlay, setMobileActivePanel,
  }), [navigate]);
  // ── Shared elements ──
  const rightPanelEl = (
    <RightPanel
      gameState={gameState} worldId={state.selectedWorld}
      onSurvivalGenerateRecipe={handleSurvivalGenerateRecipe}
      onSurvivalCraft={handleSurvivalCraft}
      onSurvivalDeleteRecipe={handleSurvivalDeleteRecipe}
      isGeneratingRecipe={isGeneratingRecipe} runtimeRecipes={runtimeRecipes}
      onOpenBusinessOverlay={() => setBusinessOverlayOpen(true)}
      onOpenSurvivalOverlay={() => setSurvivalOverlayOpen(true)}
      survivalChangeLog={getSurvivalChangeLog()}
    />
  );

  const chatPanelEl = (
    <ChatPanel
      messages={engine.messages} isGenerating={engine.isGenerating}
      onSend={engine.sendMessage} onCancel={engine.cancel}
      onDelete={engine.deleteSingleMessage} onEdit={engine.editMessage}
      onResend={engine.resendFromMessage} onResendFromHere={engine.resendFromAssistantMessage}
      pipelineStatus={engine.pipelineStatus} worldSystem={worldSystem}
      onDiceRoll={handleDiceRoll} onRetrySingleStage={engine.retrySingleStage}
    />
  );
  const bizData = (() => {
    const bizConfig = worldDef?.modules?.find(m => m.moduleId === 'business' && m.enabled)?.moduleConfig as BusinessModuleSchema | undefined;
    if (!bizConfig) return undefined;
    const runtimeBiz = gameState.玩家?.经营资产;
    if (!runtimeBiz) return bizConfig;
    return {
      ...bizConfig,
      funds: runtimeBiz.资金,
      assets: runtimeBiz.资产列表.map(a => ({
        id: a.id, name: a.名称, type: a.类型,
        level: a.等级, maxLevel: a.最高等级,
        description: a.描述, status: a.状态,
        income: { base: a.基础收益, perLevel: a.每级收益, cycle: bizConfig.cycleName || '天' },
        maintenance: a.维护费,
      })),
      transactionLog: (runtimeBiz.交易日志 || []).map(t => ({
        cycle: 0, type: t.类型, description: t.描述, amount: t.金额,
      })),
    } as BusinessModuleSchema;
  })();
  // 生存资源数据（供 SurvivalOverlay 使用）
  const survivalData = (() => {
    return worldDef?.modules?.find(m => m.moduleId === 'survival' && m.enabled)?.moduleConfig as import('../../modules/schema').SurvivalModuleSchema | undefined;
  })();
  // ── Render ──
  return (
    <>
      {isMobile ? (
        <MobileLayout
          worldName={worldDef?.name || '世界漫游指南'}
          isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
          showLeftOverlay={showLeftOverlay} onShowLeftOverlay={setShowLeftOverlay}
          mobileNavItems={mobileNavItems} t={t}
          showRightOverlay={showRightOverlay} onShowRightOverlay={setShowRightOverlay}
          mobileActivePanel={mobileActivePanel} onMobileActivePanelChange={setMobileActivePanel}
          panelTitle={getPanelTitle(mobileActivePanel)}
          panelContent={renderPanelContent(mobileActivePanel, () => setMobileActivePanel(null))}
          rightPanel={rightPanelEl}
        >{chatPanelEl}</MobileLayout>
      ) : (
        <DesktopLayout
          navButtons={navButtons} overlay={overlay} onOverlayChange={setOverlay}
          onNavigate={navigate} t={t}
          isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
          drawerTitle={getPanelTitle(overlay)}
          drawerContent={renderPanelContent(overlay, () => setOverlay(null))}
          rightCollapsed={rightCollapsed} onToggleRightPanel={() => setRightCollapsed(c => !c)}
          rightPanel={rightPanelEl}
        >{chatPanelEl}</DesktopLayout>
      )}
      {bizData && <BusinessOverlay open={businessOverlayOpen} data={bizData} onClose={() => setBusinessOverlayOpen(false)} />}
      {survivalData && <SurvivalOverlay
        open={survivalOverlayOpen} data={survivalData}
        runtimeResources={gameState.玩家?.生存资源 as any}
        changeLog={getSurvivalChangeLog()}
        onClose={() => setSurvivalOverlayOpen(false)}
      />}
      {notification && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 20px', fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 200, animation: 'fadeIn 0.2s ease' }}>
          {notification}
        </div>
      )}
    </>
  );
}
