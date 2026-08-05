import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const sourceRoot = join(import.meta.dir, '..');
const forbidden = [
  'CardFile',
  'EventPackFile',
  'cardFileToEventPack',
  'eventDefToCardFile',
  'flattenEventPack',
  'OptEventFile',
  'schema/card.json',
  'wtg-mod',
  '.wtgmod',
  'discoverMods',
  'listMods',
  'installMod',
  'uninstallMod',
  'importMod',
  'exportMod',
  'webDiscoverMods',
  'webListMods',
  'webValidateMod',
  'webUninstallMod',
  'webEnableMod',
  'webDisableMod',
  'webExportMod',
  'export type EventType',
  'EventPackType as EventType',
  'createRulePack',
  'parseOptEvents',
];

function productionSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...productionSources(path));
    else if (
      ['.ts', '.tsx'].includes(extname(entry.name))
      && !entry.name.endsWith('.test.ts')
      && !entry.name.endsWith('.test.tsx')
      && entry.name !== 'eventPackFormat.ts'
    ) files.push(path);
  }
  return files;
}

test('legacy card-pack identifiers stay inside the import migration boundary', () => {
  const matches: string[] = [];
  for (const file of productionSources(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const token of forbidden) {
      if (source.includes(token)) matches.push(`${relative(sourceRoot, file)}: ${token}`);
    }
  }
  expect(matches).toEqual([]);
});
