/**
 * Localhost-only visual QA for the world map (`?plshot=map`).
 *   &theme=ancient|modern|scifi   which template map
 *   &view=2d|3d                   canvas
 *   &mode=atlas|play|editor|weave|dossier
 *                                 atlas = everything known; play = sample save with fog and a short trail;
 *                                 editor = the world-editor map workspace with stat / progression / survival / business / combat linked;
 *                                 weave = the world editor (step 3) of a sample custom world (&workspace=map opens the map editor as from the hall);
 *                                 dossier = the hall's world detail overlay with the 地图 chapter
 *   &as=ancient|modern|scifi      render the chosen template in another theme
 *   &world=<id>                   render a built-in world's own map instead of a template (e.g. wuxia_world)
 *   &select=<id>                  preselect a location (editor: `region:<id>` / `route:<id>` also work)
 *   &empty=1                      editor only: start from a blank map
 */
import { useMemo, useState } from 'react';
import { UISettingsProvider } from '../context/UISettingsContext';
import type { WorldBookEntryDef, WorldDef } from '../data/worlds-schema';
import { createDefaultGameState } from '../schema/variables';
import { createGameplayHost } from '../core/registry';
import { findWorldDef } from '../data/worldLoader';
import { MAP_TEMPLATES } from '../domains/map/templates';
import { buildMapViewModel } from '../domains/map/viewModel';
import { createDefaultMapModule, mapConfigOf } from '../domains/map/config';
import { mapLinkOptions } from '../domains/map/links';
import { pendingLocations } from '../domains/map/generation';
import type { MapModuleSchema, MapTheme } from '../domains/map/types';
import { DEFAULT_MODULE_FACTORIES, MODULE_NAME_MAP } from '../components/start/worldEditorForm/types';
import MapView from '../components/map/MapView';
import MapEditorWorkspace from '../components/map/MapEditorWorkspace';
import WorldEditorForm from '../components/start/WorldEditorForm';
import WorldDetailOverlay from '../components/start/orrery/WorldDetailOverlay';
import '../ui/screens/map.css';

function previewWorld(theme: MapTheme, as?: MapTheme): WorldDef {
  const config = MAP_TEMPLATES[theme].build();
  if (as) config.theme = as;
  return {
    id: `map_preview_${theme}`, name: config.title ?? '地图预览', description: MAP_TEMPLATES[theme].description,
    modules: [
      { moduleId: 'map', name: '世界地图', enabled: true, moduleConfig: config as unknown as Record<string, unknown> },
    ],
  };
}

export function previewState(world: WorldDef, steps: string[] = []) {
  let state = createDefaultGameState();
  state.世界.时间系统 = { 当前时间: '第三日 · 辰时', 当前天气: '晴' };
  const host = createGameplayHost(world, state);
  state = host.prepare(state);
  for (const to of steps) {
    const outcome = createGameplayHost(world, state).dispatch(state, 'map.travel', { to }, { source: 'player' });
    if (outcome.status === 'applied') state = outcome.state;
  }
  return state;
}

const TRAILS: Record<MapTheme, string[]> = { ancient: ['luochuan', 'qingshi'], modern: ['station', 'tower'], scifi: ['helios', 'titan'] };
const EDITOR_MODULES = ['stat', 'progression', 'survival', 'business', 'combat'] as const;
const EDITOR_PENDING: Record<MapTheme, Array<{ name: string; description: string }>> = {
  ancient: [{ name: '落霞渡', description: '洛川下游的渡口，在都城东南' }, { name: '寒鸦岭', description: '北境雪原边上的山岭' }],
  modern: [{ name: '旧船坞', description: '港区南边废弃的船坞' }],
  scifi: [{ name: '静默信标', description: '外环边缘一座失联的信标站' }],
};

function sampleCustomWorld(theme: MapTheme): WorldDef {
  const template = MAP_TEMPLATES[theme];
  const map = template.build();
  const lore = [...map.locations.slice(0, 4).map(item => ({ name: item.name, description: item.description ?? '' })), ...EDITOR_PENDING[theme]];
  return {
    id: `custom_map_preview_${theme}`, name: template.label, description: template.description, tags: theme === 'scifi' ? ['科幻', '星际'] : theme === 'modern' ? ['都市'] : ['古风', '江湖'],
    worldBookEntries: [
      { uid: 1, key: [], comment: '世界设定', content: `【世界背景】${template.description}`, constant: true, order: 1, entryType: 'setting' } as WorldBookEntryDef,
      ...lore.map((item, index) => ({ uid: 10 + index, key: [item.name], comment: item.name, content: `【${item.name}】\n${item.description}`, constant: false, order: 20 + index, entryType: 'lore' }) as WorldBookEntryDef),
    ],
    modules: [
      ...EDITOR_MODULES.map(id => ({ moduleId: id, name: MODULE_NAME_MAP[id] ?? id, description: '', enabled: true, moduleConfig: DEFAULT_MODULE_FACTORIES[id]?.() as Record<string, unknown> | undefined })),
      { moduleId: 'map', name: '世界地图', description: '', enabled: true, moduleConfig: map as unknown as Record<string, unknown> },
    ],
  };
}

function EditorPreview({ theme, params, initial }: { theme: MapTheme; params: URLSearchParams; initial?: WorldDef }) {
  const [map, setMap] = useState<MapModuleSchema>(() => params.get('empty') === '1'
    ? createDefaultMapModule()
    : mapConfigOf(initial!) ?? MAP_TEMPLATES[theme].build());
  const world = useMemo<WorldDef>(() => {
    const mapModule = { moduleId: 'map', name: '世界地图', enabled: true, moduleConfig: map as unknown as Record<string, unknown> };
    if (initial) return { ...initial, modules: [...(initial.modules ?? []).filter(item => item.moduleId !== 'map'), mapModule] };
    return {
      id: 'map_editor_preview', name: MAP_TEMPLATES[theme].label, description: MAP_TEMPLATES[theme].description, tags: [],
      modules: [
        ...EDITOR_MODULES.map(id => ({ moduleId: id, name: MODULE_NAME_MAP[id] ?? id, enabled: true, moduleConfig: DEFAULT_MODULE_FACTORIES[id]?.() as Record<string, unknown> | undefined })),
        mapModule,
      ],
    };
  }, [theme, map, initial]);
  const links = useMemo(() => mapLinkOptions(world, initial ? [] : ['天枢阁', '北境军府']), [world, initial]);
  const pending = useMemo(() => pendingLocations(map, [...map.locations.map(item => ({ name: item.name })), ...(initial ? (initial.worldBookEntries ?? []).filter(item => item.entryType === 'lore').map(item => ({ name: item.comment })) : EDITOR_PENDING[theme])]), [map, theme, initial]);
  return (
    <MapEditorWorkspace
      map={map} onChange={setMap} onClose={() => undefined} world={world} links={links} pending={pending}
      generating={params.get('generating') === 'map' ? 'map' : null} aiAvailable onAiGenerate={() => undefined} onAiPlace={() => undefined}
      initialSelection={params.get('select') ?? undefined}
    />
  );
}

export default function MapPreview() {
  const params = new URLSearchParams(window.location.search);
  const theme = (['ancient', 'modern', 'scifi'].includes(params.get('theme') ?? '') ? params.get('theme') : 'ancient') as MapTheme;
  const as = (['ancient', 'modern', 'scifi'].includes(params.get('as') ?? '') ? params.get('as') : undefined) as MapTheme | undefined;
  const requested = params.get('mode');
  const mode = requested === 'play' || requested === 'editor' || requested === 'weave' || requested === 'dossier' ? requested : 'atlas';
  const worldId = params.get('world');
  // `&world=` shows a built-in world's own map (the modules shipped in worlds.json) instead of a template.
  const builtin = useMemo(() => (worldId ? findWorldDef(worldId) : undefined), [worldId]);
  const hasOwnMap = Boolean(builtin && mapConfigOf(builtin));
  const world = useMemo<WorldDef>(() => (builtin && hasOwnMap ? builtin : previewWorld(theme, as)), [builtin, hasOwnMap, theme, as]);
  const steps = useMemo(() => (hasOwnMap ? [] : TRAILS[theme]), [hasOwnMap, theme]);
  const state = useMemo(() => mode === 'play' ? previewState(world, steps) : null, [world, mode, steps]);
  const view = useMemo(() => buildMapViewModel(world, state, { atlas: mode !== 'play' }), [world, state, mode]);
  const [selected, setSelected] = useState<string | null>(params.get('select'));
  if (worldId && !hasOwnMap) {
    return (
      <UISettingsProvider>
        <p style={{ padding: 24, color: '#c9d4e8', fontFamily: 'system-ui', lineHeight: 1.7 }}>
          「{worldId}」没有自己的地图模块。<br />可用：wuxia_world / wasteland_apocalypse / stranded_island / japanese_school / desire_metropolis / border_trade
        </p>
      </UISettingsProvider>
    );
  }
  if (mode === 'weave') {
    return (
      <UISettingsProvider>
        <WorldEditorForm initialWorld={builtin && hasOwnMap ? builtin : sampleCustomWorld(theme)} initialStep={3} initialWorkspace={params.get('workspace') === 'map' ? 'map' : undefined}
          apiConfig={null} onSave={() => undefined} onCancel={() => undefined} previewMode="edit" />
      </UISettingsProvider>
    );
  }
  if (mode === 'dossier') {
    const custom = builtin && hasOwnMap ? builtin : sampleCustomWorld(theme);
    return (
      <UISettingsProvider>
        <WorldDetailOverlay world={custom} code={builtin && hasOwnMap ? 'P-01' : 'P-07'} origin={{ x: 720, y: 450, radius: 140 }} isCustom={!(builtin && hasOwnMap)}
          onClose={() => undefined} onStart={() => undefined} onEdit={() => undefined} onEditMap={() => undefined} onDelete={() => undefined} />
      </UISettingsProvider>
    );
  }
  if (mode === 'editor') {
    return (
      <UISettingsProvider>
        <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 50% 30%, #1a2140, #070a14)' }} />
        <EditorPreview theme={theme} params={params} initial={builtin && hasOwnMap ? builtin : undefined} />
      </UISettingsProvider>
    );
  }
  if (!view) return <p>no map</p>;
  return (
    <UISettingsProvider>
      <div style={{ position: 'fixed', inset: 0, background: '#0b0f1c' }}>
        <MapView view={view} initialMode={params.get('view') === '3d' ? '3d' : '2d'} selectedId={selected} onSelect={setSelected} />
      </div>
    </UISettingsProvider>
  );
}
