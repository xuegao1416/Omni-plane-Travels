import { useEffect, useState } from 'react';
import type { GameState } from '../../../schema/variables';
import { createInitialCustomModuleState } from '../../../custom-modules/stateStore';
import { getCustomGameplayModulesForWorld, type StoredCustomGameplayModule } from '../../../custom-modules/storage';
import { CustomModuleView } from '../../../custom-modules/viewRenderer';
import '../../../styles/custom-modules.css';

interface Props {
  gameState: GameState;
  worldId?: string;
  onButton?: (moduleId: string, event: string) => void;
}

export function CustomModulePanel({ gameState, worldId, onButton }: Props) {
  const [modules, setModules] = useState<StoredCustomGameplayModule[]>([]);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      if (!worldId) return;
      getCustomGameplayModulesForWorld(worldId)
        .then((records) => { if (!cancelled) setModules(records.filter((record) => record.module.view?.slot === 'right-panel')); })
        .catch((error) => console.warn('[CustomModules] 无法加载可视模块:', error));
    };
    if (!worldId) {
      setModules([]);
      return () => { cancelled = true; };
    }
    reload();
    window.addEventListener('custom-modules-changed', reload);
    return () => { cancelled = true; window.removeEventListener('custom-modules-changed', reload); };
  }, [worldId]);

  if (modules.length === 0) return null;

  return <>
    {modules.map((record) => {
      const state = gameState.customModules?.[record.module.id] ?? createInitialCustomModuleState(record.module);
      return <CustomModuleView
        key={record.module.id}
        view={record.module.view}
        values={state.values}
        onEvent={(event) => onButton?.(record.module.id, event)}
      />;
    })}
  </>;
}
