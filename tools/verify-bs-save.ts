import { readFileSync } from 'node:fs';
import { validateCustomGameplayModule } from '../src/custom-modules/validator';
import { validateDirectorDefinition } from '../src/director/definitionSchema';
import { normalizeThread, normalizeStateSlot, normalizeRelationNetworkItem, normalizeEventCard, normalizeEntityCard, normalizeProvenance } from '../src/memory/normalize';
import { selectPlayerKnownNPCs } from '../src/engine/playerKnowledge';

const P = 'F:/1 BlackSouls/saves/黑森箱庭.篝火骑士.60轮.json';
const doc = JSON.parse(readFileSync(P, 'utf8'));
const s = doc.save;
let fail = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? '  ✓' : '  ✗'} ${msg}`); if (!c) fail++; };

console.log('【1】导入判据');
ok(doc.type === 'omni-plane-travels-save', `type = ${doc.type}`);
ok(doc.version === '2.0', `version = ${doc.version}`);
ok(!!(s.messages?.length || s.gameState), `messages=${s.messages?.length} gameState=${!!s.gameState}`);
ok(doc.exportedAt > 0, `exportedAt = ${doc.exportedAt}`);

console.log('\n【2】自定义模块（App 本尊 validator）');
const mod = s.gameState.customModules?.script_ingress;
ok(!!mod, 'gameState.customModules.script_ingress 存在');
if (mod) {
  ok(!!mod.definition, '内嵌 definition 在（不依赖工坊注册）');
  const r = validateCustomGameplayModule(mod.definition, 'import');
  ok(r.valid, `validateCustomGameplayModule = ${r.valid}, issues=${(r.issues || []).length}`);
  for (const i of (r.issues || []).slice(0, 10)) console.log('     issue:', JSON.stringify(i));
  console.log('     values.lostness =', (mod.values as any).lostness,
    '| supply', (mod.values as any).supplyCount, '| attention', (mod.values as any).attention,
    '| assimilation', (mod.values as any).assimilation);
  const keys = Object.keys(mod.values);
  const defKeys = Object.keys(mod.definition.state);
  ok(keys.length === defKeys.length && defKeys.every(k => keys.includes(k)),
    `values 覆盖全部 ${defKeys.length} 个 state 字段`);
}

console.log('\n【3】导演主线（App 本尊 validator + 绑定）');
const defs = s.directorDefinitions;
ok(Array.isArray(defs) && defs.length === 1, `directorDefinitions 长度 = ${defs?.length}`);
if (defs?.[0]) {
  try { validateDirectorDefinition(defs[0]); ok(true, 'validateDirectorDefinition PASS'); }
  catch (e) { ok(false, 'validateDirectorDefinition FAIL: ' + (e as Error).message); }
}
const dr = s.simulationState?.director;
ok(!!dr, 'simulationState.director 存在');
if (dr) {
  const ks = Object.keys(dr.plans || {});
  ok(ks.length === 15, `plans = ${ks.length}`);
  const bad = ks.filter(k => { const p = (dr.plans as any)[k]; return !Array.isArray(p.participants) || !Array.isArray(p.dependencies) || !p.visibility; });
  ok(bad.length === 0, `缺字段的 plan = ${bad.length}`);
  const st = (dr.plans as any)[ks[0]].status;
  const counts: Record<string, number> = {};
  for (const k of ks) { const x = (dr.plans as any)[k].status; counts[x] = (counts[x] || 0) + 1; }
  console.log('     plan 状态分布:', JSON.stringify(counts));
  ok(!!dr.sourceBinding, 'sourceBinding 在');
  if (dr.sourceBinding) {
    console.log('     stages:', dr.sourceBinding.stages.map((x: any) => `${x.id}:${x.status}`).join(' '));
    console.log('     currentStageId:', dr.sourceBinding.currentStageId);
    ok(dr.sourceBinding.stages.some((x: any) => x.status === 'active'), '存在 active 阶段');
  }
  ok(Object.keys(dr.offscreenProposals || {}).length > 0, `offscreenProposals = ${Object.keys(dr.offscreenProposals || {}).length}`);
  ok(Object.keys(dr.offscreenReceipts || {}).length > 0, `offscreenReceipts = ${Object.keys(dr.offscreenReceipts || {}).length}`);
  ok(Array.isArray(dr.receipts), `receipts = ${dr.receipts?.length}`);
}

console.log('\n【4】记忆数组（App 本尊 normalize 对拍：被改写数必须为 0）');
const mr = s.memoryRuntime;
const kinds: [string, any][] = [
  ['activeThreads', normalizeThread], ['stateSlots', normalizeStateSlot],
  ['relationNetwork', normalizeRelationNetworkItem], ['eventCards', normalizeEventCard],
  ['entityCards', normalizeEntityCard], ['archiveCards', normalizeProvenance],
];
let coerced = 0;
for (const [k, fn] of kinds) {
  const arr = (mr as any)[k] || [];
  let c = 0;
  for (const x of arr) {
    try { if (JSON.stringify(fn(x)) !== JSON.stringify(x)) c++; } catch { c++; }
  }
  coerced += c;
  console.log(`     ${k}: ${arr.length} 条 | 被改写 ${c}`);
}
ok(coerced === 0, `归一化被改写总数 = ${coerced}`);

console.log('\n【5】角色关系（App 本尊 selectPlayerKnownNPCs）');
const known = selectPlayerKnownNPCs(s.gameState);
const ids = Object.keys(known);
ok(ids.length > 0, `已认识 NPC = ${ids.length}`);
for (const id of ids) {
  const n: any = (known as any)[id];
  const rd = n.关系数据 ?? {};
  console.log(`     ${id} | 姓名=${n.姓名} | 分类=${n.人物分类} | 职业=${n.社会身份?.职业} | 好感度=${rd.好感度} | 关系=${rd.关系类型} | 事迹=${(n.人物事迹 || []).length} 条`);
}

console.log('\n【6】其他');
ok(Array.isArray(s.moduleStates) && s.moduleStates.length > 0, `moduleStates = ${s.moduleStates?.length}`);
ok(!!s.customWorld?.worldBookEntries, `customWorld 世界书条目 = ${s.customWorld?.worldBookEntries?.length}`);
ok(!!s.customWorld?.directorSource, `customWorld.directorSource = ${JSON.stringify(s.customWorld?.directorSource)}`);
const closeD = (r: number) => s.messages.filter((m: any) => m.round === r && m.role === 'assistant')[0]?.rawText?.includes('</TimeAdvance>');
ok(closeD(60), '末轮消息带 <TimeAdvance> 收尾');
const streamingCount = s.messages.filter((m: any) => 'streaming' in m).length;
ok(streamingCount === 0, `streaming 字段条数 = ${streamingCount}（历史消息不该闪光标）`);
ok(s.personalInfo.initialSkills && Object.keys(s.personalInfo.initialSkills).length === 0, 'initialSkills 已清空');

console.log(fail ? `\n✗ 失败 ${fail} 项` : '\n✓ 全部通过');
