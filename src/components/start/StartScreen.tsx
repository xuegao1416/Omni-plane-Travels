import { useStartScreen } from './useStartScreen';
import MainMenuView from './MainMenuView';
import SavesView from './SavesView';
import WizardShell from './WizardShell';

export default function StartScreen() {
  const h = useStartScreen();

  const content = (() => {
    if (h.view === 'main') {
      return (
        <MainMenuView
          allSaves={h.allSaves}
          onStartWizard={() => { h.setView('wizard'); h.setStep(1); }}
          onViewSaves={() => h.setView('saves')}
          onSettings={() => h.navigate('settings')}
          onOpenEvents={() => h.navigate('events')}
          onOpenUserCenter={() => h.navigate('user-center')}
          title={h.t('start.title')}
          subtitle={h.t('start.subtitle')}
          beginLabel={h.t('start.begin')}
          settingsLabel={h.t('start.settings')}
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
        onBackToMenu={() => { h.setView('main'); h.setStep(1); }}
        title={h.t('start.title')} subtitle={h.t('start.subtitle')} t={h.t}
        selectedWorld={h.selectedWorld} setSelectedWorld={h.setSelectedWorld}
        allWorlds={h.allWorlds} createdWorlds={h.createdWorlds} worldEntry={h.worldEntry}
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
        worldEditorOpen={h.worldEditorOpen} editingWorld={h.editingWorld}
        onSaveWorld={h.handleSaveWorld} onDeleteWorld={h.handleDeleteWorld} onCancelWorldEditor={h.handleCancelWorldEditor}
        onOpenEditor={(w) => { h.setEditingWorld(w); h.setWorldEditorOpen(true); }}
        onImportWorld={h.handleImportWorld}
        apiConfig={h.apiConfig} settings={h.settings}
      />
    );
  })();

  return (
    <>
      {content}
      {h.DialogUI}
    </>
  );
}
