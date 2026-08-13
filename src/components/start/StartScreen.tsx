import { useStartScreen } from './useStartScreen';
import MainMenuView from './MainMenuView';
import SavesView from './SavesView';
import WizardShell from './WizardShell';
import CustomModuleAgentWorkspace from './CustomModuleAgentWorkspace';
import EntryTransition from './EntryTransition';
import WorldHallView from './WorldHallView';
import WorldEditorForm from './WorldEditorForm';
import { useState, useEffect, useRef } from 'react';
import { reportDepth } from '../../modules/playTracker';
import { Volume2, VolumeX } from 'lucide-react';

/** 大厅背景音乐 — 仅在 WorldHallView 可见时播放，首页/过场/向导/游戏过程不播放 */
function HallMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(() => {
    return typeof window !== 'undefined' && localStorage.getItem('omni.hall.musicMuted') === 'true';
  });

  useEffect(() => {
    const audio = new Audio('/audio/omni-hall-dawn-original.mp3');
    audio.loop = true;
    audio.volume = muted ? 0 : 0.45;
    audio.play().catch(() => { /* autoplay blocked — user gesture needed */ });
    audioRef.current = audio;
    return () => { audio.pause(); audio.src = ''; };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : 0.45;
    }
    localStorage.setItem('omni.hall.musicMuted', String(muted));
  }, [muted]);

  return (
    <button
      onClick={() => setMuted(m => !m)}
      aria-label={muted ? '取消静音' : '静音'}
      title={muted ? '大厅音乐已静音' : '大厅音乐播放中'}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 100,
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        border: '1px solid var(--creation-border, rgba(122,166,153,.38))',
        background: 'var(--creation-surface, rgba(248,252,242,.86))',
        color: 'var(--creation-text, #304d45)',
        fontSize: '16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 3px 10px rgba(0,0,0,.1)',
        opacity: 0.7,
        transition: 'opacity .2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; }}
    >
      {muted ? <VolumeX size={17} strokeWidth={1.7} aria-hidden="true" /> : <Volume2 size={17} strokeWidth={1.7} aria-hidden="true" />}
    </button>
  );
}

export default function StartScreen() {
  const h = useStartScreen();
  const [customModuleOpen, setCustomModuleOpen] = useState(false);
  const [entryPhase, setEntryPhase] = useState<'home' | 'transition' | 'hall'>(() => {
    const returnedFromHall = typeof window !== 'undefined' && sessionStorage.getItem('omni.start.returnTarget') === 'hall';
    if (returnedFromHall) sessionStorage.removeItem('omni.start.returnTarget');
    return returnedFromHall || h.state.selectedWorld !== 'default' ? 'hall' : 'home';
  });

  // 记录大厅与创建角色流程的匿名到达深度。
  useEffect(() => {
    if (entryPhase === 'hall' && h.view === 'main') reportDepth('lobby');
    else if (h.view === 'wizard') reportDepth('wizard');
    // 存档页与首页不提高深度。
  }, [entryPhase, h.view]);

  const enterHall = () => setEntryPhase('transition');
  const enterCharacterCreation = () => {
    h.setView('wizard');
    h.setStep(1);
    setEntryPhase('home');
  };

  const content = (() => {
    if (h.view === 'main') {
      if (entryPhase === 'transition') return <EntryTransition onComplete={() => setEntryPhase('hall')} />;
      if (entryPhase === 'hall') {
        return (
          <WorldHallView
            allWorlds={h.allWorlds}
            allSaves={h.allSaves}
            currentSaveId={h.currentSaveId}
            selectedWorld={h.selectedWorld}
            setSelectedWorld={h.setSelectedWorld}
            onBackToHome={() => setEntryPhase('home')}
            onStartWizard={enterCharacterCreation}
            onOpenEvents={() => { sessionStorage.setItem('omni.start.returnTarget', 'hall'); h.navigate('events'); }}
            onOpenCustomModules={() => setCustomModuleOpen(true)}
            onOpenSettings={() => { sessionStorage.setItem('omni.start.returnTarget', 'hall'); h.navigate('settings'); }}
            onOpenUserCenter={() => { sessionStorage.setItem('omni.start.returnTarget', 'hall'); h.navigate('user-center'); }}
              onOpenEditor={(world, step = 1) => { h.setEditingWorld(world); h.setWorldEditorInitialStep(step); h.setWorldEditorOpen(true); }}
            onDeleteWorld={h.handleDeleteWorld}
            onImportWorld={h.handleImportWorld}
            onLoadSave={h.handleLoadSave}
            onDeleteSave={h.handleDeleteSave}
            onImportSave={h.handleImportSave}
            onExportSave={h.handleExportSave}
          />
        );
      }
      return (
        <MainMenuView
          onStartWizard={enterHall}
          title={h.t('start.title')}
          subtitle={h.t('start.subtitle')}
        />
      );
    }

    if (h.view === 'saves') {
      return (
        <SavesView
          allSaves={h.allSaves}
          locale={h.locale}
          currentSaveId={h.currentSaveId}
          onBack={() => h.setView('main')}
          onLoadSave={h.handleLoadSave}
          onDeleteSave={h.handleDeleteSave}
          onForceDeleteSave={h.handleForceDeleteSave}
          onRenameSave={h.handleRenameSave}
          onImportSave={h.handleImportSave}
          onExportSave={h.handleExportSave}
        />
      );
    }

    return (
      <WizardShell
        step={h.step} setStep={h.setStep}
        onBackToMenu={() => { h.setView('main'); h.setStep(1); setEntryPhase('hall'); }}
        title={h.t('start.title')} subtitle={h.t('start.subtitle')} t={h.t}
        selectedWorld={h.selectedWorld}
        allWorlds={h.allWorlds} worldEntry={h.worldEntry}
        personalInfo={h.personalInfo} setPersonalInfo={h.setPersonalInfo}
        isFilling={h.isFilling} fillElapsed={h.fillElapsed} onAiFill={h.handleAiFill} onCancelFill={h.cancelFill}
        segments={h.segments} setSegments={h.setSegments}
        isGenerating={h.isGenerating} regeneratingId={h.regeneratingId}
        includeAgeStages={h.includeAgeStages} setIncludeAgeStages={h.setIncludeAgeStages}
        hasApiConfig={!!h.apiConfig}
        onGenerateAll={h.handleGenerateAll} onRegenerateSegment={h.handleRegenerateSegment}
        onLoadPreset={h.handleLoadPreset}
        buildInitialState={h.buildInitialState}
        onStartGame={h.handleStartGame}
        apiConfig={h.apiConfig} settings={h.settings}
      />
    );
  })();

  return (
    <>
      {content}
      {entryPhase === 'hall' && h.view === 'main' && <HallMusic />}
      {customModuleOpen && <CustomModuleAgentWorkspace onClose={() => setCustomModuleOpen(false)} />}
      {h.worldEditorOpen && (
        <WorldEditorForm
          initialWorld={h.editingWorld}
            initialStep={h.worldEditorInitialStep}
          onSave={h.handleSaveWorld}
          onCancel={h.handleCancelWorldEditor}
          apiConfig={h.apiConfig}
          settings={h.settings}
          presentationMode="world-weave"
        />
      )}
      {h.DialogUI}
    </>
  );
}
