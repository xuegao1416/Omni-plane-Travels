import { expect, test } from 'bun:test';
import { acceptDraft, appendDraft, draftSendBlockReason, editDraft, submitDraft, type ActionSender } from './draftSubmission';

test('busy and missing API refusals retain the exact player draft and give the reason', async () => {
  for (const reason of ['本轮仍在处理，请稍后发送', '请先配置 API']) {
    let draft = { text: '  查看门后的动静\n', revision: 3 };
    let refusal = '';
    const send: ActionSender = (_text, options) => { options?.onComplete?.({ success: false, error: reason }); };
    await submitDraft(draft.text, send, () => { draft = acceptDraft(draft, 3); }, error => { refusal = error; });
    expect(draft.text).toBe('  查看门后的动静\n');
    expect(refusal).toBe(reason);
  }
});

test('admission clears only the submitted revision, before long generation finishes', async () => {
  let finish!: () => void;
  let draft = { text: '开门', revision: 1 };
  const send: ActionSender = (_text, options) => {
    options?.onAccepted?.();
    return new Promise<void>(resolve => { finish = resolve; });
  };
  const submitting = submitDraft(draft.text, send, () => { draft = acceptDraft(draft, 1); }, () => {});
  expect(draft.text).toBe('');
  draft = editDraft(draft, '下一步检查窗户');
  finish(); await submitting;
  expect(draft.text).toBe('下一步检查窗户');
});

test('late admission cannot erase an edited draft, and generation failure cannot reject accepted input', async () => {
  let draft = { text: '开门', revision: 1 };
  let refusal = '';
  const send: ActionSender = (_text, options) => {
    draft = editDraft(draft, '改为敲门');
    options?.onAccepted?.();
    options?.onComplete?.({ success: false, error: '模型断线' });
  };
  await submitDraft('开门', send, () => { draft = acceptDraft(draft, 1); }, error => { refusal = error; });
  expect(draft.text).toBe('改为敲门');
  expect(refusal).toBe('');
});

test('unexpected rejection and absent admission both preserve drafts with visible feedback', async () => {
  for (const send of [(() => { throw new Error('连接失败'); }), (() => {})] satisfies ActionSender[]) {
    let accepted = false; let error = '';
    await submitDraft('查看', send, () => { accepted = true; }, reason => { error = reason; });
    expect(accepted).toBe(false); expect(error.length).toBeGreaterThan(0);
  }
});

test('choosing an action suggestion preserves an already composed next-step draft', () => {
  const draft = { text: '先观察周围  ', revision: 7 };
  const next = appendDraft(draft, '敲门');
  expect(next.text).toBe('先观察周围  \n敲门');
  expect(next.revision).toBe(8);
  expect(appendDraft({ text: '', revision: 0 }, '敲门').text).toBe('敲门');
});

test('saving departure blocks sending with its real reason without sealing the draft', () => {
  const reason = '正在保存旅程，请稍候。';
  expect(draftSendBlockReason({ externalBlockedReason: reason, isGenerating: false, readOnly: false })).toBe(reason);
  expect(draftSendBlockReason({ isGenerating: false, readOnly: false })).toBeNull();
});
