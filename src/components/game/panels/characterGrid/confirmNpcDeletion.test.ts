import { describe, expect, test } from 'bun:test';
import { confirmNpcDeletion } from './confirmNpcDeletion';

describe('NPC 删除确认', () => {
  test('取消时不删除，确认时只删除一次', async () => {
    let deleteCount = 0;
    const onDelete = () => { deleteCount += 1; };

    expect(await confirmNpcDeletion(async () => false, onDelete)).toBe(false);
    expect(deleteCount).toBe(0);

    expect(await confirmNpcDeletion(async () => true, onDelete)).toBe(true);
    expect(deleteCount).toBe(1);
  });
});
