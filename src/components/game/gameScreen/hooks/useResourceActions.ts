import { useState, useRef, useEffect, useCallback } from 'react';
import type { GameEngine } from '../../../../engine/types';
import type { WorldDef } from '../../../../data/worlds-schema';
import type { ApiConfig } from '../../../../api/types';
import { ResourcePlayerActions, resourceReadSet } from '../../../../domains/resources/playerActions';
import { useSaveStore } from '../../../../stores/saveStore';
import { recoveryVersion } from '../../../../engine/turnRecovery';

/** 物资面板的玩家操作。计算全部在资源模块里，界面只传 id。 */
export function useResourceActions(
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
  const serviceRef = useRef<ResourcePlayerActions | null>(null);
  if (!serviceRef.current) serviceRef.current = new ResourcePlayerActions({
    getEngine: () => current.current.engine,
    getWorld: () => current.current.worldDef,
    getSaveId: () => useSaveStore.getState().currentSaveId,
    getApiConfig: () => current.current.apiConfig,
    publish: text => current.current.setNotification(text),
    busy: setIsGeneratingRecipe,
    accepted: () => current.current.bumpVersion(),
  });
  const service = serviceRef.current;
  const worldVersion = recoveryVersion(worldDef);
  const resourcesVersion = recoveryVersion(resourceReadSet(engine.variableManager.getState(), worldDef));
  useEffect(() => { service.activate(); return () => service.dispose(); }, [service]);
  useEffect(() => { service.cancelIfInvalid(); }, [service, saveId, engine.variableManager, engine.isGenerating, engine.isReadOnly, worldVersion, resourcesVersion]);

  const gather = useCallback((resourceId: string) => { service.perform({ type: 'gather', resourceId }); }, [service]);
  const craft = useCallback((recipeId: string) => { service.perform({ type: 'craft', recipeId }); }, [service]);
  const unlockRecipe = useCallback((recipeId: string) => { service.perform({ type: 'unlock-recipe', recipeId }); }, [service]);
  const removeRecipe = useCallback((recipeId: string) => { service.perform({ type: 'delete-recipe', recipeId }); }, [service]);
  const generateRecipe = useCallback(async (request: string) => (await service.generate(request)).status === 'accepted', [service]);

  return { isGeneratingRecipe, gather, craft, unlockRecipe, removeRecipe, generateRecipe, cancelRecipeGeneration: service.cancel };
}
