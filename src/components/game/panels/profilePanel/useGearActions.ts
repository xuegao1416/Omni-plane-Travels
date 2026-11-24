import { useCallback, useEffect, useState } from 'react';
import type { SlotKind } from '../../../../domains/equipment/slots';
import type { ProfileCommand } from './types';

export type GearSheet =
  | { kind: 'item'; key: string }
  | { kind: 'slot'; slot: string }
  | { kind: 'bag'; key: string };

export type GearDrag = { kind: 'item'; key: string; slotKind: SlotKind } | { kind: 'slot'; slot: string };

export interface GearFeedback {
  tone: 'ok' | 'error';
  text: string;
  /** 显示在哪：装备区、行囊区，或仍打开着的详情浮层里。 */
  at: 'gear' | 'pack' | 'sheet';
}

/** 人物档案里装备与行囊共用的交互状态：打开的详情、拖拽、命令结果提示。 */
export function useGearActions(onCommand?: ProfileCommand) {
  const [sheet, setSheet] = useState<GearSheet | null>(null);
  const [drag, setDrag] = useState<GearDrag | null>(null);
  const [feedback, setFeedback] = useState<GearFeedback | null>(null);

  useEffect(() => {
    if (!feedback || feedback.at === 'sheet') return;
    const timer = window.setTimeout(() => setFeedback(null), 3600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  /** 执行命令；成功时关闭详情并在 successAt 区域提示，失败时提示留在原处。 */
  const run = useCallback((command: string, args: Record<string, unknown>, label: string, successAt: 'gear' | 'pack', fromSheet: boolean) => {
    if (!onCommand) {
      setFeedback({ tone: 'error', text: '当前旅程只能查看，不能整理装备。', at: fromSheet ? 'sheet' : successAt });
      return false;
    }
    const result = onCommand(command, args, label);
    if (result.ok) {
      setSheet(null);
      setFeedback({ tone: 'ok', text: result.feedback || label, at: successAt });
    } else {
      setFeedback({ tone: 'error', text: result.feedback, at: fromSheet ? 'sheet' : successAt });
    }
    return result.ok;
  }, [onCommand]);

  const open = useCallback((next: GearSheet | null) => {
    setSheet(next);
    setFeedback(current => (current?.at === 'sheet' ? null : current));
  }, []);

  return { sheet, open, drag, setDrag, feedback, run, canAct: Boolean(onCommand) };
}
