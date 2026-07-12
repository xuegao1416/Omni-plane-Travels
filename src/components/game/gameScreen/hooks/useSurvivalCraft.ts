import { useState, useCallback } from 'react';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { ApiConfig } from '../../../../api/types';
import type { SurvivalRecipe } from '../../../../modules/schema';

export function useSurvivalCraft(
  engine: GameEngine,
  apiConfig: ApiConfig | null,
  worldDef: WorldDef | undefined,
  setNotification: (msg: string | null) => void,
  bumpVersion: () => void,
) {
  const [isGeneratingRecipe, setIsGeneratingRecipe] = useState(false);
  // 从存档恢复：读档后 runtimeRecipes 由 gameState.玩家.生存配方 还原
  const [runtimeRecipes, setRuntimeRecipes] = useState<SurvivalRecipe[]>(
    () => engine.variableManager.getState().玩家?.生存配方 ?? []
  );

  /** 把运行时配方同步写回 gameState（随存档持久化） */
  const persistRecipes = useCallback((recipes: SurvivalRecipe[]) => {
    const state = engine.variableManager.getState();
    if (!state.玩家) return;
    state.玩家.生存配方 = recipes;
    engine.variableManager.setState(state);
    bumpVersion();
  }, [engine, bumpVersion]);

  const handleSurvivalCraft = useCallback((recipe: SurvivalRecipe) => {
    const state = engine.variableManager.getState();
    const resources = state.玩家?.生存资源;
    if (!resources) return;

    // 检查资源是否足够
    for (const [resId, need] of Object.entries(recipe.inputs)) {
      const res = resources[resId];
      if (!res || res.数量 < need) return;
    }

    // 消耗材料
    for (const [resId, need] of Object.entries(recipe.inputs)) {
      const res = resources[resId];
      if (res) res.数量 -= need;
    }

    // 产出产品
    const outputId = recipe.output.resourceId;
    const outputAmount = recipe.output.amount;
    const outputRes = resources[outputId];
    if (outputRes) {
      outputRes.数量 += outputAmount;
    } else {
      resources[outputId] = { 数量: outputAmount };
    }

    engine.variableManager.setState(state);
    bumpVersion();
  }, [engine, bumpVersion]);

  const handleSurvivalGenerateRecipe = useCallback(async (request: string) => {
    if (!apiConfig) return;
    setIsGeneratingRecipe(true);
    try {
      const { buildRecipeGenPrompt } = await import('../../../../modules/prompts');
      const state = engine.variableManager.getState();
      const resources = state.玩家?.生存资源 || {};

      // 从世界定义获取资源名称映射（id → 中文名）
      const survivalMod = worldDef?.modules?.find(m => m.moduleId === 'survival' && m.enabled)?.moduleConfig as
        | { resources?: Array<{ id: string; name?: string; symbol?: string }> }
        | undefined;
      const nameMap = new Map<string, string>();
      if (survivalMod?.resources) {
        for (const r of survivalMod.resources) {
          nameMap.set(r.id, r.name || r.id);
        }
      }
      // 追加运行时资源的中文名（演化新增的资源在运行时携带 name）
      for (const [id, r] of Object.entries(resources)) {
        if (r.name && !nameMap.has(id)) nameMap.set(id, r.name);
      }

      const currentResources = Object.entries(resources).map(([id, r]) => ({
        id, name: nameMap.get(id) || id, amount: r.数量, max: r.最大值 ?? 9999,
      }));
      // 社会环境已移至世界演化系统，使用默认主题
      const worldTheme = '生存世界';

      const prompt = buildRecipeGenPrompt({ currentResources, playerRequest: request, worldTheme });
      const { requestStreamWithRetry } = await import('../../../../api/client');
      const result = await requestStreamWithRetry(apiConfig, [
        { role: 'user', content: prompt },
      ], { signal: new AbortController().signal, onDelta: () => {} });

      const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/) || result.text.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) {
        setNotification('配方生成失败：AI 未返回有效 JSON');
        return;
      }

      const { normalizeRecipeInputs, normalizeRecipeOutput } = await import('../../../../utils/formatNormalize');
      const fixed = jsonMatch[1].trim()
        .replace(/[""]/g, '"')
        .replace(/['']/g, "'")
        .replace(/、/g, ',');
      const raw = JSON.parse(fixed);

      const recipe: SurvivalRecipe = {
        id: String(raw.id || `recipe_${Date.now()}`),
        name: String(raw.name || '未知配方'),
        inputs: normalizeRecipeInputs(raw.inputs),
        output: normalizeRecipeOutput(raw.output),
        description: String(raw.description || ''),
      };

      if (!recipe.output.resourceId || recipe.output.amount <= 0) {
        setNotification('配方生成失败：输出格式无效');
        return;
      }

      // 校验 inputs：同时从静态模块定义和运行时变量中读取合法 id
      // 运行时可能包含演化新增的资源
      const validIds = new Set<string>();
      if (survivalMod?.resources) {
        for (const r of survivalMod.resources) validIds.add(r.id);
      }
      // 追加运行时已存在的资源 id（演化新增的资源在这里）
      for (const id of Object.keys(resources)) {
        validIds.add(id);
      }
      const unknownInputs = Object.keys(recipe.inputs).filter(k => !validIds.has(k));
      if (unknownInputs.length > 0) {
        setNotification(`配方生成失败：AI 使用了不存在的材料「${unknownInputs.join('、')}」，请重试`);
        return;
      }

      // 产出也必须落在已有资源集合内：不能凭空造出尚未出现在世界中的资源
      // （例如石器时代点"创建蒸汽机"应被拒绝，提示当前资源不满足）
      if (!validIds.has(recipe.output.resourceId)) {
        setNotification(`当前资源不满足：无法制作「${recipe.output.resourceId}」，该资源尚未出现在世界中（只能使用已有资源制作）`);
        return;
      }

      setRuntimeRecipes(prev => {
        const next = [...prev, recipe];
        persistRecipes(next);
        return next;
      });
      setNotification(`配方「${recipe.name}」已创建`);
    } catch (err) {
      console.warn('[配方生成] 失败:', err);
      setNotification(`配方生成失败：${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setIsGeneratingRecipe(false);
    }
  }, [engine, apiConfig, worldDef, setNotification]);

  const handleSurvivalDeleteRecipe = useCallback((recipeId: string) => {
    setRuntimeRecipes(prev => {
      const next = prev.filter(r => r.id !== recipeId);
      persistRecipes(next);
      return next;
    });
  }, [persistRecipes]);

  return {
    runtimeRecipes,
    isGeneratingRecipe,
    handleSurvivalCraft,
    handleSurvivalGenerateRecipe,
    handleSurvivalDeleteRecipe,
  };
}
