import { describe, expect, test } from 'bun:test';

/** A subprocess gives each migration a fresh IDB factory and getDB singleton. */
async function migrationScenario(version: 6 | 7 | 8 | 9): Promise<void> {
  const script = `
    import 'fake-indexeddb/auto';
    import { openDB } from 'idb';
    import { strict as assert } from 'node:assert';
    const previous = await openDB('omni-plane-travels', ${version}, {
      upgrade(db) {
        db.createObjectStore('novel_datasets', {keyPath:'id'});
        for (const name of ['novel_chapters','novel_segments','novel_chunks','novel_jobs']) {
          const store = db.createObjectStore(name, {keyPath:'id'});
          if (name !== 'novel_chapters') store.createIndex('datasetId_index', 'datasetId');
          if (${version} === 8 && name !== 'novel_jobs') store.createIndex('datasetId', 'datasetId');
        }
      }
    });
    const legacy = {id:'legacy',title:'旧小说',sourceType:'txt',rawText:'第一章\\n未丢失原文',rawTextLength:10,
      staticMaterial:{summary:'原有世界'},createdAt:1,updatedAt:1,
      chapters:[{id:'lc',index:0,title:'第一章',content:'未丢失原文'}],
      segments:[{id:'ls',index:0,chapterIds:['lc'],title:'第一章',summary:'原有剧情',events:[],hardConstraints:[]}]};
    await previous.put('novel_datasets', legacy);
    await previous.put('novel_datasets', {...legacy,id:'partitioned',chapters:undefined,segments:undefined});
    await previous.put('novel_chapters', {id:'pc',datasetId:'partitioned',index:0,title:'一',content:'分表原文'});
    for(let index=0; index<6; index++) await previous.put('novel_segments', {id:'ps'+index,datasetId:'partitioned',index,
      title:'段'+index,chapterIds:['pc'],summary:'剧情'+index,events:[],hardConstraints:[],sourceText:'不加载的原文'});
    await previous.put('novel_chunks', {id:'chunk',datasetId:'partitioned',chapterId:'pc',index:0,text:'原文'});
    await previous.put('novel_jobs', {id:'job',datasetId:'partitioned',status:'paused',updatedAt:1});
    previous.close();
    const {getDB} = await import('./src/storage/db.ts');
    const preserved = await getDB();
    assert.equal(preserved.version, 10);
    assert.deepEqual(await preserved.get('novel_datasets','legacy'),legacy);
    assert.equal((await preserved.getAll('novel_segments')).length,6);
    assert.equal((await preserved.getAll('novel_jobs')).length,1);
    assert.equal(preserved.objectStoreNames.contains('director_definitions'),true);
    const {getNovelDataset,getNovelRuntimeWindow,listNovelJobs} = await import('./src/novel/novelStore.ts');
    assert.equal((await getNovelDataset('legacy')).rawText,legacy.rawText);
    const partitioned = await getNovelDataset('partitioned');
    assert.equal(partitioned.chapters[0].content,'分表原文');
    assert.equal(partitioned.segments.length,6);
    assert.deepEqual((await getNovelRuntimeWindow('partitioned',3)).segments.map(s => s.index),[2,3,4]);
    assert.equal((await listNovelJobs('partitioned'))[0].status,'paused');
    preserved.close();
  `;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
}

describe('intermediate database upgrades', () => {
  for (const version of [6, 7, 8, 9] as const) {
    test(`v${version} preserves inline and partitioned data and repairs novel indexes`, () => migrationScenario(version));
  }
});
