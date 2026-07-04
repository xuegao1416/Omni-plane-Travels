import type { GameState } from '../../../../schema/variables';
import type { VariableManager } from '../../../../engine/variableManager';
import type { ChatMessage } from '../../../../engine/types';
import type { SnapshotLayer } from '../../shared/snapshotUtils';
export { formatTime, getSnapshotPreview } from '../../shared/snapshotUtils';

// ── 面板 Props ──
export interface VariableSnapshotPanelProps {
  messages: ChatMessage[];
  varMgr: VariableManager;
  onRestoreSnapshot?: (snapshot: GameState) => void;
  onSave?: () => void;
}

// Re-export SnapshotLayer type for consumers
export type { SnapshotLayer };
