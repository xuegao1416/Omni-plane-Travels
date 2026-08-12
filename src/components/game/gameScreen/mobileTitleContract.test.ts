import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('mobile journey title contract', () => {
  test('keeps the header title and hides the duplicate narrative banner on mobile', () => {
    const mobileLayout = read('./MobileLayout.tsx');
    const chatPanel = read('../chat/ChatPanel.tsx');
    const styles = read('../../../styles/game-journey.css');

    expect(mobileLayout).toContain('mobile-header-title');
    expect(chatPanel).toContain('game-journey__narrative-banner');
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*\.game-journey__narrative-banner\s*\{[^}]*display:\s*none/);
  });
});
