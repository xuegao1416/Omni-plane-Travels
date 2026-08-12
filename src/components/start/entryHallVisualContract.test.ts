import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const hallStyles = readFileSync(new URL('../../styles/entry-crystal.css', import.meta.url), 'utf8');

describe('entry hall visual contract', () => {
  test('defines the neutral hall, crystal states, and detail overlay surfaces', () => {
    for (const selector of [
      '.entry-hall',
      '.entry-hall-backdrop',
      '.entry-world-crystal:hover',
      '.entry-world-crystal.is-selected',
      '.entry-detail-layer',
      '.entry-detail-panel',
    ]) {
      expect(hallStyles).toContain(selector);
    }
  });

});
