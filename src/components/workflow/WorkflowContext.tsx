// ============================================================
//  工作流上下文 — 通过 React Context 传递 worldDef / eventPackId 等
// ============================================================
import { createContext, useContext } from 'react';
import type { WorldDef } from '../../data/worlds-schema';
import type { GameState } from '../../schema/variables';

export interface WorkflowContextValue {
  worldDef?: WorldDef;
  eventPackId?: string | null;
  gameState?: GameState;
  onWidgetChange?: (nodeId: string, socketKey: string, value: unknown) => void;
}

const WorkflowCtx = createContext<WorkflowContextValue>({});

export const WorkflowProvider = WorkflowCtx.Provider;

export function useWorkflowCtx(): WorkflowContextValue {
  return useContext(WorkflowCtx);
}
