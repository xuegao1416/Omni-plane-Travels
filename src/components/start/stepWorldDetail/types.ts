import type { WorldDef } from '../../../data/worlds-schema';
import type { WorldBookEntry } from '../../../worldbook/index';

export interface StepWorldDetailProps {
  selectedWorld: string;
  allWorlds: WorldDef[];
  worldEntry: WorldBookEntry | null;
  onNext: () => void;
  onPrev: () => void;
  onEditWorld: (world: WorldDef) => void;
}
