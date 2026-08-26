import { useMemo, useState, useEffect, useRef } from 'react';
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
import type { ProfessionModuleSchema, ProfessionWorldBinding } from '../../modules/schema';
import { validateProfessionSelection } from '../../gameplay/profession';
import { getCreationStepLayout } from './creationStepLayout';
import { extractLegacyProfessionPack, isProfessionBinding, resolveProfessionBinding } from '../../data/professions';
import { isProfessionModuleEnabled } from '../../gameplay/profession/featureGate';
import type { CombatRiskMode } from '../../gameplay/protocols';
import {
  computeCreationSpending,
  resolveCreationStatConfig,
  resolveWorldPointScale,
} from '../../gameplay/creation/creationPoints';
import DifficultySelector from './DifficultySelector';
import ProfessionLibraryWorkspace from '../profession/ProfessionLibraryWorkspace';

const RITUAL_ANCHORS: Record<number, string> = {
  1: '/art/theme/ui-kit/dawn-v4/ritual/identity-mirror-v1.png',
  2: '/art/theme/ui-kit/dawn-v4/ritual/talent-astrolabe-v1.png',
  4: '/art/theme/ui-kit/dawn-v4/ritual/departure-gate-v1.png',
};

const EMPTY_PROFESSION_CONFIG: ProfessionModuleSchema = {
  professions: [],
  innateTalents: [],
  creationTalentBudget: 0,
  allowNoProfession: true,
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
  allWorlds, createdWorlds = [], worldEntry,
  personalInfo, setPersonalInfo, isFilling, fillElapsed, onAiFill, onCancelFill,
  segments, setSegments, isGenerating, regeneratingId,
  includeAgeStages, setIncludeAgeStages,
  hasApiConfig,
  onGenerateAll, onRegenerateSegment, onLoadPreset, buildInitialState, onStartGame, onSaveWorld,
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
  const [professionLibraryOpen, setProfessionLibraryOpen] = useState(false);
  const selectedWorldName = allWorlds.find(world => world.id === selectedWorld)?.name || selectedWorld || '未选择世界';
  const selectedWorldDef = allWorlds.find(world => world.id === selectedWorld);
  const professionModule = isProfessionModuleEnabled(selectedWorldDef) ? selectedWorldDef?.modules?.find(module => module.moduleId === 'profession' && module.enabled) : undefined;
  const combatModule = selectedWorldDef?.modules?.find(module => module.moduleId === 'combat' && module.enabled);
  const statModule = selectedWorldDef?.modules?.find(module => module.moduleId === 'stat' && module.enabled);
  const statConfig = statModule
    ? resolveCreationStatConfig(statModule.moduleConfig, statModule.initialState)
    : undefined;
  const pointScale = resolveWorldPointScale(selectedWorldDef ?? null);
  const showDifficulty = Boolean(combatModule || statModule || professionModule);
  const hasCombat = Boolean(combatModule);
  const resolvedProfessionConfig = professionModule ? resolveProfessionBinding(professionModule.moduleConfig ?? professionModule.data) : undefined;
  const professionConfig: ProfessionModuleSchema | undefined = resolvedProfessionConfig?.professions.length ? resolvedProfessionConfig : undefined;
  const previousWorldRef = useRef(selectedWorld);
  // 换世界时清空创建期字段，避免上一世界的加点/天赋/抽卡泄漏到新世界。
  // 首次挂载不清空，保留导入预设和当前向导草稿。
  useEffect(() => {
    if (previousWorldRef.current === selectedWorld) return;
    previousWorldRef.current = selectedWorld;
    setPersonalInfo({
      ...personalInfo,
      professionId: undefined,
      career: '',
      innateTalentIds: undefined,
      creationPointAllocations: undefined,
      creationDrawCount: undefined,
      creationDrawnTalentIds: undefined,
      moduleInitData: undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorld]);
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
  const creationSpending = computeCreationSpending(professionConfig ?? EMPTY_PROFESSION_CONFIG, {
    riskMode: personalInfo.combatRiskMode ?? 'normal',
    pointScale,
    talentIds: personalInfo.innateTalentIds ?? [],
    drawnTalentIds: personalInfo.creationDrawnTalentIds ?? [],
    drawCount: personalInfo.creationDrawCount ?? 0,
    allocations: personalInfo.creationPointAllocations ?? {},
  });
  const professionStructureReady = !professionConfig || validateProfessionSelection(
    professionConfig,
    personalInfo.professionId ?? null,
    personalInfo.innateTalentIds ?? [],
    Number.MAX_SAFE_INTEGER,
  ).ok;
  const professionReady = professionStructureReady && creationSpending.ok;
  const loadoutReady = Boolean(professionConfig) || !statConfig || creationSpending.ok;
  const canAdvance = currentStep === 1 ? identityReady
    : currentStep === professionStep ? professionReady
      : currentStep === loadoutStep ? loadoutReady
      : currentStep === historyStep ? historyReady
        : true;
  const navigationBlocked = modalOpen || professionLibraryOpen;

  const professionBinding: ProfessionWorldBinding = isProfessionBinding(professionModule?.moduleConfig)
    ? professionModule.moduleConfig
    : { packIds: [] };

  const handleWorldBindingChange = (next: ProfessionWorldBinding) => {
    if (!selectedWorldDef) return;
    const bindingChanged = JSON.stringify(next) !== JSON.stringify(professionBinding);
    const updatedWorld: WorldDef = {
      ...selectedWorldDef,
      modules: (selectedWorldDef.modules ?? []).map(module => module.moduleId === 'profession'
        ? { ...module, moduleConfig: next as unknown as Record<string, unknown> }
        : module),
    };
    if (bindingChanged) {
      setPersonalInfo({
        ...personalInfo,
        professionId: undefined,
        career: '',
        innateTalentIds: undefined,
        creationDrawnTalentIds: undefined,
        creationDrawCount: undefined,
      });
    }
    onSaveWorld?.(updatedWorld);
  };

  const openProfessionLibrary = () => {
    const isBuiltin = !createdWorlds.some(world => world.id === selectedWorld);
    if (isBuiltin && typeof window !== 'undefined' && !window.confirm('修改内置世界的职业绑定将保存为该世界的自定义副本。继续吗？')) return;
    const source = professionModule?.moduleConfig ?? professionModule?.data;
    if (source && !isProfessionBinding(source) && Array.isArray((source as unknown as ProfessionModuleSchema).professions)) {
      handleWorldBindingChange(extractLegacyProfessionPack(
        source as unknown as ProfessionModuleSchema,
        `${selectedWorldDef?.name || '旧世界'} · 职业包`,
      ));
    }
    setProfessionLibraryOpen(true);
  };

  const handleBack = () => {
    if (navigationBlocked) return;
    if (currentStep === 1) {
      onBackToMenu();
      return;
    }
    setStep(currentStep - 1);
  };

  const handleNext = () => {
    if (navigationBlocked) return;
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
              <>
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
                hasProfessionStep={Boolean(professionConfig)}
                difficultyContent={showDifficulty ? (
                  <section className="ritual-difficulty-section" aria-label="降临难度">
                    <div className="ritual-form-section__heading">
                      <span>降临难度</span>
                      <small>决定降临点数与战斗风险 · 启程后不可更改</small>
                    </div>
                    <DifficultySelector
                      value={personalInfo.combatRiskMode ?? 'normal'}
                      onChange={(mode: CombatRiskMode) => setPersonalInfo({ ...personalInfo, combatRiskMode: mode })}
                      hasCombat={hasCombat}
                      pointScale={pointScale}
                    />
                  </section>
                ) : null}
                onModalStateChange={setModalOpen}
                onNext={() => setStep(professionConfig ? professionStep : loadoutStep)} onPrev={() => setStep(1)}
                />
                </div>
              </div>
              </>
            )}
            {professionConfig && currentStep === professionStep && (
              <StepProfessionTalents
                config={professionConfig}
                personalInfo={personalInfo}
                setPersonalInfo={setPersonalInfo}
                statConfig={statConfig}
                pointScale={pointScale}
                onOpenProfessionLibrary={openProfessionLibrary}
                onModalStateChange={setModalOpen}
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
                hasProfessionStep={Boolean(professionConfig)}
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
                showDifficulty={showDifficulty}
                combatRiskMode={personalInfo.combatRiskMode ?? 'normal'}
                pointScale={pointScale}
                creationSpending={creationSpending}
                onStartGame={onStartGame}
                onPrev={() => setStep(historyStep)}
              />
            )}
          </main>
        </section>
          </DawnFrameV4>

          <footer className={`creation-ritual-shell__footer${currentStep === historyStep ? ' is-step-3' : ''}${navigationBlocked ? ' is-modal-blocked' : ''}`} aria-disabled={navigationBlocked}>
            <EntrySlicedButton type="button" frame="dawn-v4-compact" className="btn-secondary" onClick={handleBack} disabled={navigationBlocked}>
              {currentStep === 1 ? '返回大厅' : '← 上一步'}
            </EntrySlicedButton>
            <div>
              <span>{currentStep} / {stepLabels.length}</span>
              {currentStep === historyStep && !historyReady && <span className="creation-ritual-shell__next-reason" role="status">请完成当前/全部编年阶段后继续</span>}
              <EntrySlicedButton type="button" frame="dawn-v4-compact" className="btn-primary" onClick={handleNext} disabled={navigationBlocked || !canAdvance}>
                {currentStep === confirmStep ? '开始冒险' : '下一步'} →
              </EntrySlicedButton>
            </div>
          </footer>
        </section>
      </div>

      {/* 世界编辑器覆盖层 */}
      {professionLibraryOpen && selectedWorldDef && (
        <ProfessionLibraryWorkspace
          binding={professionBinding}
          onBindingChange={handleWorldBindingChange}
          onClose={() => setProfessionLibraryOpen(false)}
        />
      )}
    </div>
  );
}
