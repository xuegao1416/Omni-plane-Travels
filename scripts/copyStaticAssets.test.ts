import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDirectoryContents } from './copyStaticAssets';

describe('copyDirectoryContents', () => {
  test('copies nested static files while preserving relative paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'omni-plane-assets-'));
    const source = join(root, 'source');
    const destination = join(root, 'destination');
    const nested = join(source, 'art', 'theme');

    try {
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, 'anchor.png'), 'asset');
      copyDirectoryContents(source, destination);
      expect(readFileSync(join(destination, 'art', 'theme', 'anchor.png'), 'utf8')).toBe('asset');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
