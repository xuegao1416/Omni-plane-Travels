import { readFileSync } from 'node:fs';
import { bindDirectorDefinition } from '../src/director/sourceAdapter';

const def = JSON.parse(readFileSync('F:/1 BlackSouls/_extract/worldpack/_rebuild/out/plot_black_souls_carnage.json', 'utf8'));
const base: any = { version: 1, plans: {}, directives: {}, receipts: [], offscreenReceipts: {}, offscreenProposals: {} };
const d: any = bindDirectorDefinition(base, def);

console.log('runtime keys:', Object.keys(d));
console.log('sourceBinding:', JSON.stringify(d.sourceBinding).slice(0, 1200));
const ks = Object.keys(d.plans);
console.log('\nplan count', ks.length);
console.log('\nplan[0] full:');
console.log(JSON.stringify(d.plans[ks[0]], null, 1));
console.log('\nstatuses:');
for (const k of ks) console.log('  ', k, '=>', (d.plans as any)[k].status, '| exec', (d.plans as any)[k].execution, '| actors', JSON.stringify((d.plans as any)[k].participants));
