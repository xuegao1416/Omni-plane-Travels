import { expect, test } from 'bun:test';

test('v9 upgrade adds director stores without changing saves, rollback records or novel partitions', async () => {
  const script = `
    import 'fake-indexeddb/auto';
    import { openDB } from 'idb';
    import { strict as assert } from 'node:assert';
    const original = await openDB('omni-plane-travels', 9, { upgrade(db) {
      for (const name of ['saves','messages','novel_datasets','novel_chapters','novel_segments','novel_sources','module_checkpoints']) db.createObjectStore(name, {keyPath:'id'});
    }});
    const records = {
      saves: {id:'s',gameState:{playerKnowledge:{schemaVersion:1,characters:{},processedReceiptIds:[]}},simulationState:{events:{legacy:{factStatus:'confirmed'}}}},
      messages: {id:'m',saveId:'s',snapshot:{playerKnowledge:{schemaVersion:1,characters:{},processedReceiptIds:[]}},simulationSnapshotId:'snap'},
      novel_datasets:{id:'novel',title:'旧小说',chapterCount:20},
      novel_chapters:{id:'c',datasetId:'novel',content:'原文'},
      novel_segments:{id:'seg',datasetId:'novel',index:0,summary:'原有分析'},
      novel_sources:{id:'novel',rawText:'完整原文'},
      module_checkpoints:{id:'cp',saveId:'s',revision:3}
    };
    for(const [name,value] of Object.entries(records)) await original.put(name,value);
    original.close();
    const {getDB,DIRECTOR_DEFINITIONS_STORE,DIRECTOR_JOBS_STORE} = await import('./src/storage/db.ts');
    const db=await getDB();
    assert.equal(db.version,10);
    assert.ok(db.objectStoreNames.contains(DIRECTOR_DEFINITIONS_STORE));
    assert.ok(db.objectStoreNames.contains(DIRECTOR_JOBS_STORE));
    for(const [name,value] of Object.entries(records)) assert.deepEqual(await db.get(name,value.id),value);
    await db.put(DIRECTOR_JOBS_STORE,{id:'job',status:'paused',units:[{id:'u',status:'done'}]});
    assert.equal((await db.get(DIRECTOR_JOBS_STORE,'job')).units[0].status,'done');
    db.close();
  `;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(error).toBe('');
  expect(code).toBe(0);
});
