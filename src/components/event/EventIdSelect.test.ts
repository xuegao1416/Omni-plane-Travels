import { expect, test } from 'bun:test';
import type { WebEventRecord } from '../../modules/eventDb';
import { getEventPackWorldId, isCardEventPack } from './EventIdSelect';

test('event selector uses manifest world binding and ignores rule packs', () => {
  const cardPack = {
    manifest: { type: 'card', worldId: 'world-e2e' },
  } as unknown as WebEventRecord;
  const rulePack = {
    manifest: { type: 'rule', worldId: 'world-e2e' },
  } as unknown as WebEventRecord;

  expect(getEventPackWorldId(cardPack)).toBe('world-e2e');
  expect(isCardEventPack(cardPack)).toBe(true);
  expect(isCardEventPack(rulePack)).toBe(false);
});
