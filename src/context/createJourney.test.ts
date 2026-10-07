import { expect, mock, test } from 'bun:test';
import { CreateJourney, type JourneyCreationInput, type JourneyCreationPorts } from './createJourney';
import { VariableManager } from '../engine/variableManager';
import type { GameSave } from '../storage/db';
import type { DirectorDefinition } from '../director/definitionTypes';
import type { ProfessionModuleSchema } from '../modules/schema';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

function input(): JourneyCreationInput {
  return {
    worldId: 'creation-test', world: { id: 'creation-test', name: '开局世界', description: '测试世界' },
    profile: {
      name: '旅人', gender: '女', age: '20', background: '旧背景', personality: '', appearance: '',
      career: '', socialClass: '', organization: '', specialIdentity: '', perspective: '第二人称',
      initialSkills: {}, initialItems: {}, customNpcs: [],
    },
    characterHistory: '开局经历', memoryConfig: { enabled: false }, variableConfig: { apiPresetId: 'initial' },
  };
}

function harness(overrides: Partial<JourneyCreationPorts> = {}) {
  let owner = 'old-journey';
  const ports = {
    chooseName: mock(async (_defaultName: string): Promise<string | null> => '新旅程'),
    getDefinition: mock(async (): Promise<DirectorDefinition | undefined> => undefined),
    resolveProfession: mock(() => undefined),
    runModules: mock(async (_manager: VariableManager, _worldId: string, _signal?: AbortSignal) => ({ warnings: ['模块提示'] })),
    persist: mock(async (_save: GameSave) => {}),
    activate: mock((save: GameSave) => { owner = save.id; }),
    ...overrides,
  };
  return { ports, journey: new CreateJourney(ports), owner: () => owner };
}

test('cancelling the name dialog runs no modules, saves nothing, and keeps the current journey', async () => {
  const h = harness({ chooseName: mock(async () => null) });
  expect(await h.journey.start(input())).toEqual({ status: 'cancelled' });
  expect(h.ports.runModules).not.toHaveBeenCalled();
  expect(h.ports.persist).not.toHaveBeenCalled();
  expect(h.ports.activate).not.toHaveBeenCalled();
  expect(h.owner()).toBe('old-journey');
});

test('double click shares one creation and inputs are frozen before the name dialog awaits', async () => {
  const name = deferred<string | null>();
  const h = harness({ chooseName: mock(() => name.promise) });
  const draft = input();
  const pending = h.journey.start(draft);
  expect(await h.journey.start(draft)).toEqual({ status: 'busy' });
  draft.profile.name = '迟到的新姓名';
  draft.profile.background = '迟到的背景';
  draft.world!.name = '迟到的世界';
  draft.characterHistory = '迟到的经历';
  draft.memoryConfig = { enabled: true };
  draft.variableConfig!.apiPresetId = 'late';
  name.resolve('已命名旅程');
  const result = await pending;
  expect(result.status).toBe('created');
  if (result.status !== 'created') throw Error('expected creation');
  expect(h.ports.chooseName).toHaveBeenCalledTimes(1);
  expect(h.ports.runModules).toHaveBeenCalledTimes(1);
  expect(h.ports.persist).toHaveBeenCalledTimes(1);
  expect(h.ports.activate).toHaveBeenCalledTimes(1);
  expect(result.save.gameState.玩家.姓名).toBe('旅人');
  expect(result.save.personalInfo?.background).toBe('旧背景');
  expect(result.save.customWorld?.name).toBe('开局世界');
  expect(result.save.messages[0].rawText).toBe('开局经历');
  expect(result.save.memoryConfig).toEqual({ enabled: false });
  expect(result.save.variableConfig).toEqual({ apiPresetId: 'initial' });
});

test('module failure cannot save or replace the old owner and releases the double-click guard', async () => {
  const runModules = mock(async () => { throw Error('模块初始化失败'); });
  const h = harness({ runModules });
  await expect(h.journey.start(input())).rejects.toThrow('模块初始化失败');
  expect(h.ports.persist).not.toHaveBeenCalled();
  expect(h.ports.activate).not.toHaveBeenCalled();
  expect(h.owner()).toBe('old-journey');
  await expect(h.journey.start(input())).rejects.toThrow('模块初始化失败');
  expect(runModules).toHaveBeenCalledTimes(2);
});

test('resolved profession library rules are frozen while the name dialog is open', async () => {
  const name = deferred<string | null>();
  const professions: ProfessionModuleSchema = {
    professions: [{ id: 'traveller', name: '旅者', description: '', abilities: [] }],
    innateTalents: [], creationTalentBudget: 0, initialAbilityPoints: 2,
  };
  const h = harness({ chooseName: mock(() => name.promise), resolveProfession: mock(() => professions) });
  const draft = input();
  draft.world!.modules = [{ moduleId: 'profession', name: '职业', enabled: true, moduleConfig: { packIds: ['original-pack'] } }];
  draft.profile.professionId = 'traveller';
  const pending = h.journey.start(draft);
  professions.professions[0].name = '库中迟到的名称';
  professions.initialAbilityPoints = 99;
  name.resolve('冻结规则的旅程');
  const result = await pending;
  if (result.status !== 'created') throw Error('expected creation');
  const restored = new VariableManager(result.save.gameState, { saveId: result.save.id, current: result.save.moduleStates! }).getState();
  expect(restored.玩家.能力系统?.职业状态?.职业名称).toBe('旅者');
  expect(restored.玩家.能力系统?.职业状态?.能力点).toBe(2);
});

test('save retry reuses prepared identity, module results, and snapshots without rerunning modules', async () => {
  const attempts: GameSave[] = [];
  const h = harness({
    chooseName: mock(async () => attempts.length ? '重试命名' : '首次命名'),
    runModules: mock(async manager => {
      const state = manager.getState();
      state.玩家.当前经验值 = 37;
      manager.setState(state);
      return { warnings: ['准备成果'] };
    }),
    persist: mock(async save => {
      attempts.push(structuredClone(save));
      if (attempts.length === 1) throw Error('磁盘写入失败');
    }),
  });
  await expect(h.journey.start(input())).rejects.toThrow('磁盘写入失败');
  expect(h.owner()).toBe('old-journey');
  expect(h.ports.activate).not.toHaveBeenCalled();
  const result = await h.journey.start(input());
  expect(result.status).toBe('created');
  if (result.status !== 'created') throw Error('expected creation');
  expect(h.ports.runModules).toHaveBeenCalledTimes(1);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual({ ...attempts[0], name: '重试命名' });
  expect(result.warnings).toEqual(['准备成果']);
  expect(new VariableManager(result.save.gameState, { saveId: result.save.id, current: result.save.moduleStates! }).getState().玩家.当前经验值).toBe(37);
  expect(h.owner()).toBe(result.save.id);
});

test('editing creation inputs after a failed save discards the prepared result', async () => {
  const attempts: GameSave[] = [];
  const h = harness({ persist: mock(async save => {
    attempts.push(structuredClone(save));
    if (attempts.length === 1) throw Error('保存失败');
  }) });
  const draft = input();
  await expect(h.journey.start(draft)).rejects.toThrow('保存失败');
  draft.profile.name = '修改后的旅人';
  const result = await h.journey.start(draft);
  expect(result.status).toBe('created');
  expect(h.ports.runModules).toHaveBeenCalledTimes(2);
  expect(attempts[1].id).not.toBe(attempts[0].id);
  expect(attempts[1].gameState.玩家.姓名).toBe('修改后的旅人');
});

test('cancellation during module preparation never persists or replaces the old owner', async () => {
  const modules = deferred<{ warnings: string[] }>();
  const entered = deferred<void>();
  const controller = new AbortController();
  const h = harness({ runModules: mock(async (_manager, _worldId, signal) => {
    expect(signal).toBe(controller.signal);
    entered.resolve();
    return modules.promise;
  }) });
  const pending = h.journey.start(input(), controller.signal);
  await entered.promise;
  controller.abort();
  modules.resolve({ warnings: [] });
  await expect(pending).rejects.toThrow();
  expect(h.ports.persist).not.toHaveBeenCalled();
  expect(h.ports.activate).not.toHaveBeenCalled();
  expect(h.owner()).toBe('old-journey');
});

test('cancellation while the durable write finishes retains the complete save without activating it', async () => {
  const persisted = deferred<void>();
  const entered = deferred<void>();
  const controller = new AbortController();
  const saves: GameSave[] = [];
  const h = harness({ persist: mock(async save => {
    entered.resolve();
    await persisted.promise;
    saves.push(structuredClone(save));
  }) });
  const pending = h.journey.start(input(), controller.signal);
  await entered.promise;
  controller.abort();
  persisted.resolve();
  const result = await pending;
  expect(result.status).toBe('created');
  if (result.status !== 'created') throw Error('expected durable creation');
  expect(result.activated).toBe(false);
  expect(saves).toEqual([result.save]);
  expect(saves[0].moduleStates!.length).toBeGreaterThan(0);
  expect(saves[0].simulationState?.snapshots).toHaveLength(1);
  expect(saves[0].messages[0].simulationSnapshotId).toBe(saves[0].simulationState?.snapshots[0].id);
  expect(h.ports.activate).not.toHaveBeenCalled();
  expect(h.owner()).toBe('old-journey');
});

test('activation failure explicitly reports the complete durable journey and preserves its recovery capture', async () => {
  const durableSaves: GameSave[] = [];
  const h = harness({
    persist: mock(async save => { durableSaves.push(structuredClone(save)); }),
    activate: mock(() => { throw Error('游戏界面挂载失败'); }),
  });
  await expect(h.journey.start(input())).rejects.toThrow('旅程已完整保存，但进入游戏失败：游戏界面挂载失败。请从存档列表读取该旅程。');
  expect(h.ports.persist).toHaveBeenCalledTimes(1);
  expect(h.ports.activate).toHaveBeenCalledTimes(1);
  expect(durableSaves).toHaveLength(1);
  const save = durableSaves[0];
  expect(save.name).toBe('新旅程');
  expect(save.messages[0].rawText).toBe('开局经历');
  expect(save.messages[0].simulationSnapshotId).toBe(save.simulationState?.snapshots[0].id);
  expect(save.simulationState?.snapshots).toHaveLength(1);
  expect(save.moduleStates!.length).toBeGreaterThan(0);
  for (const record of save.moduleStates!) expect(save.moduleCheckpoints).toContainEqual(record);
  expect(new VariableManager(save.gameState, { saveId: save.id, current: save.moduleStates!, checkpoints: save.moduleCheckpoints }).getState().玩家.姓名).toBe('旅人');
  expect(h.owner()).toBe('old-journey');
});

test('empty history still captures module checkpoints and the bound initial director snapshot', async () => {
  const definition: DirectorDefinition = {
    schemaVersion: 1, id: 'opening-plot', version: '1', title: '开局主线', source: { kind: 'author', text: '测试主线' },
    coreConflict: '探索', anchors: [], stages: [{ id: 'opening', title: '启程', description: '开始', nodeIds: ['first'] }],
    nodes: [{ id: 'first', stageId: 'opening', title: '第一幕', intent: '前往广场', actorIds: [], execution: 'foreground', conditions: [], dependsOn: [], constraints: [], sourceRefs: ['author:0:4'] }],
    characters: [], coverage: { complete: true, gaps: [], boundary: '开局' }, createdAt: 1, editedByAuthor: true,
  };
  const h = harness({ getDefinition: mock(async () => definition), runModules: mock(async manager => {
    const state = manager.getState();
    state.玩家.当前经验值 = 17;
    manager.setState(state);
    return { warnings: [] };
  }) });
  const draft = input();
  draft.characterHistory = '  \n ';
  draft.world!.directorSource = { definitionId: definition.id, version: definition.version, startStageId: 'opening' };
  const result = await h.journey.start(draft);
  if (result.status !== 'created') throw Error('expected creation');
  const save = result.save;
  expect(save.messages).toEqual([]);
  expect(h.ports.runModules).toHaveBeenCalledTimes(1);
  expect(save.simulationState?.director?.sourceBinding).toMatchObject({ definitionId: definition.id, version: '1', startStageId: 'opening' });
  expect(save.simulationState?.snapshots).toHaveLength(1);
  expect(save.simulationState?.snapshots[0]).toMatchObject({ msgIndex: 0, isInitial: true, note: '开局' });
  expect(save.simulationState?.snapshots[0].snapshot.director?.sourceBinding).toMatchObject({ definitionId: definition.id });
  expect(save.moduleStates!.some(record => record.moduleId === 'progression')).toBe(true);
  for (const record of save.moduleStates!) {
    expect(record.saveId).toBe(save.id);
    expect(save.gameState.moduleRevisions?.[record.moduleId]).toBe(record.revision);
    expect(save.moduleCheckpoints).toContainEqual(record);
  }
  expect(new VariableManager(save.gameState, { saveId: save.id, current: save.moduleStates!, checkpoints: save.moduleCheckpoints }).getState().玩家.当前经验值).toBe(17);
});
