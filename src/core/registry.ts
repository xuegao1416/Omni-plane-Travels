/**
 * 内置玩法模块清单与宿主工厂。新增模块只需在这里登记。
 */
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { GameplayHost, type GameplayModule } from './host';
import { coreModule } from './coreModule';
import { resourcesModule } from '../domains/resources/module';
import { economyModule } from '../domains/economy/module';
import { eventsModule } from '../events/module';
import { statsModule } from '../domains/stats/module';
import { progressionModule } from '../domains/progression/module';
import { diceModule } from '../domains/dice/module';
import { abilitiesModule } from '../domains/abilities/module';

export const BUILTIN_GAMEPLAY_MODULES: readonly GameplayModule<any>[] = [
  coreModule, statsModule, progressionModule, diceModule, abilitiesModule, resourcesModule, economyModule, eventsModule,
];

export function createGameplayHost(world: WorldDef | undefined, state: GameState, modules: readonly GameplayModule<any>[] = BUILTIN_GAMEPLAY_MODULES): GameplayHost {
  return new GameplayHost(world, modules, state);
}
