import type { GameState } from '../../../schema/variables';
import { CustomModuleView } from '../../../custom-modules/viewRenderer';
import '../../../styles/custom-modules.css';

interface Props {
  gameState: GameState;
  worldId?: string;
  onButton?: (moduleId: string, event: string) => void;
}

/** The save owns definitions; registry edits never alter a running panel. */
export function CustomModulePanel({ gameState, onButton }: Props) {
  const modules = Object.entries(gameState.customModules ?? {}).filter(([, state]) => state.enabled && state.definition?.view?.slot === 'right-panel');
  return <>
    {gameState.customModuleBindingWarnings?.map(warning => <p key={warning} role="status">{warning}</p>)}
    {modules.map(([id, state]) => <CustomModuleView
      key={id}
      view={state.definition!.view}
      values={state.values}
      onEvent={event => onButton?.(id, event)}
    />)}
  </>;
}
