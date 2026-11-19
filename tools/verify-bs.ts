import { readFileSync } from 'node:fs';
import { validateCustomGameplayModule } from '../src/custom-modules/validator';
import { validateDirectorDefinition } from '../src/director/definitionSchema';
import { bindDirectorDefinition } from '../src/director/sourceAdapter';

const BASE = 'F:/1 BlackSouls/_extract/worldpack/_rebuild/out/';
const mod = JSON.parse(readFileSync(BASE + 'script_ingress（迷失值模块）.json', 'utf8'));
const def = JSON.parse(readFileSync(BASE + 'plot_black_souls_carnage.json', 'utf8'));

let fail = 0;
const r = validateCustomGameplayModule(mod, 'import');
console.log('[模块] valid =', r.valid, '| issues =', (r.issues || []).length);
for (const i of (r.issues || []).slice(0, 20)) console.log('   ', JSON.stringify(i));
if (!r.valid) fail++;

try { validateDirectorDefinition(def); console.log('[主线] validateDirectorDefinition = PASS'); }
catch (e) { console.log('[主线] FAIL:', (e as Error).message); fail++; }

try {
  const d = bindDirectorDefinition({ version: 1, plans: {}, directives: {}, receipts: [], offscreenReceipts: {}, offscreenProposals: {} } as any, def);
  const plans = Object.keys(d.plans);
  console.log('[主线] bindDirectorDefinition = PASS | plans =', plans.length);
  console.log('   stages =', d.sourceBinding!.stages!.map((s: any) => `${s.id}:${s.status}`).join(' '));
  console.log('   actorNames =', JSON.stringify(d.sourceBinding!.actorNames));
  const bad = plans.filter(k => { const p: any = (d.plans as any)[k]; return !p.participants || !Array.isArray(p.dependencies) || !p.visibility; });
  console.log('   缺字段的 plan 数 =', bad.length);
  console.log('   plan 示例:', JSON.stringify((d.plans as any)[plans[0]]).slice(0, 260));
} catch (e) { console.log('[主线] bind FAIL:', (e as Error).message); fail++; }
console.log(fail ? `\n✗ 失败 ${fail} 项` : '\n✓ 全部通过');
