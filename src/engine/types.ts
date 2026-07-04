import type { ReactNode } from 'react';
import type { VariableManager } from './variableManager';
import type { WorldBookManager } from '../worldbook/index';
import type { GameSave, PlayerProfile, CustomNpc } from '../storage/db';
import type { PipelineStatus, PipelineTaskId } from './pipelineTypes';
import type { WorldDef } from '../data/worlds-schema';

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
}

export interface GameEngine {
  sendMessage: (userText: string) => Promise<void>;
  cancel: () => void;
  isGenerating: boolean;
  messages: ChatMessage[];
  variableManager: VariableManager;
  worldBook: WorldBookManager | null;
  pipelineStatus: PipelineStatus | null;
  deleteSingleMessage: (id: string) => void;
  editMessage: (id: string, content: string) => void;
  resendFromMessage: (id: string) => Promise<void>;
  resendFromAssistantMessage: (id: string) => Promise<void>;
  loadSave: (save: GameSave) => void;
  reset: (worldDef?: WorldDef) => void;
  setPlayerProfile: (profile: PlayerProfile) => void;
  applyModuleInitData: (moduleInitData: Record<string, unknown>) => void;
  setInitialNPCs: (npcs: CustomNpc[]) => void;
  addMessage: (msg: ChatMessage) => void;
  retryPipeline: () => Promise<void>;
  retrySingleStage: (taskId: PipelineTaskId) => Promise<void>;
  DialogUI: ReactNode;
}
