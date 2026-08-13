import { describe, expect, test } from 'bun:test';
import {
  buildCustomModuleAgentWorldContext,
  buildCustomModuleCapabilityCatalog,
} from './capabilities';

describe('custom module capability catalog', () => {
  test('derives only the current world capabilities and usable leaf paths', () => {
    const world = buildCustomModuleAgentWorldContext({
      id: 'world-a',
      name: 'World A',
      modules: [
        { moduleId: 'stat', name: 'Stats', enabled: false },
        {
          moduleId: 'survival', name: 'Survival', enabled: true,
          moduleConfig: { resources: [{ id: 'water' }, { id: 'unsafe.resource' }] },
        },
        { moduleId: 'business', name: 'Business', enabled: true },
      ],
    });
    const catalog = buildCustomModuleCapabilityCatalog(world);

    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
    expect(catalog.lifecycles).toContain('onGameStart');
    expect(catalog.lifecycles).toContain('onButton');
    expect(catalog.safeInputPaths['player.stats.attrA']).toBeDefined();
    expect(catalog.safeInputPaths['player.stats.dim1']).toBeUndefined();
    expect(catalog.safeInputPaths['player.currency.primary']).toBeUndefined();
    expect(catalog.safeInputPaths['player.business.funds']).toBeDefined();
    expect(catalog.safeInputPaths['player.business.assetCount']).toBeDefined();
    expect(catalog.safeInputPaths['player.survival.water.amount']).toBeDefined();
    expect(catalog.safeInputPaths['player.survival.water.max']).toBeDefined();
    expect(catalog.safeInputPaths['player.survival.unsafe.resource.amount']).toBeUndefined();
    expect(catalog.stateFieldTypes).toContain('number');
    expect(catalog.actions).toContain('subtract');
    expect(catalog.viewComponents).toContain('button');
    expect(catalog.world.availability).toEqual({ stat: false, survival: true, business: true, currency: false });
    expect(catalog.world.survivalResourceIds).toEqual(['water']);
  });

  test('does not invent optional capabilities for a world without modules', () => {
    const world = buildCustomModuleAgentWorldContext({ id: 'plain', name: 'Plain', modules: [] });
    const catalog = buildCustomModuleCapabilityCatalog(world);

    expect(catalog.safeInputPaths['player.stats.dim6']).toBeUndefined();
    expect(catalog.safeInputPaths['player.survival.water.amount']).toBeUndefined();
    expect(catalog.safeInputPaths['player.business.funds']).toBeUndefined();
    expect(catalog.safeInputPaths['player.currency.primary']).toBeDefined();
  });
});
