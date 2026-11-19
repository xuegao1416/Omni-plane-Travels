import { readFileSync } from 'node:fs';
import { describe,expect,test } from 'bun:test';

const hallStyles = readFileSync(new URL('../../styles/planar-entry.css', import.meta.url), 'utf8');

describe('entry hall visual contract', () => {
  test('defines the planar hall shell, navigation and world dive surfaces', () => {
    for (const selector of [
      '.pl-hall',
      '.pl-hall__bar',
      '.pl-hall__nav',
      '.pl-hall__vignette',
      '.pl-dive__frame',
      '.pl-dive__body',
    ]) {
      expect(hallStyles).toContain(selector);
    }
  });
});
