import type { GameState } from '../../../schema/variables';
import { CustomModuleView } from '../../../custom-modules/viewRenderer';
import '../../../ui/screens/module-workshop.css';

interface Props {
  gameState: GameState;
  worldId?: string;
  onButton?: (moduleId: string, event: string) => void;
}

/**
 * 存档里固定的模块定义决定面板内容；模块库里的修改不会改动正在进行的游戏。
 * 游戏里只有右栏放得下模块面板：选了左栏（left-panel）的模块也显示在这里，排在右栏模块之后。
 */
export function CustomModulePanel({ gameState, onButton }: Props) {
  const modules = Object.entries(gameState.customModules ?? {})
    .filter(([, state]) => state.enabled && state.definition?.view)
    .sort(([, left], [, right]) => Number(left.definition!.view!.slot !== 'right-panel') - Number(right.definition!.view!.slot !== 'right-panel'));
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
