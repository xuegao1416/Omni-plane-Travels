import { X, RefreshCw, Undo2 } from 'lucide-react';
import type { WorldDef } from '../../data/worlds-schema';
import { GUIDED_DIMENSIONS, getDimensionQuestion } from './guidedChoice/dimensions';
import { useGuidedSelection } from './guidedChoice/useGuidedSelection';
import { LoadingView } from './guidedChoice/LoadingView';
import { StepIndicator } from './guidedChoice/StepIndicator';
import { ChoiceCard, CustomCard } from './guidedChoice/ChoiceCard';
import { CustomEditArea } from './guidedChoice/CustomEditArea';
import { BottomNav } from './guidedChoice/BottomNav';

interface GuidedChoiceOverlayProps {
  visible: boolean;
  userDesc: string;
  selectedModules: string[];
  apiConfig: any;
  onComplete: (worldDef: WorldDef) => void;
  onClose: () => void;
}

export default function GuidedChoiceOverlay({
  visible, userDesc, selectedModules, apiConfig, onComplete, onClose,
}: GuidedChoiceOverlayProps) {
  const s = useGuidedSelection({ visible, userDesc, selectedModules, apiConfig, onComplete, onClose });

  if (!visible) return null;

  if (s.phase === 'loading') {
    return <LoadingView title="AI 正在分析你的世界..." subtitle={userDesc} spinnerMessage="正在为你生成世界选项..." onClose={s.handleClose} />;
  }

  if (s.phase === 'generating') {
    return <LoadingView title="正在生成你的世界..." subtitle={`已选择 ${s.selections.length} 个维度，AI 正在根据你的选择构建完整世界`} spinnerMessage="正在生成世界名称、设定、势力、NPC..." onClose={s.handleClose} />;
  }

  const { currentDim, currentGeneration, currentSelection } = s;

  return (
    <section className="guided-choice-panel" aria-label="世界织构推演">
      <div className="guided-choice-header">
        <button className="guided-choice-close" onClick={s.handleClose} aria-label="关闭世界织构推演"><X size={16} /></button>
        <div className="guided-choice-heading">
          <span className="world-weave-kicker">STEP 02 · WORLD WEAVE</span>
          <h2>世界织构推演</h2>
          <p>{userDesc}</p>
        </div>
      </div>

      <StepIndicator currentDimIndex={s.currentDimIndex} selections={s.selections} onJump={s.setCurrentDimIndex} />

      <main className="guided-choice-body">
        <div className="guided-choice-body__inner">
          {s.error && (
            <div className="guided-choice-error">
              <p>{s.error}</p>
              <button className="guided-choice-primary" onClick={s.handleRetry}>重试</button>
            </div>
          )}

          {!s.error && currentGeneration?.narrative && <p className="guided-choice-narrative">{currentGeneration.narrative}</p>}

          {!s.error && currentDim && (
            <div className="guided-choice-question">
              <span className="guided-choice-question__eyebrow">{currentDim.label}</span>
              <h3>{getDimensionQuestion(currentDim.key)}</h3>
              <p>
                {currentDim.description}
                {currentDim.multiSelect && <span className="guided-choice-question__limit">（可多选，最多 {currentDim.maxSelect || 3} 个）</span>}
              </p>
              <div className="guided-choice-question__actions">
                <button onClick={s.handleRegenerate} disabled={s.isRegenerating} className="guided-choice-tool" title="重新生成本维度的选项">
                  <RefreshCw size={13} className={s.isRegenerating ? 'is-spinning' : undefined} />
                  {s.isRegenerating ? '生成中...' : '换一批'}
                </button>
                {s.hasHistory && <button onClick={s.handleUndoRegenerate} className="guided-choice-tool" title="恢复上一批选项"><Undo2 size={13} /> 上一批</button>}
              </div>
            </div>
          )}

          {!s.error && currentGeneration && currentDim && (
            <>
              <div className="guided-choice-options">
                {(currentGeneration.choices ?? []).map(choice => {
                  const isSelected = !!(currentDim.multiSelect
                    ? currentSelection?.choices?.some(c => c.id === choice.id)
                    : currentSelection?.choiceId === choice.id);
                  return <ChoiceCard key={choice.id} choice={choice} dimColor={currentDim.color} isSelected={isSelected} onSelect={() => s.handleSelect(choice.id)} />;
                })}
                <CustomCard
                  dimColor={currentDim.color}
                  dimLabel={currentDim.label}
                  isCustomSelected={!!s.isCustomSelected}
                  isEditingCustom={s.isEditingCustom}
                  displayTitle={s.customChoice?.title || '自定义'}
                  displaySubtitle={s.customChoice?.subtitle || '自己填写内容'}
                  onSelect={() => s.handleSelect('E')}
                />
              </div>
              {s.isEditingCustom && (
                <CustomEditArea
                  dimLabel={currentDim.label}
                  placeholderTitle={currentGeneration.choices[0]?.title || '输入标题'}
                  placeholderSubtitle={currentGeneration.choices[0]?.subtitle || '输入描述'}
                  customTitle={s.customTitle}
                  customSubtitle={s.customSubtitle}
                  isCompleting={s.isCompleting}
                  onTitleChange={s.setCustomTitle}
                  onSubtitleChange={s.setCustomSubtitle}
                  onCancel={() => s.setIsEditingCustom(false)}
                  onAIComplete={s.handleAIComplete}
                  onSave={s.handleSaveCustom}
                />
              )}
            </>
          )}
        </div>
      </main>

      <BottomNav
        currentDimIndex={s.currentDimIndex}
        totalDims={GUIDED_DIMENSIONS.length}
        canProceed={s.canProceed}
        isLastDimension={s.isLastDimension}
        dimRequired={!!currentDim?.required}
        onPrev={() => s.setCurrentDimIndex(prev => prev - 1)}
        onNext={s.handleNext}
        onSkip={() => s.isLastDimension ? s.handleComplete() : s.setCurrentDimIndex(prev => prev + 1)}
      />
    </section>
  );
}
