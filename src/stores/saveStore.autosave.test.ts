import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { ACTIVE_SAVE_KEY, type GameSave } from '../storage/db';

if (typeof localStorage === 'undefined') {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
}
const { useSaveStore, setAutoSaveBuilder, resetForNewGame } = await import('./saveStore');
const ID = 'save_1_autosaveoldowner';
const NEXT_ID = 'save_2_autosavenewowner';
let originalState = useSaveStore.getState();
let originalMarker: string | null;
let written: GameSave[];
const capture = (id = ID): GameSave => ({ id, name: id, timestamp: 1, worldId: 'default', gameState: createDefaultGameState(), messages: [{ id: `${id}:0`, role: 'assistant', rawText: '正文', seq: 0, round: 1, timestamp: 1 }] });

beforeEach(() => {
  resetForNewGame();
  originalState = useSaveStore.getState();
  originalMarker = localStorage.getItem(ACTIVE_SAVE_KEY);
  written = [];
  useSaveStore.setState({ currentSaveId: ID, currentSaveName: ID, performSave: async save => { written.push(save); } });
});

afterEach(() => {
  resetForNewGame();
  setAutoSaveBuilder(() => null);
  useSaveStore.setState(originalState);
  if (originalMarker === null) localStorage.removeItem(ACTIVE_SAVE_KEY);
  else localStorage.setItem(ACTIVE_SAVE_KEY, originalMarker);
});

test('pipeline autosave bursts defer complete capture until the current save is flushed', async () => {
  let builds = 0;
  const latest = capture();
  setAutoSaveBuilder(() => { builds++; return latest; });
  for (let index = 0; index < 23; index++) useSaveStore.getState().scheduleAutoSave();
  expect(builds).toBe(0);
  latest.messages[0].rawText = '结算完成且包含中断恢复状态';
  await useSaveStore.getState().flushAutoSave();
  expect(builds).toBe(1);
  expect(written).toHaveLength(1);
  expect(written[0].messages[0].rawText).toBe('结算完成且包含中断恢复状态');
});

test('switching journeys cancels an uncaptured old request before its builder can read the new owner', async () => {
  let builds = 0;
  setAutoSaveBuilder(() => { builds++; return capture(useSaveStore.getState().currentSaveId!); });
  useSaveStore.getState().scheduleAutoSave();
  useSaveStore.getState().activateSave(capture(NEXT_ID));
  await new Promise(resolve => setTimeout(resolve, 550));
  expect(builds).toBe(0);
  expect(written).toEqual([]);
  useSaveStore.getState().scheduleAutoSave();
  await useSaveStore.getState().flushAutoSave();
  expect(written.map(save => save.id)).toEqual([NEXT_ID]);
});

test('resetting a journey cancels pending builders even when its save id stays selected', async () => {
  let builds = 0;
  setAutoSaveBuilder(() => { builds++; return capture(); });
  useSaveStore.getState().scheduleAutoSave();
  resetForNewGame();
  await new Promise(resolve => setTimeout(resolve, 550));
  expect(builds).toBe(0);
  expect(written).toEqual([]);
});
