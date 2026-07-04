import type { GameEngine } from '../../../../engine/types';
import type { EditModeEntry } from '@/types/worldbook';

export interface InGameWorldBookEditorProps {
  engine: GameEngine;
  worldId: string;
  onClose: () => void;
}

/** 编辑态条目别名（兼容现有代码） */
export type EditEntry = EditModeEntry;
