import { expect, test } from 'bun:test';
import { mapStorageBatch } from './mapStorageBatch';

test('large histories bound active codecs and retain sequence order', async () => {
  let active = 0, peak = 0;
  const values = Array.from({ length: 200 }, (_, index) => index);
  const result = await mapStorageBatch(values, async value => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, value % 3));
    active--;
    return value * 2;
  });
  expect(peak).toBeLessThanOrEqual(4);
  expect(result).toEqual(values.map(value => value * 2));
});

test('codec failures reject the batch and empty histories allocate no workers', async () => {
  expect(await mapStorageBatch([], async () => { throw Error('unexpected'); })).toEqual([]);
  await expect(mapStorageBatch([1, 2], async value => { if (value === 2) throw Error('corrupt'); return value; })).rejects.toThrow('corrupt');
});
