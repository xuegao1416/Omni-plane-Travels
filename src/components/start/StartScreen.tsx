import { useEffect,useRef,useState } from 'react';
import { useStartScreen } from './useStartScreen';
import MainMenuView from './MainMenuView';
import WizardShell from './WizardShell';
import CustomModuleAgentWorkspace from './CustomModuleAgentWorkspace';
import WorldHallView from './WorldHallView';
import WorldEditorForm from './WorldEditorForm';
import Starfield from './orrery/Starfield';
import DawnScene from '../../ui/dawn/DawnScene';
import { useUITheme } from '../../hooks/useUITheme';
import { reportDepth } from '../../modules/playTracker';
import { WORLD_ARTWORK_PRESETS } from '../../data/worldArtwork';

type EntryPhase = 'home' | 'warp' | 'hall';

const RETURN_TARGET_KEY = 'omni.start.returnTarget';
const WARP_MS = 1700;

export default function StartScreen() {
  const h = useStartScreen();
  const [customModuleOpen, setCustomModuleOpen] = useState(false);
  const [entryPhase, setEntryPhase] = useState<EntryPhase>(() => {
    const returnedFromHall = typeof window !== 'undefined' && sessionStorage.getItem(RETURN_TARGET_KEY) === 'hall';
    // 设置/事件等页面会先在返回前挂载一个底层 StartScreen；此时不能消费标记，
    // 否则保存设置后重新挂载 StartScreen 会丢失大厅入口状态并回到首页。
    return returnedFromHall || h.state.selectedWorld !== 'default' ? 'hall' : 'home';
  });
  const warpTimer = useRef<number | null>(null);
  const [arrival, setArrival] = useState(false);

  // 只在真正回到 StartScreen 后消费返回标记；设置页底层的 StartScreen 仍处于 settings 路由。
  useEffect(() => {
    if (h.state.currentScreen === 'start' && sessionStorage.getItem(RETURN_TARGET_KEY) === 'hall') {
      sessionStorage.removeItem(RETURN_TARGET_KEY);
    }
  }, [h.state.currentScreen]);

  // 记录大厅与创建角色流程的匿名到达深度。
  useEffect(() => {
    if (entryPhase === 'hall' && h.view === 'main') reportDepth('lobby');
    else if (h.view === 'wizard') reportDepth('wizard');
  }, [entryPhase, h.view]);

  useEffect(() => () => { if (warpTimer.current !== null) window.clearTimeout(warpTimer.current); }, []);
  // 到达动画的类名必须一直保留到离开大厅：中途摘掉会让大厅换回普通入场动画并从头重播。
  useEffect(() => { if (entryPhase !== 'hall') setArrival(false); }, [entryPhase]);

  // 大厅的六张世界图各 2~3MB；若等大厅挂载再解码，会正好卡在穿梭落地的那几帧。
  // 停在首页时就提前解码好，进入大厅时直接用缓存。
  useEffect(() => {
    if (entryPhase !== 'home') return;
    const images = WORLD_ARTWORK_PRESETS.map(preset => {
      const image = new Image();
      image.decoding = 'async';
      image.src = preset.src;
      image.decode?.().catch(() => undefined);
      return image;
    });
    return () => { images.length = 0; };
  }, [entryPhase]);

  const enterHall = () => {
    if (entryPhase !== 'home') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setEntryPhase('hall'); return; }
    setEntryPhase('warp');
    warpTimer.current = window.setTimeout(() => {
      setEntryPhase('hall');
      warpTimer.current = null;
      setArrival(true);
    }, WARP_MS);
  };
  const enterCharacterCreation = async () => {
    if (h.hasCreationDraft && !await h.confirmReplaceCreationDraft()) return;
    h.resetForNewJourney();
    h.setView('wizard');
    setEntryPhase('home');
  };
  const resumeCharacterCreation = () => {
    h.resumeCreationDraft();
    setEntryPhase('home');
  };
  const leaveHallTo = (screen: 'events' | 'settings' | 'user-center') => {
    sessionStorage.setItem(RETURN_TARGET_KEY, 'hall');
    h.navigate(screen);
  };

  const onEntry = h.view === 'main';
  const uiTheme = useUITheme();

  return (
    <>
      {onEntry && (
        <div className={`pl-entry-root is-${entryPhase}`}>
          {uiTheme === 'dawn' ? <DawnScene phase={entryPhase} /> : <Starfield warp={entryPhase === 'warp' ? 1 : 0} spin={entryPhase === 'hall' ? 0.5 : 0.9} />}
          {entryPhase === 'warp' && <div className="pl-entry-flash" aria-hidden="true" />}
          {entryPhase !== 'hall' ? (
            <MainMenuView
              onStartWizard={enterHall}
              onResumeCreation={h.hasCreationDraft ? resumeCharacterCreation : undefined}
              title={h.t('start.title')}
              subtitle={h.t('start.subtitle')}
              departing={entryPhase === 'warp'}
            />
          ) : (
            <WorldHallView
              arrival={arrival}
              allWorlds={h.allWorlds}
              allSaves={h.allSaves}
              currentSaveId={h.currentSaveId}
              selectedWorld={h.selectedWorld}
              setSelectedWorld={h.setSelectedWorld}
              onBackToHome={() => setEntryPhase('home')}
              onStartWizard={enterCharacterCreation}
              creationDraftName={h.personalInfo.name}
              onResumeCreation={h.hasCreationDraft ? resumeCharacterCreation : undefined}
              onOpenEvents={() => leaveHallTo('events')}
              onOpenCustomModules={() => setCustomModuleOpen(true)}
              onOpenSettings={() => leaveHallTo('settings')}
              onOpenUserCenter={() => leaveHallTo('user-center')}
              onOpenEditor={(world, step = 1, workspace) => { h.setEditingWorld(world); h.setWorldEditorInitialStep(step); h.setWorldEditorWorkspace(workspace); h.setWorldEditorOpen(true); }}
              onDeleteWorld={h.handleDeleteWorld}
              onImportWorld={h.handleImportWorld}
              onLoadSave={h.handleLoadSave}
              onDeleteSave={h.handleDeleteSave}
              onImportSave={h.handleImportSave}
              onExportSave={h.handleExportSave}
            />
          )}
        </div>
      )}

      {h.view === 'wizard' && (
        <WizardShell
          step={h.step} setStep={h.setStep}
          onBackToMenu={() => { h.setView('main'); setEntryPhase('hall'); }}
          title={h.t('start.title')} subtitle={h.t('start.subtitle')}
          selectedWorld={h.selectedWorld}
          allWorlds={h.allWorlds} createdWorlds={h.createdWorlds} worldEntry={h.worldEntry}
          personalInfo={h.personalInfo} setPersonalInfo={h.setPersonalInfo}
          isFilling={h.isFilling} fillElapsed={h.fillElapsed} onAiFill={h.handleAiFill} onCancelFill={h.cancelFill}
          segments={h.segments} setSegments={h.setSegments}
          isGenerating={h.isGenerating} regeneratingId={h.regeneratingId}
          includeAgeStages={h.includeAgeStages} setIncludeAgeStages={h.setIncludeAgeStages}
          hasApiConfig={!!h.apiConfig}
          onGenerateAll={h.handleGenerateAll} onRegenerateSegment={h.handleRegenerateSegment}
          onLoadPreset={h.handleLoadPreset}
          onStartGame={h.handleStartGame}
          isCreatingJourney={h.isCreatingJourney} onCancelCreation={h.cancelJourneyCreation}
          onCancelGeneration={h.cancelHistoryGeneration}
          draftWarning={h.draftWarning} onRetryDraftSave={h.retryDraftSave}
          onSaveWorld={h.handleSaveWorld}
          apiConfig={h.apiConfig}
        />
      )}

      {customModuleOpen && <CustomModuleAgentWorkspace onClose={() => setCustomModuleOpen(false)} />}
      {h.worldEditorOpen && (
        <WorldEditorForm
          initialWorld={h.editingWorld}
          initialStep={h.worldEditorInitialStep}
          initialWorkspace={h.worldEditorWorkspace}
          onSave={h.handleSaveWorld}
          onCancel={h.handleCancelWorldEditor}
          apiConfig={h.apiConfig}
        />
      )}
      {h.DialogUI}
    </>
  );
}
