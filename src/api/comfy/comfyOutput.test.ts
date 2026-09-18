import { describe, expect, test } from 'bun:test';
import {
  findComfyExecutionError,
  findComfyImageOutput,
  formatComfyExecutionError,
} from './comfyOutput';

describe('ComfyUI output parsing', () => {
  test('keeps standard SaveImage/PreviewImage history output compatible', () => {
    expect(findComfyImageOutput({
      '9': { images: [{ filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }] },
    })).toEqual({ filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' });
  });

  test('ignores unrelated node outputs before finding an image', () => {
    expect(findComfyImageOutput({
      '1': { text: ['done'] },
      '2': { images: [{ filename: 'preview.png', type: 'temp' }] },
    })).toEqual({ filename: 'preview.png', subfolder: undefined, type: 'temp' });
  });

  test('extracts execution_error details from history status messages', () => {
    const error = findComfyExecutionError({
      outputs: {},
      status: { messages: [['execution_error', {
        node_id: '12',
        node_type: 'KSampler',
        exception_message: 'CUDA out of memory',
      }]] },
    });
    expect(error).toEqual({
      nodeId: '12',
      nodeType: 'KSampler',
      exceptionMessage: 'CUDA out of memory',
      exceptionType: undefined,
    });
    expect(formatComfyExecutionError(error!)).toContain('节点 12 (KSampler)');
    expect(formatComfyExecutionError(error!)).toContain('CUDA out of memory');
  });
});
