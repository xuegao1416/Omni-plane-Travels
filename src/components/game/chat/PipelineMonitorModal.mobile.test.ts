import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const modal = readFileSync(new URL('./PipelineMonitorModal.tsx', import.meta.url), 'utf8');

describe('mobile pipeline monitor error display', () => {
  test('long stage errors are copyable and expandable instead of truncated', () => {
    // 移动端没有 F12，必须把完整报错交给用户：可复制
    expect(modal).toContain('复制');
    expect(modal).toContain('navigator.clipboard.writeText');
    // 可点开查看完整详情
    expect(modal).toContain('查看详情');
    // 完整错误以可换行、可滚动的块展示，而不是单行截断
    expect(modal).toContain('pre-wrap');
    expect(modal).toContain('wordBreak');
    // 不再使用单行截断写法
    expect(modal).not.toContain("white-space: 'nowrap'");
    expect(modal).not.toContain("textOverflow: 'ellipsis'");
  });
});
