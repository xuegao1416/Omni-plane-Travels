import { useState, useEffect, useCallback, useRef } from 'react';
import type { WorldDef, WorldBookEntryDef, WorldModule } from '../../../data/worlds-schema';
import type { DimensionChoice, DimensionGeneration, DimensionSelection } from '../../../worldgen/choice';
import { generateWorldFromSelections, generateModuleEntries } from '../../../worldgen/choice';
import { requestStreamWithRetry, requestCompletion } from '../../../api/client';
import { GUIDED_DIMENSIONS } from './dimensions';
import { generateGuidedOptions, regenerateDimensionOptions, extractJSON } from './helpers';

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
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [generationHistory, setGenerationHistory] = useState<Record<string, DimensionGeneration[]>>({});
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

  const createCallAI = useCallback((opts?: { stream?: boolean }) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const useStream = opts?.stream ?? false;
    return async (messages: Array<{ role: string; content: string }>): Promise<string> => {
      if (useStream) {
        const result = await requestStreamWithRetry(apiConfig, messages as any, {
          signal: ctrl.signal,
          onDelta: () => {},
        });
        return result.text;
      }
      // 非流式：完整接收后再返回，避免 JSON 被截断
      const result = await requestCompletion(apiConfig, messages as any, {
        signal: ctrl.signal,
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

  const handleRegenerate = async () => {
    if (!currentDim || isRegenerating) return;
    setIsRegenerating(true);
    try {
      const callAI = createCallAI();
      const prevSelections = selections.filter(s => s.dimensionKey !== currentDim.key);
      const newGen = await regenerateDimensionOptions(userDesc, currentDim.key, currentDim.label, prevSelections, callAI);
      // 把当前选项存入历史
      if (currentGeneration) {
        setGenerationHistory(prev => ({
          ...prev,
          [currentDim.key]: [...(prev[currentDim.key] || []), currentGeneration],
        }));
      }
      // 替换当前选项
      setAllOptions(prev => prev ? { ...prev, [currentDim.key]: newGen } : prev);
      // 清除该维度的已选（因为选项换了）
      setSelections(prev => prev.filter(s => s.dimensionKey !== currentDim.key));
      setIsEditingCustom(false);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.warn('[重新生成] 失败:', err);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleUndoRegenerate = () => {
    if (!currentDim) return;
    const history = generationHistory[currentDim.key];
    if (!history || history.length === 0) return;
    const prev = history[history.length - 1];
    setGenerationHistory(h => ({
      ...h,
      [currentDim.key]: h[currentDim.key]?.slice(0, -1) || [],
    }));
    setAllOptions(opts => opts ? { ...opts, [currentDim.key]: prev } : opts);
    setSelections(sel => sel.filter(s => s.dimensionKey !== currentDim.key));
    setIsEditingCustom(false);
  };

  const hasHistory = !!(currentDim && generationHistory[currentDim.key]?.length);

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
    isRegenerating, hasHistory,
    handleSelect, handleSaveCustom, handleAIComplete, handleComplete,
    handleNext, handleClose, handleRetry,
    handleRegenerate, handleUndoRegenerate,
    setCurrentDimIndex, setCustomTitle, setCustomSubtitle, setIsEditingCustom,
  };
}
