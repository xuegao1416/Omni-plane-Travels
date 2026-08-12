import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const hall = readFileSync(new URL('./WorldHallView.tsx', import.meta.url), 'utf8');
const start = readFileSync(new URL('./StartScreen.tsx', import.meta.url), 'utf8');
const rightPanel = readFileSync(new URL('../game/panels/RightPanel.tsx', import.meta.url), 'utf8');
const gameScreen = readFileSync(new URL('../game/GameScreen.tsx', import.meta.url), 'utf8');

test('hall exposes deletion only for custom world detail and uses a confirmation boundary', () => {
  expect(hall).toContain('entry-detail-delete-world');
  expect(hall).toContain('isCustom && <button');
  expect(hall).toContain('onDeleteWorld');
  expect(start).toContain('onDeleteWorld={h.handleDeleteWorld}');
});

test('empty node carries the same slot variant metadata as populated nodes', () => {
  expect(hall).toContain('data-base-variant={BASE_VARIANTS[index] ?? 0}');
  expect(hall).toContain('data-crystal={variant}');
  expect(hall).toContain('data-layout-origin="bottom center"');
});

test('right status panel keeps data modules but no longer mounts the portrait overview card', () => {
  expect(rightPanel).toContain('CustomModulePanel');
  expect(rightPanel).toContain('数值属性卡片');
  expect(rightPanel).not.toContain("from '../shared/JourneyStatusExcerpt'");
  expect(rightPanel).not.toContain('<JourneyStatusExcerpt');
});

test('game shell does not mount the external portrait overview', () => {
  expect(gameScreen).not.toContain('mobileSummary=');
  expect(gameScreen).not.toContain('JourneyStatusExcerpt');
});
