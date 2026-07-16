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
import type { WorldSystemData, DiceRoll, BusinessModuleSchema, WorldDynamicsConfig, PeriodicRule, ModuleEffects, EventRule, RuleFile } from '../../modules/schema';
import { useSaveStore } from '../../stores/saveStore';
import { eventWorldEvolution } from '../../modules/eventIntegration';
import { getWebEvent } from '../../modules/eventDb';
import { installWorldEventPacks, getWebEnabledEventIds } from '../../modules/webEventStore';
import CardOverlay from '../event/CardOverlay';
import EventConfigPanel from '../event/EventConfigPanel';
import type { OverlayPanel } from './gameScreen/types';
import { navButtons, buildMobileNavItems } from './gameScreen/navConfig';
import DesktopLayout from './gameScreen/DesktopLayout';
import MobileLayout from './gameScreen/MobileLayout';
import { useSimulation } from './gameScreen/hooks/useSimulation';
import { useSurvivalCraft } from './gameScreen/hooks/useSurvivalCraft';
import { useSurvivalSettlement } from './gameScreen/hooks/useSurvivalSettlement';
import { useBusinessSettlement } from './gameScreen/hooks/useBusinessSettlement';
import { normalizeAssetStatus } from './panels/businessOverlay/utils';

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

  // ── 事件包注册（二级开关：sessionActivePacks 优先，否则用全局已启用列表） ──
  const sessionActivePacks = useSaveStore(s => s.sessionActivePacks);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. 安装世界关联的事件包进 IndexedDB（幂等，已存在跳过）
      if (worldDef) {
        try {
          await installWorldEventPacks(worldDef);
        } catch (e) {
          console.warn('[事件包] 世界事件包安装失败（已跳过）:', e);
        }
      }
      if (cancelled) return;

      // 2. 兼容旧自定义世界：moduleConfig.periodicEvents → 临时注册
      const hasWorldPacks = (worldDef?.eventPacks?.length ?? 0) > 0;
      if (!hasWorldPacks) {
        const legacy = (worldDef?.modules?.find(m => m.moduleId === 'simulation' && m.enabled)?.moduleConfig as Record<string, unknown> | undefined)?.periodicEvents as Array<Record<string, unknown>> | undefined;
        if (legacy && legacy.length > 0) {
          const periodicRules: PeriodicRule[] = legacy.map((p) => ({
            id: String(p.id ?? `legacy_${Math.random().toString(36).slice(2)}`),
            name: typeof p.name === 'string' ? p.name : undefined,
            intervalTicks: Number(p.intervalTicks ?? 1),
            offsetTicks: typeof p.offsetTicks === 'number' ? p.offsetTicks : undefined,
            effects: (p.effects as ModuleEffects) ?? {},
            description: typeof p.description === 'string' ? p.description : undefined,
            narrateToAI: typeof p.narrateToAI === 'boolean' ? p.narrateToAI : undefined,
          }));
          const savedRuntime0 = gameState.simulationRuntime?.eventRuntimes?.['world:periodic'];
          eventWorldEvolution.register({
            eventPackId: 'world:periodic',
            rules: [],
            periodicRules,
            permissions: ['modify_world_state'],
            runtime: savedRuntime0 ?? { onceFired: {}, cooldownRemaining: {} },
            displayName: '世界周期事件（自定义）',
            source: 'world',
          });
        }
      }

      // 3. 确定本局要注册的事件包列表（二级开关优先，否则用全局已启用列表）
      let enabledIds: string[];
      if (sessionActivePacks !== undefined) {
        enabledIds = sessionActivePacks;
      } else {
        try {
          enabledIds = await getWebEnabledEventIds();
        } catch {
          enabledIds = [];
        }
      }
      if (cancelled) return;

      // 防残留：先清空再按当前绑定注册
      eventWorldEvolution.clear();

      // 重新注册旧自定义世界的周期事件（上面 clear 了）
      if (!hasWorldPacks) {
        const legacy = (worldDef?.modules?.find(m => m.moduleId === 'simulation' && m.enabled)?.moduleConfig as Record<string, unknown> | undefined)?.periodicEvents as Array<Record<string, unknown>> | undefined;
        if (legacy && legacy.length > 0) {
          const periodicRules: PeriodicRule[] = legacy.map((p) => ({
            id: String(p.id ?? `legacy_${Math.random().toString(36).slice(2)}`),
            name: typeof p.name === 'string' ? p.name : undefined,
            intervalTicks: Number(p.intervalTicks ?? 1),
            offsetTicks: typeof p.offsetTicks === 'number' ? p.offsetTicks : undefined,
            effects: (p.effects as ModuleEffects) ?? {},
            description: typeof p.description === 'string' ? p.description : undefined,
            narrateToAI: typeof p.narrateToAI === 'boolean' ? p.narrateToAI : undefined,
          }));
          const savedRuntime0b = gameState.simulationRuntime?.eventRuntimes?.['world:periodic'];
          eventWorldEvolution.register({
            eventPackId: 'world:periodic',
            rules: [],
            periodicRules,
            permissions: ['modify_world_state'],
            runtime: savedRuntime0b ?? { onceFired: {}, cooldownRemaining: {} },
            displayName: '世界周期事件（自定义）',
            source: 'world',
          });
        }
      }

      for (const id of enabledIds) {
        if (cancelled) break;
        try {
          const rec = await getWebEvent(id).catch(() => undefined);
          if (!rec) continue;
          const rules: EventRule[] = [];
          const periodicRules: PeriodicRule[] = [];
          const raw = rec.files['schema/rules.json'];
          if (typeof raw === 'string') {
            const rf = JSON.parse(raw) as RuleFile;
            if (rf.rules) rules.push(...rf.rules);
            if (rf.periodicRules) periodicRules.push(...rf.periodicRules);
          }
          if (rules.length > 0 || periodicRules.length > 0) {
            const savedRuntime = gameState.simulationRuntime?.eventRuntimes?.[id];
            eventWorldEvolution.register({
              eventPackId: id,
              rules,
              periodicRules,
              permissions: rec.manifest.permissions ?? [],
              runtime: savedRuntime ?? { onceFired: {}, cooldownRemaining: {} },
              source: rec.builtin ? 'world' : 'mod',
            });
          }
        } catch (e) {
          console.warn(`[事件包] 规则注册失败（已跳过）: ${id}`, e);
        }
      }
    })();
    return () => {
      cancelled = true;
      eventWorldEvolution.clear();
    };
  }, [worldDef?.id, sessionActivePacks]);
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
  // ── Simulation rules change handler ──
  const handleSimulationRulesChange = useCallback((rules: WorldDynamicsConfig) => {
    if (!worldDef) return;
    // 更新世界定义中的 simulation 模块配置
    const simModIndex = worldDef.modules?.findIndex(m => m.moduleId === 'simulation' && m.enabled);
    if (simModIndex !== undefined && simModIndex >= 0 && worldDef.modules) {
      worldDef.modules[simModIndex].moduleConfig = rules as unknown as Record<string, unknown>;
      // 触发重新渲染
      bumpVersion();
    }
  }, [worldDef, bumpVersion]);
  // ── Panel rendering (shared between desktop and mobile) ──
  const renderPanelContent = (panel: OverlayPanel, onClose: () => void) => {
    switch (panel) {
      case 'profile': return <ProfilePanel gameState={gameState} hasBusinessModule={hasBusinessModule} />;
      case 'characters': return <CharacterGrid gameState={gameState} worldId={state.selectedWorld} onUpdateChronicles={handleUpdateChronicles} onMergeChronicles={handleMergeChronicles} />;
      case 'notebook': return <NotebookPanel gameState={gameState} />;
      case 'variables': return <VariableSnapshotPanel messages={engine.messages} varMgr={engine.variableManager} onRestoreSnapshot={(snap) => { engine.variableManager.restoreSnapshot(snap); bumpVersion(); }} onSave={bumpVersion} />;
      case 'worldbook': return <WorldBookPanel worldId={state.selectedWorld} engine={engine} />;
      case 'memory': return <MemorySettingsOverlay visible={true} onClose={onClose} onSave={() => {}} mode="inline" />;
      case 'dynamics': return <WorldDynamicsPanel gameState={gameState} onManualTick={handleManualTick} isSimulating={isSimulating} worldDef={worldDef} onRulesChange={handleSimulationRulesChange} />;
      case 'modules': return <EventConfigPanel onClose={onClose} worldDef={worldDef} />;
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
  const bizData = (() => {
    const bizConfig = worldDef?.modules?.find(m => m.moduleId === 'business' && m.enabled)?.moduleConfig as BusinessModuleSchema | undefined;
    if (!bizConfig) return undefined;
    // 优先从当前渲染的 gameState 读取，其次从 VariableManager 实时读取（防止渲染间隙丢失更新）
    const runtimeBiz = gameState.玩家?.经营资产
      ?? (engine.variableManager.getVar('玩家.经营资产') as { 资金: number; 资产列表: any[]; 交易日志?: any[] } | undefined);
    if (!runtimeBiz) return bizConfig;
    return {
      ...bizConfig,
      funds: runtimeBiz.资金,
      assets: (runtimeBiz.资产列表 ?? []).map(a => {
        // AI 漏填收益字段时，给合理默认值
        const hasIncome = a.基础收益 || a.每级收益 || a.维护费;
        return {
          id: a.id || `asset-${Math.random().toString(36).slice(2, 8)}`,
          name: a.名称 || a.类型 || a.id || '未命名资产',
          type: a.类型 || '',
          level: a.等级 ?? 1,
          maxLevel: a.最高等级 ?? 3,
          description: a.描述 || '',
          status: normalizeAssetStatus(a.状态),
          income: {
            base: a.基础收益 ?? (hasIncome ? 0 : 5),
            perLevel: a.每级收益 ?? (hasIncome ? 0 : 3),
            cycle: bizConfig.cycleName || '天',
          },
          maintenance: a.维护费 ?? (hasIncome ? 0 : 2),
        };
      }),
      transactionLog: (runtimeBiz.交易日志 || []).map((t, i) => ({
        cycle: i + 1, type: t.类型, description: t.描述, amount: t.金额,
      })),
    } as BusinessModuleSchema;
  })();

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
      businessData={bizData}
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
      <CardOverlay gameState={gameState} />
      {notification && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 20px', fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 200, animation: 'fadeIn 0.2s ease' }}>
          {notification}
        </div>
      )}
    </>
  );
}
