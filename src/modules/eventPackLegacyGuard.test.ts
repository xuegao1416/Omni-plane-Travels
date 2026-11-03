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

function containsForbiddenToken(source: string, token: string): boolean {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)) return source.includes(token);
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(source);
}

test('legacy card-pack identifiers stay inside the import migration boundary', () => {
  expect(containsForbiddenToken('workshop.importModule(raw)', 'importMod')).toBe(false);
  expect(containsForbiddenToken('await importMod(raw)', 'importMod')).toBe(true);
  const matches: string[] = [];
  for (const file of productionSources(sourceRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const token of forbidden) {
      if (containsForbiddenToken(source, token)) matches.push(`${relative(sourceRoot, file)}: ${token}`);
    }
  }
  expect(matches).toEqual([]);
});
