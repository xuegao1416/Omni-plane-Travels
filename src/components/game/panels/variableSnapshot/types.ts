import type { GameState } from '../../../../schema/variables';
import type { VariableManager } from '../../../../engine/variableManager';
import type { ChatMessage } from '../../../../engine/types';
import type { SnapshotLayer } from '../../shared/snapshotUtils';
export { formatTime, getSnapshotPreview } from '../../shared/snapshotUtils';

// ── 面板 Props ──
export interface VariableSnapshotPanelProps {
  messages: ChatMessage[];
  varMgr: VariableManager;
  onRollbackToSnapshot: (msgIndex: number) => void;
  onSave?: () => void;
  onPrepareStateJSON: (json: string) => GameState | null;
  onIsCurrent?: () => boolean;
  onCommitState: (next: GameState) => boolean | Promise<boolean>;
}

// Re-export SnapshotLayer type for consumers
export type { SnapshotLayer };
