import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { sealResult, unsealResult, isSealed } from './keyVault';

test('strict vault results distinguish an empty key, legacy plaintext, and unreadable ciphertext', async () => {
  expect(await unsealResult('')).toEqual({ status: 'empty', value: '' });
  expect(await unsealResult('legacy-fake-key')).toEqual({ status: 'plaintext', value: 'legacy-fake-key' });
  expect((await unsealResult('enc:v1:corrupted')).status).toBe('error');
});
test('strict vault stores encrypted fake keys and decrypts only in memory', async () => {
  const encoded = await sealResult('synthetic-connection-key');
  expect(encoded.status).toBe('encrypted');
  if (encoded.status !== 'encrypted') throw new Error('Web Crypto expected in this test');
  expect(isSealed(encoded.value)).toBe(true); expect(encoded.value).not.toContain('synthetic-connection-key');
  expect(await unsealResult(encoded.value)).toEqual({ status: 'ok', value: 'synthetic-connection-key' });
});
