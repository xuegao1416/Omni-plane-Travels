import { useMemo, useState } from 'react';
import type { WorldDef } from '../../data/worldLoader';
import { resolveWorldArtwork } from '../../data/worldArtwork';
import type { WorldBookEntry } from '../../worldbook/index';
import type { PlayerProfile } from '../../storage/db';
import type { GameState } from '../../schema/variables';
import type { HistoryPreset } from '../../storage/templateStore';
import { Check, Sunrise } from 'lucide-react';
import { getAgeStages } from '../../utils/ageStages';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import AmbientParticleLayer from '../shared/dawn/AmbientParticleLayer';
import StepPersonalInfo from './StepPersonalInfo';
import StepCharacterHistory, { buildSegmentDefs } from './StepCharacterHistory';
import StepConfirm from './StepConfirm';
import { EntrySlicedButton } from './EntrySurface';
import PortraitEditor, { getPortraitSource } from './PortraitEditor';
import StepProfessionTalents from './StepProfessionTalents';
import type { ProfessionModuleSchema } from '../../modules/schema';
import { validateProfessionSelection } from '../../gameplay/profession';
import { getCreationStepLayout } from './creationStepLayout';
import { resolveProfessionBinding } from '../../data/professions';
import { isProfessionModuleEnabled } from '../../gameplay/profession/featureGate';
import type { CombatRiskMode } from '../../gameplay/protocols';

const RITUAL_ANCHORS: Record<number, string> = {
  1: '/art/theme/ui-kit/dawn-v4/ritual/identity-mirror-v1.png',
  2: '/art/theme/ui-kit/dawn-v4/ritual/talent-astrolabe-v1.png',
  4: '/art/theme/ui-kit/dawn-v4/ritual/departure-gate-v1.png',
};

interface WizardShellProps {
  step: number;
  setStep: (s: number) => void;
  onBackToMenu: () => void;
  title: string;
  subtitle: string;
  t: (key: string) => string;
  // step props
  selectedWorld: string;
  /** Legacy preview compatibility; world selection is now owned by the hall. */
  setSelectedWorld?: (id: string) => void;
  allWorlds: WorldDef[];
  createdWorlds?: WorldDef[];
  worldEntry: WorldBookEntry | null;
  personalInfo: PlayerProfile;
  setPersonalInfo: (info: PlayerProfile) => void;
  isFilling: boolean;
  fillElapsed: number;
  onAiFill: () => void;
  onCancelFill: () => void;
  // segments (Step 4)
  segments: Record<string, string>;
  setSegments: (s: Record<string, string>) => void;
  isGenerating: boolean;
  regeneratingId: string | null;
  includeAgeStages: boolean;
  setIncludeAgeStages: (v: boolean) => void;
  hasApiConfig: boolean;
  // handlers
  onGenerateAll: (drafts?: Record<string, string>) => void;
  onRegenerateSegment: (id: string, draft?: string) => void;
  onLoadPreset: (preset: HistoryPreset) => void;
  buildInitialState: () => GameState;
  onStartGame: () => void;
  // world editor
  worldEditorOpen?: boolean;
  editingWorld?: WorldDef | null;
  onSaveWorld?: (world: WorldDef) => void;
  onDeleteWorld?: (worldId: string) => void;
  onCancelWorldEditor?: () => void;
  onOpenEditor?: (world: WorldDef | null) => void;
  onImportWorld?: (world: WorldDef) => void;
  apiConfig: any;
  settings: any;
}

export default function WizardShell({
  step, setStep, onBackToMenu, title, subtitle, t,
  selectedWorld,
  allWorlds, worldEntry,
  personalInfo, setPersonalInfo, isFilling, fillElapsed, onAiFill, onCancelFill,
  segments, setSegments, isGenerating, regeneratingId,
  includeAgeStages, setIncludeAgeStages,
  hasApiConfig,
  onGenerateAll, onRegenerateSegment, onLoadPreset, buildInitialState, onStartGame,
  apiConfig, settings,
}: WizardShellProps) {
  // 动态计算年龄阶段（根据开关决定是否包含）
  const segmentDefs = useMemo(
    () => includeAgeStages
      ? buildSegmentDefs(getAgeStages(personalInfo.age))
      : [{ id: 'prologue', title: '序章', icon: <Sunrise size={15} /> }],
    [personalInfo.age, includeAgeStages],
  );

  const [modalOpen, setModalOpen] = useState(false);
  const selectedWorldName = allWorlds.find(world => world.id === selectedWorld)?.name || selectedWorld || '未选择世界';
  const selectedWorldDef = allWorlds.find(world => world.id === selectedWorld);
  const professionModule = isProfessionModuleEnabled(selectedWorldDef) ? selectedWorldDef?.modules?.find(module => module.moduleId === 'profession' && module.enabled) : undefined;
  const combatModule = selectedWorldDef?.modules?.find(module => module.moduleId === 'combat' && module.enabled);
  const resolvedProfessionConfig = professionModule ? resolveProfessionBinding(professionModule.moduleConfig ?? professionModule.data) : undefined;
  const professionConfig: ProfessionModuleSchema | undefined = resolvedProfessionConfig?.professions.length ? resolvedProfessionConfig : undefined;
  const stepLayout = getCreationStepLayout(Boolean(professionConfig));
  const stepLabels = stepLayout.labels;
  const currentStep = Math.min(Math.max(step, 1), stepLabels.length);
  const { professionStep, loadoutStep, historyStep, confirmStep } = stepLayout;
  const selectedWorldScene = selectedWorldDef ? resolveWorldArtwork(selectedWorldDef).src : undefined;
  // World selection/editor actions are owned by the hall. Kept as inert shims for the disabled legacy block.
  const setSelectedWorld = (_id: string) => undefined;
  const onOpenEditor = (_world: WorldDef | null) => undefined;
  const identityReady = Boolean(personalInfo.name.trim() && personalInfo.gender && personalInfo.age.trim());
  const historyReady = segmentDefs.every(def => segments[def.id]?.trim().length > 0);
  const professionReady = !professionConfig || validateProfessionSelection(
    professionConfig,
    personalInfo.professionId ?? null,
    personalInfo.innateTalentIds ?? [],
  ).ok;
  const canAdvance = currentStep === 1 ? identityReady
    : currentStep === professionStep ? professionReady
      : currentStep === historyStep ? historyReady
        : true;

  const handleBack = () => {
    if (modalOpen) return;
    if (currentStep === 1) {
      onBackToMenu();
      return;
    }
    setStep(currentStep - 1);
  };

  const handleNext = () => {
    if (modalOpen) return;
    if (!canAdvance) return;
    if (currentStep === confirmStep) {
      onStartGame();
      return;
    }
    setStep(currentStep + 1);
  };

  return (
    <div className="creation-ritual-shell" aria-label="世界降临仪式">
      <header className="creation-ritual-shell__header">
        <div>
          <div>{selectedWorldName}</div>
          <h1>世界降临仪式</h1>
          <p>{subtitle || title}</p>
        </div>
      </header>

      <div className="creation-ritual-shell__body">
        <aside className="creation-ritual-shell__steps" aria-label="创建步骤">
          {stepLabels.map((label, index) => {
            const stepNum = index + 1;
            const isActive = currentStep === stepNum;
            const isCompleted = currentStep > stepNum;
            return (
              <div key={label} className={`creation-ritual-step${isActive ? ' is-active' : ''}${isCompleted ? ' is-completed' : ''}`} aria-current={isActive ? 'step' : undefined}>
                <span className="creation-ritual-step__index">
                  {isCompleted ? <Check size={14} /> : stepNum}
                </span>
                <span className="creation-ritual-step__label">{label}</span>
              </div>
            );
          })}
        </aside>

        <section className="creation-ritual-shell__paper">
          <DawnFrameV4 mode="panel" className="creation-ritual-shell__paper-frame" ariaLabel="世界降临仪式主纸面">
            <AmbientParticleLayer />
            <section className={`creation-ritual-shell__stage is-step-${currentStep === historyStep ? 3 : currentStep === confirmStep ? 4 : currentStep === 1 ? 1 : 2}`}>
          <div className="creation-ritual-shell__anchor">
            {currentStep === 1 ? null : currentStep === historyStep ? null : currentStep === confirmStep ? (
              <div className="departure-gate-preview">
                <div className="departure-gate-preview__scene" style={selectedWorldScene ? { backgroundImage: `url("${selectedWorldScene}")` } : undefined} aria-hidden="true" />
                <img src={RITUAL_ANCHORS[4]} alt="启程门" draggable={false} />
                <span>{selectedWorldName}</span>
              </div>
            ) : (
              <>
                <img className="is-astrolabe" src={RITUAL_ANCHORS[2]} alt="" draggable={false} />
                <span>{selectedWorldName}</span>
              </>
            )}
          </div>

          <main key={currentStep} className="creation-ritual-shell__scroll">
            {currentStep === 1 && (
              <div className="ritual-identity-layout">
                <aside className="ritual-identity-portrait" aria-label="人物身份摘要">
                  <div className="creation-ritual-portrait-slot">
                    <PortraitEditor personalInfo={personalInfo} onChange={portrait => setPersonalInfo({ ...personalInfo, portrait })} />
                  </div>
                  <div className="ritual-identity-summary">
                    <span className="ritual-section-kicker">身份卷 · 当前旅者</span>
                    <strong>{personalInfo.name || '未命名旅者'}</strong>
                    <span>{[personalInfo.age && `${personalInfo.age}岁`, personalInfo.gender, personalInfo.career].filter(Boolean).join(' · ') || '填写右侧资料后生成摘要'}</span>
                    <small>{personalInfo.perspective || '选择叙事视角'}</small>
                    <small className="ritual-world-context">世界 · {selectedWorldName}</small>
                  </div>
                </aside>
                <div className="ritual-identity-form">
                {/* World selection moved to the hall; the legacy block remains disabled for compatibility. */}
                {false && <div className="creation-ritual-world-choice">
                  <div>
                    <span className="creation-ritual-world-choice__eyebrow">第一步 · 选择旅庭</span>
                    <strong>{selectedWorldDef?.name || '请选择一个世界'}</strong>
                    <small>{selectedWorldDef?.description || '也可以创建或导入自己的世界。'}</small>
                  </div>
                  <select aria-label="选择世界" value={selectedWorld} onChange={event => setSelectedWorld(event.target.value)}>
                    <option value="">请选择世界</option>
                    {allWorlds.map(world => <option key={world.id} value={world.id}>{world.name}</option>)}
                  </select>
                  <div className="creation-ritual-world-choice__actions">
                    <button type="button" onClick={() => onOpenEditor(selectedWorldDef || null)}>编辑世界</button>
                    <button type="button" onClick={() => onOpenEditor(null)}>创建世界</button>
                  </div>
                </div>}
                <StepPersonalInfo
                phase="identity"
                showNavigation={false}
                personalInfo={personalInfo} setPersonalInfo={setPersonalInfo}
                isFilling={isFilling} fillElapsed={fillElapsed} onAiFill={onAiFill} onCancelFill={onCancelFill}
                hasApiConfig={hasApiConfig}
                worldModules={allWorlds.find(world => world.id === selectedWorld)?.modules}
                apiConfig={apiConfig}
                selectedWorld={selectedWorld}
                allWorlds={allWorlds}
                worldEntry={worldEntry}
                onModalStateChange={setModalOpen}
                onNext={() => setStep(professionConfig ? professionStep : loadoutStep)} onPrev={() => setStep(1)}
                />
                </div>
              </div>
            )}
            {professionConfig && currentStep === professionStep && (
              <StepProfessionTalents
                config={professionConfig}
                personalInfo={personalInfo}
                setPersonalInfo={setPersonalInfo}
              />
            )}
            {currentStep === loadoutStep && (
              <StepPersonalInfo
                phase="loadout"
                showNavigation={false}
                personalInfo={personalInfo} setPersonalInfo={setPersonalInfo}
                isFilling={isFilling} fillElapsed={fillElapsed} onAiFill={onAiFill} onCancelFill={onCancelFill}
                hasApiConfig={hasApiConfig}
                worldModules={allWorlds.find(world => world.id === selectedWorld)?.modules}
                apiConfig={apiConfig}
                selectedWorld={selectedWorld}
                allWorlds={allWorlds}
                worldEntry={worldEntry}
                onModalStateChange={setModalOpen}
                onNext={() => setStep(historyStep)} onPrev={() => setStep(professionConfig ? professionStep : 1)}
              />
            )}
            {currentStep === historyStep && (
              <StepCharacterHistory
                showNavigation={false}
                segmentDefs={segmentDefs} segments={segments} setSegments={setSegments}
                isGenerating={isGenerating} regeneratingId={regeneratingId}
                includeAgeStages={includeAgeStages} setIncludeAgeStages={setIncludeAgeStages}
                hasApiConfig={hasApiConfig}
                onGenerateAll={onGenerateAll} onRegenerateSegment={onRegenerateSegment}
                onLoadPreset={onLoadPreset}
                onModalStateChange={setModalOpen}
                onStartGame={() => setStep(confirmStep)}
                onPrev={() => setStep(loadoutStep)}
              />
            )}
            {currentStep === confirmStep && (
              <StepConfirm
                showNavigation={false}
                personalInfo={personalInfo}
                segmentDefs={segmentDefs} segments={segments}
                buildInitialState={buildInitialState}
                selectedWorldName={selectedWorldName}
                worldSummary={selectedWorldDef?.description}
                portraitSource={getPortraitSource(personalInfo)}
                hasProfession={Boolean(professionConfig)}
                hasCombat={Boolean(combatModule)}
                combatRiskMode={personalInfo.combatRiskMode ?? 'normal'}
                onCombatRiskModeChange={(mode: CombatRiskMode) => setPersonalInfo({ ...personalInfo, combatRiskMode: mode })}
                onStartGame={onStartGame}
                onPrev={() => setStep(historyStep)}
              />
            )}
          </main>
        </section>
          </DawnFrameV4>

          <footer className={`creation-ritual-shell__footer${currentStep === historyStep ? ' is-step-3' : ''}${modalOpen ? ' is-modal-blocked' : ''}`} aria-disabled={modalOpen}>
            <EntrySlicedButton type="button" frame="dawn-v4-compact" className="btn-secondary" onClick={handleBack} disabled={modalOpen}>
              {currentStep === 1 ? '返回大厅' : '← 上一步'}
            </EntrySlicedButton>
            <div>
              <span>{currentStep} / {stepLabels.length}</span>
              {currentStep === historyStep && !historyReady && <span className="creation-ritual-shell__next-reason" role="status">请完成当前/全部编年阶段后继续</span>}
              <EntrySlicedButton type="button" frame="dawn-v4-compact" className="btn-primary" onClick={handleNext} disabled={modalOpen || !canAdvance}>
                {currentStep === confirmStep ? '开始冒险' : '下一步'} →
              </EntrySlicedButton>
            </div>
          </footer>
        </section>
      </div>

      {/* 世界编辑器覆盖层 */}
    </div>
  );
}
