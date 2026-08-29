import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const overlay = readFileSync(new URL('./CardOverlay.tsx', import.meta.url), 'utf8');
const journeyStyles = readFileSync(new URL('../../styles/game-journey.css', import.meta.url), 'utf8');

describe('mobile event card frame contract', () => {
  test('keeps the event content inside the framed viewport width', () => {
    expect(overlay).toContain('className="event-fade-in game-journey-card__event-content"');
    expect(overlay).not.toContain("width: 'min(460px, 92vw)'");
    expect(overlay).not.toContain("padding: 'var(--space-5)'");
    expect(journeyStyles).toContain('width: min(460px, calc(100vw - 48px));');
    expect(journeyStyles).toContain('.game-journey-card--event > .dawn-frame-v4__content > .game-journey-card__content');
    expect(journeyStyles).toContain('.game-journey-card__event-content');
    expect(journeyStyles).toContain('box-sizing: border-box;');
  });
});
