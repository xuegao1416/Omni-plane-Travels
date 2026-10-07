import type { SendMessageOptions, SendMessageOutcome } from '../../../engine/types';

export type ActionSender = (text: string, options?: SendMessageOptions) => void | Promise<void | SendMessageOutcome>;
export interface PlayerDraft { text: string; revision: number }

export function draftSendBlockReason(state: { externalBlockedReason?: string; isGenerating: boolean; readOnly: boolean }): string | null {
  if (state.externalBlockedReason) return state.externalBlockedReason;
  if (state.readOnly) return '此存档已封存，不能继续旅程。';
  return state.isGenerating ? '本轮仍在处理，完成后即可发送。' : null;
}

export function editDraft(draft: PlayerDraft, text: string): PlayerDraft {
  return { text, revision: draft.revision + 1 };
}

export function appendDraft(draft: PlayerDraft, text: string): PlayerDraft {
  return editDraft(draft, draft.text.trim() ? `${draft.text}\n${text}` : text);
}

/** A delayed admission cannot clear the next action the player is already composing. */
export function acceptDraft(draft: PlayerDraft, submittedRevision: number): PlayerDraft {
  return draft.revision === submittedRevision ? editDraft(draft, '') : draft;
}

/** Admission and eventual generation completion have different effects on the composer. */
export async function submitDraft(text: string, send: ActionSender, onAccepted: () => void, onRejected: (reason: string) => void): Promise<void> {
  let accepted = false;
  let rejected = false;
  const reject = (reason?: string) => {
    if (accepted || rejected) return;
    rejected = true;
    onRejected(reason || '行动尚未被接纳，草稿已保留，请稍后重试。');
  };
  try {
    const outcome = await send(text.trim(), {
      onAccepted: () => {
        if (accepted || rejected) return;
        accepted = true;
        onAccepted();
      },
      onComplete: outcome => { if (!outcome.success) reject(outcome.error); },
    });
    if (!accepted) reject(outcome?.error);
  } catch (error) {
    reject(error instanceof Error ? error.message : String(error));
  }
}
