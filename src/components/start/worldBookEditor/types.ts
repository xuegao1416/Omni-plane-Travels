import type { WorldDef } from '../../../data/worlds-schema';
import type { EditModeEntry } from '@/types/worldbook';

export interface Props {
  world: WorldDef;
  onSave: (updated: WorldDef) => void;
}

export type { EditModeEntry };
