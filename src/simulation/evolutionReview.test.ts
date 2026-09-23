import { expect, test } from 'bun:test';
import { EvolutionReviewController } from './evolutionReview';
import { useSimulationStore } from '../stores/simulationStore';
import { createEmptySimState } from './types';
import { createDefaultGameState } from '../schema/variables';

test('导演请求失效后不写入，发布的界面快照不共享可变状态', async () => {
  let resolveProposal!: (value: any) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const review = new EvolutionReviewController(async () => { started(); return new Promise(resolve => { resolveProposal = resolve; }); });
  const facts = createDefaultGameState();
  const engine = {
    state: createEmptySimState(),
    saveState: () => {},
  };
  const params = {
    engine, world: { id: 'world' }, config: {}, saveId: 'save', turnId: 'turn', round: 1,
    narrative: '角色已经抵达城门。',
    getState: () => structuredClone(facts), commitState: () => {},
    currentSaveId: () => 'save', currentWorldId: () => 'world', latestTurnId: () => 'turn',
    onCommitted: () => {}, onMainlineBusy: () => {}, onBackgroundBusy: () => {},
  };
  const running = review.run(params as any);
  await entered;
  review.invalidate();
  resolveProposal({ conditions: [], offscreen: [], plans: [{ id: 'gate', intent: '开门', participants: [], constraints: [], priority: 30, visibility: 'foreground', evidence: [{ kind: 'narrative', quote: '角色已经抵达城门' }] }] });
  await running;
  expect(engine.state.director?.plans['actor:gate']).toBeUndefined();

  // A later engine mutation must not silently mutate the UI's already-published snapshot.
  const live = createEmptySimState();
  const store = useSimulationStore.getState();
  store.syncFromEngine(live);
  const published = useSimulationStore.getState().simState;
  live.config.enabled = false;
  expect(published.config.enabled).toBe(true);
  store.syncFromEngine(live);
  expect(useSimulationStore.getState().simState).not.toBe(published);
  expect(useSimulationStore.getState().simState.config.enabled).toBe(false);

  // User deletion invalidates an in-flight proposal and schedules save-scoped persistence.
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memoryStorage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStorage.set(key, value); },
    removeItem: (key: string) => { memoryStorage.delete(key); },
  } });
  const api = await import('./SimulationApi');
  const { useSaveStore } = await import('../stores/saveStore');
  const savedStore = useSaveStore.getState();
  let scheduled = 0;
  useSaveStore.setState({ currentSaveId: null, savesMeta: [], scheduleAutoSave: () => { scheduled++; } });
  try {
    expect(api.mutateBackgroundState(state => { state.pendingInteractions = []; })).toBe(true);
    expect(scheduled).toBe(1);
    useSaveStore.setState({ currentSaveId: 'ended', savesMeta: [{ id: 'ended', lifecycle: 'ended' }] as any });
    let mutatedReadOnly = false;
    expect(api.mutateBackgroundState(() => { mutatedReadOnly = true; })).toBe(false);
    expect(mutatedReadOnly).toBe(false);
    expect(scheduled).toBe(1);
  } finally {
    api.directorReviews.invalidate();
    useSaveStore.setState({ currentSaveId: savedStore.currentSaveId, savesMeta: savedStore.savesMeta, scheduleAutoSave: savedStore.scheduleAutoSave });
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('剧情导演开关写进引擎配置，回合结束的引擎同步不会把它顶回去', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const memoryStorage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStorage.set(key, value); },
    removeItem: (key: string) => { memoryStorage.delete(key); },
  } });
  const api = await import('./SimulationApi');
  const { useSaveStore } = await import('../stores/saveStore');
  const savedStore = useSaveStore.getState();
  let scheduled = 0;
  useSaveStore.setState({ currentSaveId: 'save', savesMeta: [{ id: 'save', lifecycle: 'active' }] as any, scheduleAutoSave: () => { scheduled++; } });
  try {
    const engine = api.getSimulationEngine();
    engine.state.config.enabled = true;
    useSimulationStore.getState().syncFromEngine(engine.state);
    expect(useSimulationStore.getState().simState.config.enabled).toBe(true);

    // 面板开关：必须写引擎，只写 UI store 会被同步顶回去
    expect(api.mutateBackgroundState(state => { state.config = { ...state.config, enabled: false }; })).toBe(true);
    expect(engine.state.config.enabled).toBe(false);
    expect(useSimulationStore.getState().simState.config.enabled).toBe(false);
    expect(scheduled).toBe(1);

    // 回合提交后的引擎→UI 同步：关掉的开关保持关闭
    useSimulationStore.getState().syncFromEngine(engine.state);
    expect(useSimulationStore.getState().simState.config.enabled).toBe(false);
  } finally {
    api.directorReviews.invalidate();
    useSaveStore.setState({ currentSaveId: savedStore.currentSaveId, savesMeta: savedStore.savesMeta, scheduleAutoSave: savedStore.scheduleAutoSave });
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
