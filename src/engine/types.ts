import type { ReactNode } from 'react';
import type { VariableManager } from './variableManager';
import type { WorldBookManager } from '../worldbook/index';
import type { GameSave, PlayerProfile, CustomNpc } from '../storage/db';
import type { PipelineStatus, PipelineTaskId } from './pipelineTypes';
import type { WorldDef } from '../data/worlds-schema';
import type { GameState } from '../schema/variables';
import type { CombatCheckpointRestore } from '../gameplay/combatV2';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** 完整 API 响应（唯一存储源）。用户消息则为用户输入文本。 */
  rawText: string;
  /** 摘要（可选，用于老消息压缩，很短） */
  summary?: string;
  round: number;
  timestamp: number;
  streaming?: boolean;
  snapshot?: unknown;
  snapshotTime?: number;
  memoryCheckpointId?: string;
  /** 世界演化引擎快照 ID */
  simulationSnapshotId?: string;
  /**
   * 消息序号（单调递增，用于增量存档）
   * 在消息创建时由引擎分配，确保存档时 seq 对齐
   */
  seq?: number;
}

export interface SendMessageOutcome {
  success: boolean;
  /** Normalized narrative actually written to the assistant message. */
  content?: string;
  error?: string;
}

export interface SendMessageOptions {
  /** Internal continuation text is sent to the model without a visible user bubble. */
  displayUserMessage?: boolean;
  /** Combat-owned state is restored after variable extraction/normal narration stages. */
  combatContinuation?: { protectedState: GameState; fallbackText?: string };
  onComplete?: (outcome: SendMessageOutcome) => void;
}

export interface GameEngine {
  sendMessage: (userText: string, options?: SendMessageOptions) => Promise<void>;
  cancel: () => void;
  readonly isReadOnly: boolean;
  isGenerating: boolean;
  messages: ChatMessage[];
  variableManager: VariableManager;
  worldBook: WorldBookManager | null;
  pipelineStatus: PipelineStatus | null;
  deleteSingleMessage: (id: string) => void;
  editMessage: (id: string, content: string) => void;
  resendFromMessage: (id: string) => Promise<void>;
  resendFromAssistantMessage: (id: string) => Promise<void>;
  rollbackToSnapshot: (msgIndex: number) => void;
  loadSave: (save: GameSave) => void;
  restoreCombatCheckpoint: (restore: CombatCheckpointRestore, saveId?: string) => void;
  reset: (worldDef?: WorldDef) => void;
  setPlayerProfile: (profile: PlayerProfile) => void;
  applyModuleInitData: (moduleInitData: Record<string, unknown>) => void;
  setInitialNPCs: (npcs: CustomNpc[]) => void;
  addMessage: (msg: ChatMessage) => void;
  retryPipeline: () => Promise<void>;
  retrySingleStage: (taskId: PipelineTaskId) => Promise<void>;
  DialogUI: ReactNode;
}
