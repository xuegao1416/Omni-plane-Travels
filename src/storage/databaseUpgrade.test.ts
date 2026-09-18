import { expect, test } from 'bun:test';

async function runScenario(script: string): Promise<void> {
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(error).toBe('');
  expect(code).toBe(0);
}

// A separate process isolates both IndexedDB and the cached getDB connection.
test('v4 database upgrades for TXT import without rewriting saves, settings or rollback snapshots', async () => {
  await runScenario(`
    import 'fake-indexeddb/auto';
    import { openDB } from 'idb';
    import { strict as assert } from 'node:assert';
    // The published v4 layout, before module runtime stores were introduced in v5.
    const old = await openDB('omni-plane-travels', 4, { upgrade(db) {
      db.createObjectStore('saves', {keyPath:'id'}).createIndex('timestamp','timestamp');
      db.createObjectStore('global', {keyPath:'key'});
      const messages = db.createObjectStore('messages', {keyPath:'key'});
      messages.createIndex('saveId','saveId');
      messages.createIndex('saveId_seq',['saveId','seq']);
    }});
    const records = {
      saves:[
        {id:'split',name:'分片旧存档',timestamp:1,schemaVersion:4,worldId:'test',gameState:{marker:'keep'},messageCount:1,lastMessageSeq:0},
        {id:'inline',name:'内联旧存档',timestamp:2,schemaVersion:3,messages:[{role:'assistant',content:'原始内联正文',snapshot:{marker:'inline-rollback'}}]}
      ],
      global:[{key:'settings',value:{theme:'dark'}},{key:'save_list',value:[{id:'split',name:'分片旧存档'}]}],
      messages:[{key:'split#0',saveId:'split',seq:0,message:{id:'m',role:'assistant',content:'原始分片正文',snapshot:{marker:'rollback',nested:{items:['旧物品']}}}}]
    };
    for (const [store,rows] of Object.entries(records)) for (const row of rows) await old.put(store,row);
    const originalRecords = {};
    for (const store of Object.keys(records)) originalRecords[store] = await old.getAll(store);
    old.close();
    const {getDB} = await import('./src/storage/db.ts');
    const {createNovelDatasetFromBytes} = await import('./src/novel/plainText.ts');
    const {saveNovelDataset,getNovelDataset} = await import('./src/novel/novelStore.ts');
    const text = '第一章 开始\\n这是新导入的小说正文。';
    const dataset = createNovelDatasetFromBytes('测试小说',new TextEncoder().encode(text));
    await saveNovelDataset(dataset);
    const db = await getDB();
    assert.equal(db.version,10);
    assert.equal(db.objectStoreNames.length,16);
    const imported = await getNovelDataset(dataset.id);
    assert.equal(imported.rawText,text);
    assert.deepEqual(imported.chapters,dataset.chapters);
    assert.deepEqual(imported.segments,dataset.segments);
    for (const [store,rows] of Object.entries(originalRecords)) assert.deepEqual(await db.getAll(store),rows);
    const tx = db.transaction(['messages','module_states','module_checkpoints','novel_segments']);
    assert.deepEqual(tx.objectStore('messages').index('saveId_seq').keyPath,['saveId','seq']);
    assert.equal(tx.objectStore('module_states').keyPath,'key');
    assert.deepEqual(tx.objectStore('module_states').index('saveId_moduleId').keyPath,['saveId','moduleId']);
    assert.equal(tx.objectStore('module_states').index('saveId_moduleId').unique,true);
    assert.equal(tx.objectStore('module_checkpoints').keyPath,'key');
    assert.deepEqual(tx.objectStore('module_checkpoints').index('saveId_module_revision').keyPath,['saveId','moduleId','revision']);
    assert.equal(tx.objectStore('module_checkpoints').index('saveId_module_revision').unique,true);
    assert.deepEqual(tx.objectStore('novel_segments').index('datasetId_index').keyPath,['datasetId','index']);
    await tx.done;
    assert.equal(await db.count('module_states'),0);
    assert.equal(await db.count('module_checkpoints'),0);
    db.close();
    const reopened = await openDB('omni-plane-travels',10);
    for (const [store,rows] of Object.entries(originalRecords)) assert.deepEqual(await reopened.getAll(store),rows);
    assert.equal((await reopened.get('novel_sources',dataset.id)).rawText,text);
    reopened.close();
  `);
});

test('published v5 database preserves saves and rollback data while TXT import becomes available', async () => {
  const script = `
    import 'fake-indexeddb/auto';
    import { openDB } from 'idb';
    import { strict as assert } from 'node:assert';
    const old = await openDB('omni-plane-travels', 5, { upgrade(db) {
      db.createObjectStore('saves', {keyPath:'id'}).createIndex('timestamp','timestamp');
      db.createObjectStore('global', {keyPath:'key'});
      const messages = db.createObjectStore('messages', {keyPath:'key'});
      messages.createIndex('saveId','saveId');
      messages.createIndex('saveId_seq',['saveId','seq']);
      const states = db.createObjectStore('module_states', {keyPath:'key'});
      states.createIndex('saveId','saveId');
      states.createIndex('saveId_moduleId',['saveId','moduleId'],{unique:true});
      const checkpoints = db.createObjectStore('module_checkpoints', {keyPath:'key'});
      checkpoints.createIndex('saveId','saveId');
      checkpoints.createIndex('saveId_module_revision',['saveId','moduleId','revision'],{unique:true});
    }});
    const records = {
      saves:{id:'save',name:'旧存档',timestamp:1,schemaVersion:4,round:1,worldId:'test',gameState:{},messageCount:1,lastMessageSeq:0},
      global:{key:'settings',value:{theme:'dark'}},
      messages:{key:'save#0',saveId:'save',seq:0,message:{id:'m',role:'assistant',content:'原有正文',round:1,seq:0,snapshot:{marker:'rollback'}}},
      module_states:{key:'save#inventory',saveId:'save',moduleId:'inventory',revision:2,state:{items:['旧物品']}},
      module_checkpoints:{key:'save#inventory#1',saveId:'save',moduleId:'inventory',revision:1,state:{items:[]}}
    };
    for (const [store,record] of Object.entries(records)) await old.put(store,record);
    old.close();
    const {getDB,loadGame,exportSave} = await import('./src/storage/db.ts');
    const {createNovelDatasetFromBytes} = await import('./src/novel/plainText.ts');
    const {saveNovelDataset,getNovelDataset} = await import('./src/novel/novelStore.ts');
    const text = '第一章 开始\\n这是新导入的小说正文。';
    const dataset = createNovelDatasetFromBytes('测试小说',new TextEncoder().encode(text));
    await saveNovelDataset(dataset);
    const db = await getDB();
    assert.equal(db.version,10);
    assert.equal(db.objectStoreNames.length,16);
    const imported = await getNovelDataset(dataset.id);
    assert.equal(imported.rawText,text);
    assert.deepEqual(imported.chapters,dataset.chapters);
    assert.deepEqual(imported.segments,dataset.segments);
    for (const [store,record] of Object.entries(records)) assert.deepEqual(await db.get(store,record.id ?? record.key),record);
    const loaded = await loadGame('save');
    assert.deepEqual(loaded.messages,[records.messages.message]);
    assert.equal(loaded.moduleStates[0].revision,2);
    assert.equal(loaded.moduleCheckpoints[0].revision,1);
    const exported = JSON.parse(await (await exportSave('save')).text());
    assert.deepEqual(exported.save.messages,[records.messages.message]);
    db.close();
    const reopened = await openDB('omni-plane-travels',10);
    assert.deepEqual(await reopened.get('saves','save'),{...records.saves,gameState:{...records.saves.gameState,customModules:{},customModuleBindingsInitialized:true,customModuleBindingWarnings:[]}});
    assert.equal((await reopened.get('novel_sources',dataset.id)).rawText,text);
    reopened.close();
  `;
  await runScenario(script);
});

test('failed index upgrade rolls back schema and records and allows retry', async () => {
  await runScenario(`
    import 'fake-indexeddb/auto';
    import { openDB } from 'idb';
    import { strict as assert } from 'node:assert';
    const old = await openDB('omni-plane-travels',5,{upgrade(db) {
      db.createObjectStore('saves',{keyPath:'id'});
      const states = db.createObjectStore('module_states',{keyPath:'key'});
      states.createIndex('saveId_moduleId',['saveId','moduleId']);
    }});
    const save = {id:'original',schemaVersion:4,gameState:{marker:'keep'}};
    await old.put('saves',save);
    const state = {key:'a',saveId:'original',moduleId:'inventory',revision:1};
    await old.put('module_states',state);
    await old.put('module_states',{...state,key:'duplicate'});
    const originalStores = [...old.objectStoreNames];
    old.close();
    const {getDB} = await import('./src/storage/db.ts');
    await assert.rejects(getDB());
    const preserved = await openDB('omni-plane-travels',5);
    assert.equal(preserved.version,5);
    assert.deepEqual([...preserved.objectStoreNames],originalStores);
    assert.deepEqual(await preserved.get('saves','original'),save);
    assert.equal(await preserved.count('module_states'),2);
    const tx = preserved.transaction('module_states');
    assert.equal(tx.store.index('saveId_moduleId').unique,false);
    await tx.done;
    // Remove only the deliberately corrupt test fixture, then retry the rejected singleton.
    await preserved.delete('module_states','duplicate');
    preserved.close();
    const retried = await getDB();
    assert.equal(retried.version,10);
    assert.deepEqual(await retried.get('module_states','a'),state);
    retried.close();
  `);
});

test('unsupported pre-v4 database is rejected without changing original data', async () => {
  await runScenario(`
    import 'fake-indexeddb/auto';
    import { openDB } from 'idb';
    import { strict as assert } from 'node:assert';
    const old = await openDB('omni-plane-travels',3,{upgrade(db) {
      db.createObjectStore('saves',{keyPath:'id'});
    }});
    const save = {id:'original',messages:[{content:'保留旧数据'}]};
    await old.put('saves',save);
    old.close();
    const {getDB} = await import('./src/storage/db.ts');
    await assert.rejects(getDB(),/支持从 v4/);
    const preserved = await openDB('omni-plane-travels',3);
    assert.deepEqual([...preserved.objectStoreNames],['saves']);
    assert.deepEqual(await preserved.get('saves','original'),save);
    preserved.close();
  `);
});
