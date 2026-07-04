import { useMemo } from 'react';
import type { WorldDef } from '../../data/worldLoader';
import type { WorldBookEntry } from '../../worldbook/index';
import type { PlayerProfile } from '../../storage/db';
import type { GameState } from '../../schema/variables';
import type { HistoryPreset } from '../../storage/templateStore';
import { Check, Sunrise } from 'lucide-react';
import { getAgeStages } from '../../utils/ageStages';
import WorldEditorForm from './WorldEditorForm';
import StepWorldBrowser from './StepWorldBrowser';
import StepPersonalInfo from './StepPersonalInfo';
import StepCharacterHistory, { buildSegmentDefs } from './StepCharacterHistory';
import StepConfirm from './StepConfirm';

const STEP_LABELS = ['选择世界', '角色创建', '人物经历', '总确认'];

interface WizardShellProps {
  step: number;
  setStep: (s: number) => void;
  onBackToMenu: () => void;
  title: string;
  subtitle: string;
  t: (key: string) => string;
  // step props
  selectedWorld: string;
  setSelectedWorld: (id: string) => void;
  allWorlds: WorldDef[];
  createdWorlds: WorldDef[];
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
  worldEditorOpen: boolean;
  editingWorld: WorldDef | null;
  onSaveWorld: (world: WorldDef) => void;
  onDeleteWorld: (worldId: string) => void;
  onCancelWorldEditor: () => void;
  onOpenEditor: (world: WorldDef | null) => void;
  onImportWorld: (world: WorldDef) => void;
  apiConfig: any;
  settings: any;
}

export default function WizardShell({
  step, setStep, onBackToMenu, title, subtitle, t,
  selectedWorld, setSelectedWorld,
  allWorlds, createdWorlds, worldEntry,
  personalInfo, setPersonalInfo, isFilling, fillElapsed, onAiFill, onCancelFill,
  segments, setSegments, isGenerating, regeneratingId,
  includeAgeStages, setIncludeAgeStages,
  hasApiConfig,
  onGenerateAll, onRegenerateSegment, onLoadPreset, buildInitialState, onStartGame,
  worldEditorOpen, editingWorld, onSaveWorld, onDeleteWorld, onCancelWorldEditor, onOpenEditor,
  onImportWorld,
  apiConfig, settings,
}: WizardShellProps) {
  // 动态计算年龄阶段（根据开关决定是否包含）
  const segmentDefs = useMemo(
    () => includeAgeStages
      ? buildSegmentDefs(getAgeStages(personalInfo.age))
      : [{ id: 'prologue', title: '序章', icon: <Sunrise size={15} /> }],
    [personalInfo.age, includeAgeStages],
  );

  return (
    <div
      className="full-height"
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
      }}
    >
      {/* ── 顶部标题栏（精简） ── */}
      <div className="wizard-topbar" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '1rem 2rem', borderBottom: '1px solid var(--border)', animation: 'slideUp 0.3s ease' }}>
        <button
          onClick={() => { onBackToMenu(); }}
          style={{ position: 'absolute', left: '1.5rem', border: 'none', background: 'var(--bg-secondary)', width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >←</button>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 'bold', color: 'var(--accent)', letterSpacing: '0.05em', margin: 0 }}>{title}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', marginTop: '0.2rem', margin: 0 }}>{subtitle}</p>
        </div>
      </div>

      {/* ── 主区域：左侧步骤栏 + 右侧内容 ── */}
      <div className="wizard-main" style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* 左侧步骤栏 */}
        <aside className="wizard-sidebar">
          {STEP_LABELS.map((label, i) => {
            const stepNum = i + 1;
            const isActive = step === stepNum;
            const isCompleted = step > stepNum;
            return (
              <div key={stepNum} className={`wizard-sidebar-step${isActive ? ' active' : ''}${isCompleted ? ' completed' : ''}`}>
                {/* 竖线连接器 */}
                <div className="wizard-sidebar-line-wrap">
                  <div className="wizard-sidebar-dot">
                    {isCompleted ? <Check size={14} /> : stepNum}
                  </div>
                  {i < STEP_LABELS.length - 1 && <div className={`wizard-sidebar-line${isCompleted ? ' completed' : ''}`} />}
                </div>
                <span className="wizard-sidebar-label">{label}</span>
              </div>
            );
          })}
        </aside>

        {/* 右侧内容区域 */}
        <main className="wizard-content">
          <div style={{ width: '100%', maxWidth: '1200px', animation: 'slideUp 0.3s ease' }}>
            {step === 1 && (
              <StepWorldBrowser
                selectedWorld={selectedWorld} setSelectedWorld={setSelectedWorld}
                createdWorlds={createdWorlds} allWorlds={allWorlds}
                worldEntry={worldEntry}
                onNext={() => setStep(2)}
                onEditWorld={(w) => onOpenEditor(w)}
                onDeleteWorld={onDeleteWorld}
                onCreateWorld={() => onOpenEditor(null)}
                onImportWorld={onImportWorld}
                onSaveWorld={onSaveWorld}
              />
            )}
            {step === 2 && (
              <StepPersonalInfo
                personalInfo={personalInfo} setPersonalInfo={setPersonalInfo}
                isFilling={isFilling} fillElapsed={fillElapsed} onAiFill={onAiFill} onCancelFill={onCancelFill}
                hasApiConfig={hasApiConfig}
                worldModules={allWorlds.find(w => w.id === selectedWorld)?.modules}
                apiConfig={apiConfig}
                selectedWorld={selectedWorld}
                allWorlds={allWorlds}
                worldEntry={worldEntry}
                onNext={() => setStep(3)} onPrev={() => setStep(1)}
              />
            )}
            {step === 3 && (
              <StepCharacterHistory
                segmentDefs={segmentDefs} segments={segments} setSegments={setSegments}
                isGenerating={isGenerating} regeneratingId={regeneratingId}
                includeAgeStages={includeAgeStages} setIncludeAgeStages={setIncludeAgeStages}
                hasApiConfig={hasApiConfig}
                onGenerateAll={onGenerateAll} onRegenerateSegment={onRegenerateSegment}
                onLoadPreset={onLoadPreset}
                onStartGame={() => setStep(4)}
                onPrev={() => setStep(2)}
              />
            )}
            {step === 4 && (
              <StepConfirm
                personalInfo={personalInfo}
                segmentDefs={segmentDefs} segments={segments}
                buildInitialState={buildInitialState}
                onStartGame={onStartGame}
                onPrev={() => setStep(3)}
              />
            )}
          </div>
        </main>
      </div>

      {/* 世界编辑器覆盖层 */}
      {worldEditorOpen && (
        <WorldEditorForm
          initialWorld={editingWorld}
          onSave={onSaveWorld}
          onCancel={onCancelWorldEditor}
          apiConfig={apiConfig}
          settings={settings}
        />
      )}
    </div>
  );
}
