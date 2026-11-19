import { readFileSync, writeFileSync } from 'node:fs';
import { bindDirectorDefinition } from '../src/director/sourceAdapter';

const OUT = 'F:/1 BlackSouls/_extract/worldpack/_rebuild/out/';
const def = JSON.parse(readFileSync(OUT + 'plot_black_souls_carnage.json', 'utf8'));
const base: any = { version: 1, plans: {}, directives: {}, receipts: [], offscreenReceipts: {}, offscreenProposals: {} };
const d: any = bindDirectorDefinition(base, def);
writeFileSync('F:/1 BlackSouls/forge/gen/_director_bound.json', JSON.stringify(d, null, 1), 'utf8');
console.log('plans', Object.keys(d.plans).length, '| stages', d.sourceBinding.stages.length, '| wrote _director_bound.json');
