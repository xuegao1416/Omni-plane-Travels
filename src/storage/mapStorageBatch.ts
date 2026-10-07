/** Bound temporary buffers from hashing, compression and decompression. */
export async function mapStorageBatch<T, R>(values: readonly T[], transform: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      output[index] = await transform(values[index]!, index);
    }
  }));
  return output;
}
