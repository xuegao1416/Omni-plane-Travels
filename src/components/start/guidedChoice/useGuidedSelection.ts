import { useState, useEffect, useCallback, useRef } from 'react';
import type { WorldDef, WorldBookEntryDef, WorldModule } from '../../../data/worlds-schema';
import type { DimensionChoice, DimensionGeneration, DimensionSelection } from '../../../worldgen/choice';
import { generateWorldFromSelections, generateModuleEntries } from '../../../worldgen/choice';
import { requestStreamWithRetry } from '../../../api/client';
import { GUIDED_DIMENSIONS } from './dimensions';
import { generateGuidedOptions, extractJSON } from './helpers';

export interface UseGuidedSelectionParams {
  visible: boolean;
  userDesc: string;
  selectedModules: string[];
  apiConfig: any;
  onComplete: (worldDef: WorldDef) => void;
  onClose: () => void;
}

export function useGuidedSelection({
  visible, userDesc, selectedModules, apiConfig, onComplete, onClose,
}: UseGuidedSelectionParams) {
  const [phase, setPhase] = useState<'loading' | 'selecting' | 'generating'>('loading');
  const [allOptions, setAllOptions] = useState<Record<string, DimensionGeneration> | null>(null);
  const [error, setError] = useState('');
  const [currentDimIndex, setCurrentDimIndex] = useState(0);
  const [selections, setSelections] = useState<DimensionSelection[]>([]);
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customSubtitle, setCustomSubtitle] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const currentDim = GUIDED_DIMENSIONS[currentDimIndex];
  const isLastDimension = currentDimIndex === GUIDED_DIMENSIONS.length - 1;
  const currentSelection = selections.find(s => s.dimensionKey === currentDim?.key);
  const currentGeneration = currentDim ? allOptions?.[currentDim.key] : undefined;
  const canProceed = !!currentSelection || !currentDim?.required;
  const isCustomSelected = currentDim?.multiSelect
    ? currentSelection?.choices?.some(c => c.id === 'E')
    : currentSelection?.choiceId === 'E';
  const customSelection = selections.find(s =>
    s.dimensionKey === currentDim?.key && (s.choiceId === 'E' || (s.choiceIds ?? '').split(',').includes('E'))
  );
  const customChoice = customSelection?.choices?.find(c => c.id === 'E');

  const createCallAI = useCallback(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return async (messages: Array<{ role: string; content: string }>): Promise<string> => {
      const result = await requestStreamWithRetry(apiConfig, messages as any, {
        signal: ctrl.signal,
        onDelta: () => {},
      });
      return result.text;
    };
  }, [apiConfig]);

  useEffect(() => {
    if (!visible || allOptions) return;
    let cancelled = false;
    const load = async () => {
      setPhase('loading');
      setError('');
      try {
        const callAI = createCallAI();
        const options = await generateGuidedOptions(userDesc, callAI);
        if (!cancelled) { setAllOptions(options); setPhase('selecting'); }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof Error && err.name === 'AbortError') return;
          setError(`生成选项失败：${err instanceof Error ? err.message : '未知错误'}`);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [visible, userDesc, createCallAI, allOptions]);

  const handleSelect = (choiceId: string) => {
    if (!currentDim || !currentGeneration) return;

    if (choiceId === 'E') {
      if (isCustomSelected) {
        if (currentDim.multiSelect) {
          setSelections(prev => {
            const existing = prev.find(s => s.dimensionKey === currentDim.key);
            if (existing && existing.choices) {
              const newChoices = existing.choices.filter(c => c.id !== 'E');
              if (newChoices.length === 0) return prev.filter(s => s.dimensionKey !== currentDim.key);
              return [...prev.filter(s => s.dimensionKey !== currentDim.key), {
                dimensionKey: currentDim.key, dimensionLabel: currentDim.label,
                choiceId: newChoices.map(c => c.id).join(','), choice: newChoices[0],
                choiceIds: newChoices.map(c => c.id).join(','), choices: newChoices,
              }];
            }
            return prev;
          });
        } else {
          setSelections(prev => prev.filter(s => s.dimensionKey !== currentDim.key));
        }
        setIsEditingCustom(false);
        return;
      }
      setIsEditingCustom(true);
      if (customSelection) {
        setCustomTitle(customChoice?.title || customSelection.choice.title);
        setCustomSubtitle(customChoice?.subtitle || customSelection.choice.subtitle);
      } else { setCustomTitle(''); setCustomSubtitle(''); }
      return;
    }

    const choice = currentGeneration.choices.find(c => c.id === choiceId);
    if (!choice) return;
    setIsEditingCustom(false);

    if (currentDim.multiSelect) {
      const maxSelect = currentDim.maxSelect || 3;
      setSelections(prev => {
        const existing = prev.find(s => s.dimensionKey === currentDim.key);
        if (existing && existing.choices) {
          const isSel = existing.choices.some(c => c.id === choiceId);
          let newChoices: DimensionChoice[];
          if (isSel) {
            newChoices = existing.choices.filter(c => c.id !== choiceId);
          } else {
            if (existing.choices.length >= maxSelect) return prev;
            newChoices = [...existing.choices, choice];
          }
          if (newChoices.length === 0) return prev.filter(s => s.dimensionKey !== currentDim.key);
          return [...prev.filter(s => s.dimensionKey !== currentDim.key), {
            dimensionKey: currentDim.key, dimensionLabel: currentDim.label,
            choiceId: newChoices.map(c => c.id).join(','), choice: newChoices[0],
            choiceIds: newChoices.map(c => c.id).join(','), choices: newChoices,
          }];
        }
        return [...prev.filter(s => s.dimensionKey !== currentDim.key), {
          dimensionKey: currentDim.key, dimensionLabel: currentDim.label,
          choiceId, choice, choiceIds: choiceId, choices: [choice],
        }];
      });
    } else {
      setSelections(prev => [...prev.filter(s => s.dimensionKey !== currentDim.key), {
        dimensionKey: currentDim.key, dimensionLabel: currentDim.label, choiceId, choice,
      }]);
    }
  };

  const handleSaveCustom = () => {
    if (!currentDim || !customTitle.trim()) return;
    const customChoice: DimensionChoice = { id: 'E', title: customTitle.trim(), subtitle: customSubtitle.trim(), isCustom: true };

    if (currentDim.multiSelect) {
      setSelections(prev => {
        const existing = prev.find(s => s.dimensionKey === currentDim.key);
        const existingChoices = existing?.choices || [];
        const hasCustom = existingChoices.some(c => c.id === 'E');
        const newChoices = hasCustom
          ? existingChoices.map(c => c.id === 'E' ? customChoice : c)
          : [...existingChoices, customChoice];
        return [...prev.filter(s => s.dimensionKey !== currentDim.key), {
          dimensionKey: currentDim.key, dimensionLabel: currentDim.label,
          choiceId: newChoices.map(c => c.id).join(','), choice: newChoices[0],
          choiceIds: newChoices.map(c => c.id).join(','), choices: newChoices,
        }];
      });
    } else {
      setSelections(prev => [...prev.filter(s => s.dimensionKey !== currentDim.key), {
        dimensionKey: currentDim.key, dimensionLabel: currentDim.label, choiceId: 'E', choice: customChoice,
      }]);
    }
    setIsEditingCustom(false);
  };

  const handleAIComplete = async () => {
    if (!currentDim || !customTitle.trim()) return;
    setIsCompleting(true);
    try {
      const callAI = createCallAI();
      const prompt = `你是一个世界构建专家。用户正在创建一个世界："${userDesc}"

当前正在设定【${currentDim.label}】维度。

用户输入了以下内容：
- 标题：${customTitle.trim()}
${customSubtitle.trim() ? `- 描述：${customSubtitle.trim()}` : ''}

请根据用户输入的内容，生成一个完整、丰富的【${currentDim.label}】设定。

要求：
- 标题保持在 2-8 个字
- 描述保持在 20-50 个字
- 描述要具体、生动，能让人产生画面感
- 与用户的世界描述"${userDesc}"相匹配

请严格按以下JSON格式返回，不要有任何其他文字：
{
  "title": "生成的标题",
  "subtitle": "生成的描述"}`;
      const raw = await callAI([{ role: 'user', content: prompt }]);
      const data = JSON.parse(extractJSON(raw));
      if (data.title) setCustomTitle(data.title);
      if (data.subtitle) setCustomSubtitle(data.subtitle);
    } catch (err) {
      console.warn('[AI补全] 失败:', err);
    } finally {
      setIsCompleting(false);
    }
  };

  const handleComplete = async () => {
    setPhase('generating');
    setError('');
    try {
      const callAI = createCallAI();
      const { worldDef, worldBookEntries } = await generateWorldFromSelections(userDesc, selections, callAI);
      let modules: WorldModule[] = [];
      let moduleWorldBookEntries: WorldBookEntryDef[] = [];
      if (selectedModules.length > 0) {
        const result = await generateModuleEntries(worldDef.description || userDesc, selectedModules, callAI);
        modules = result.modules;
        moduleWorldBookEntries = result.worldBookEntries;
      }
      onComplete({
        id: `custom_${Date.now()}`,
        name: worldDef.name || '未命名世界',
        description: worldDef.description || '',
        icon: worldDef.icon || 'Globe',
        tags: worldDef.tags || [],
        difficulty: worldDef.difficulty || 'medium',
        entryId: null,
        modules: modules.length > 0 ? modules : undefined,
        worldBookEntries: [...worldBookEntries, ...moduleWorldBookEntries],
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(`生成世界失败：${err instanceof Error ? err.message : '未知错误'}`);
      setPhase('selecting');
    }
  };

  const handleNext = () => {
    if (!canProceed) return;
    if (isLastDimension) handleComplete();
    else setCurrentDimIndex(prev => prev + 1);
  };

  const handleClose = () => { abortRef.current?.abort(); onClose(); };
  const handleRetry = () => { setError(''); setAllOptions(null); setPhase('loading'); };

  return {
    phase, error, currentDimIndex, selections, allOptions,
    currentDim, isLastDimension, currentSelection, currentGeneration, canProceed,
    isEditingCustom, customTitle, customSubtitle, isCompleting,
    isCustomSelected, customChoice,
    handleSelect, handleSaveCustom, handleAIComplete, handleComplete,
    handleNext, handleClose, handleRetry,
    setCurrentDimIndex, setCustomTitle, setCustomSubtitle, setIsEditingCustom,
  };
}
