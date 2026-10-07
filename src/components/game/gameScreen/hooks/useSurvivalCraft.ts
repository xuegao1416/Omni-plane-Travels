import { useState, useRef, useEffect, useCallback } from 'react';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { ApiConfig } from '../../../../api/types';
import type { SurvivalRecipe } from '../../../../modules/schema';
import { SurvivalPlayerActions, survivalResourceReadSet } from '../../../../gameplay/survivalPlayerActions';
import { useSaveStore } from '../../../../stores/saveStore';
import { recoveryVersion } from '../../../../engine/turnRecovery';

export function useSurvivalCraft(
  engine: GameEngine,
  apiConfig: ApiConfig | null,
  worldDef: WorldDef | undefined,
  setNotification: (msg: string | null) => void,
  bumpVersion: () => void,
) {
  const [isGeneratingRecipe, setIsGeneratingRecipe] = useState(false);
  const saveId = useSaveStore(state => state.currentSaveId);
  const current = useRef({ engine, apiConfig, worldDef, setNotification, bumpVersion });
  current.current = { engine, apiConfig, worldDef, setNotification, bumpVersion };
  const serviceRef = useRef<SurvivalPlayerActions | null>(null);
  if (!serviceRef.current) serviceRef.current = new SurvivalPlayerActions({
    getEngine: () => current.current.engine,
    getWorld: () => current.current.worldDef,
    getSaveId: () => useSaveStore.getState().currentSaveId,
    getApiConfig: () => current.current.apiConfig,
    publish: text => current.current.setNotification(text),
    busy: setIsGeneratingRecipe,
    accepted: () => current.current.bumpVersion(),
  });
  const service = serviceRef.current;
  const state = engine.variableManager.getState();
  // The saved game state is the sole recipe owner; renders only read its projection.
  const runtimeRecipes = state.玩家.生存配方 ?? [];
  const worldVersion = recoveryVersion(worldDef), resourcesVersion = recoveryVersion(survivalResourceReadSet(state, worldDef));
  useEffect(() => { service.activate(); return () => service.dispose(); }, [service]);
  useEffect(() => { service.cancelIfInvalid(); }, [service, saveId, engine.variableManager, engine.isGenerating, engine.isReadOnly, worldVersion, resourcesVersion]);

  const handleSurvivalCraft = useCallback((recipe: SurvivalRecipe) => { service.perform({ type: 'craft', recipeId: recipe.id }); }, [service]);
  const handleSurvivalUnlockRecipe = useCallback((recipe: SurvivalRecipe) => { service.perform({ type: 'unlock-recipe', recipeId: recipe.id }); }, [service]);
  const handleSurvivalGather = useCallback((resourceId: string) => { service.perform({ type: 'gather', resourceId }); }, [service]);
  const handleSurvivalGenerateRecipe = useCallback(async (request: string) => (await service.generate(request)).status === 'accepted', [service]);
  const handleSurvivalDeleteRecipe = useCallback((recipeId: string) => { service.perform({ type: 'delete-recipe', recipeId }); }, [service]);

  return { runtimeRecipes, isGeneratingRecipe, handleSurvivalCraft, handleSurvivalUnlockRecipe, handleSurvivalGather,
    handleSurvivalGenerateRecipe, handleSurvivalDeleteRecipe, cancelSurvivalRecipeGeneration: service.cancel };
}
