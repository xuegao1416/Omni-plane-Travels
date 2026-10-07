import { expect, test } from 'bun:test';
import { PipelineExecutor } from './pipelineExecutor';
import { createPipelineStatus } from './pipelineTypes';
import { readTurnRecovery } from './turnRecovery';

test('malformed imported recovery never throws during ordinary save loading', () => {
  const invalid = { version: 1, worldId: 'default', saveId: 'save', aiMsgId: 'ai', round: 1,
    userText: '', rawText: '', stateVersion: '', memoryVersion: '',
    result: { mainResult: { parsed: { content: 123 } }, status: createPipelineStatus(1) } };
  expect(() => readTurnRecovery(invalid)).not.toThrow();
  expect(readTurnRecovery(invalid)).toBeNull();
});

test('retry timing excludes time spent outside the interrupted pipeline', async () => {
  const now = Date.now;
  let clock = 1000;
  Date.now = () => clock;
  try {
    const status = createPipelineStatus(1);
    status.stages.main = { label: '正文生成', status: 'success', startTime: 1000, endTime: 1100 };
    status.stages.settlement.status = 'error';
    const executor = new PipelineExecutor(1, { onUpdate: () => {} }, { status, mainResult: null });
    clock = 60000;
    await executor.retryStage('settlement', async () => { clock += 20; });
    expect(executor.getStatus().endTime! - executor.getStatus().startTime).toBe(120);
  } finally { Date.now = now; }
});
