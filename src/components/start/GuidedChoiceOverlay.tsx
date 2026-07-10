import { X } from 'lucide-react';
import type { WorldDef } from '../../data/worlds-schema';
import { GUIDED_DIMENSIONS, getDimensionQuestion } from './guidedChoice/dimensions';
import {
  overlayStyle, headerBarStyle, closeBtnStyle, titleStyle, subtitleStyle,
  cardGridStyle, primaryBtnStyle,
} from './guidedChoice/styles';
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
    return (
      <LoadingView
        title="AI 正在分析你的世界..."
        subtitle={userDesc}
        spinnerMessage="正在为你生成世界选项..."
        onClose={s.handleClose}
      />
    );
  }

  if (s.phase === 'generating') {
    return (
      <LoadingView
        title="正在生成你的世界..."
        subtitle={`已选择 ${s.selections.length} 个维度，AI 正在根据你的选择构建完整世界`}
        spinnerMessage="正在生成世界名称、设定、势力、NPC..."
        onClose={s.handleClose}
      />
    );
  }

  const { currentDim, currentGeneration, currentSelection } = s;

  return (
    <div style={overlayStyle}>
      <div style={headerBarStyle}>
        <button onClick={s.handleClose} style={closeBtnStyle}><X size={16} /></button>
        <div style={{ textAlign: 'center' }}>
          <h1 style={titleStyle}>选择你的世界</h1>
          <p style={subtitleStyle}>{userDesc}</p>
        </div>
      </div>

      <StepIndicator
        currentDimIndex={s.currentDimIndex}
        selections={s.selections}
        onJump={s.setCurrentDimIndex}
      />

      <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem 1.5rem 0' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', paddingBottom: '1rem' }}>
          {s.error && (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{s.error}</p>
              <button onClick={s.handleRetry} style={primaryBtnStyle}>重试</button>
            </div>
          )}

          {!s.error && currentGeneration?.narrative && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, maxWidth: '600px', margin: '0 auto 1.5rem', animation: 'slideUp 0.3s ease' }}>
              {currentGeneration.narrative}
            </p>
          )}

          {!s.error && currentDim && (
            <div style={{ textAlign: 'center', marginBottom: '1.5rem', animation: 'slideUp 0.3s ease' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text-primary)', margin: 0 }}>
                {getDimensionQuestion(currentDim.key)}
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', marginTop: '0.4rem' }}>
                {currentDim.description}
                {currentDim.multiSelect && (
                  <span style={{ marginLeft: '8px', color: 'var(--accent)' }}>
                    （可多选，最多{currentDim.maxSelect || 3}个）
                  </span>
                )}
              </p>
            </div>
          )}

          {!s.error && currentGeneration && currentDim && (
            <>
              <div style={cardGridStyle}>
                {(currentGeneration.choices ?? []).map((choice) => {
                  const isSelected = !!(currentDim.multiSelect
                    ? currentSelection?.choices?.some(c => c.id === choice.id)
                    : currentSelection?.choiceId === choice.id);
                  return (
                    <ChoiceCard
                      key={choice.id}
                      choice={choice}
                      dimColor={currentDim.color}
                      isSelected={isSelected}
                      onSelect={() => s.handleSelect(choice.id)}
                    />
                  );
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

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @media (max-width: 640px) { .guide-step-label { display: none; } }
      `}</style>
    </div>
  );
}
