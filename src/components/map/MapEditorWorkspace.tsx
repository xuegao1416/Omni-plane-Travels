/**
 * 地图编辑器（世界编辑里的单独入口）：在画布上拖动地点与地区、点击添加、连线；
 * 右侧检查器编辑属性与模块联动（市场、产业、采集、事件卡、职业会馆、检定、路费与补给、修正效果）；
 * 支持 AI 生成整张地图、AI 补全坐标、本地草图、模板、自动连路、撤销重做、导入导出。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Cable, Dices, Download, Flag, Link2, Loader, MapPin, MapPinned, MousePointer2, Plus, Redo2, Route, Sparkles, Trash2, Undo2, Upload, Wand2, X,
} from 'lucide-react';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { useDialog } from '../shared/Dialog';
import { normalizeMapConfig, nearestRegion, resolveMapTheme } from '../../domains/map/config';
import { disconnectedLocations, placePendingLocally, sketchMapFromLocations } from '../../domains/map/generation';
import { buildGraph, estimateLeg, formatMinutes, suggestRoutes } from '../../domains/map/graph';
import { legContextFor, configWithMap } from '../../domains/map/module';
import { effectTargets, type MapLinkOptions } from '../../domains/map/links';
import { MAP_TEMPLATES } from '../../domains/map/templates';
import {
  LANDFORM_LABELS, LOCATION_KIND_LABELS, MAP_LOCATION_KINDS, MAP_ROUTE_KINDS, MAP_SERVICES, MAP_TERRAINS, SCALE_LABELS, routeKindLabel, scaleName,
  SERVICE_LABELS, TERRAIN_LABELS, THEME_LABELS,
  type MapEffect, type MapLandform, type MapLocation, type MapModuleSchema, type MapRegion, type MapRoute, type MapScale, type MapTheme, type MapThemeSetting,
} from '../../domains/map/types';
import { buildMapViewModel } from '../../domains/map/viewModel';
import type { WorldDef } from '../../data/worlds-schema';
import MapView from './MapView';
import type { MapEditTool } from './Map2D';
import { placeIcon } from './map2d/glyphs';
import '../../ui/screens/map.css';
import '../../ui/screens/map-editor.css';

type Selection = { type: 'location' | 'region' | 'route'; id: string } | null;
type Tab = 'locations' | 'regions' | 'routes';

export interface MapEditorWorkspaceProps {
  map: MapModuleSchema;
  onChange: (next: MapModuleSchema) => void;
  onClose: () => void;
  world: Pick<WorldDef, 'name' | 'description' | 'tags' | 'modules'>;
  links: MapLinkOptions;
  /** 世界书（地理区域）里还没上图的地点。 */
  pending: Array<{ name: string; description?: string }>;
  generating: 'map' | 'place' | null;
  aiAvailable: boolean;
  onAiGenerate?: () => void;
  onAiPlace?: () => void;
  /** 打开时选中的条目：地点 id，或 `region:<id>` / `route:<id>`。 */
  initialSelection?: string;
  /** 右下角主按钮；默认「完成」= 关闭编辑器。大厅「编辑地图」进来时是「保存地图」。 */
  doneLabel?: string;
  onDone?: () => void;
}

function parseSelection(value: string | undefined): Selection {
  if (!value) return null;
  const [type, id] = value.includes(':') ? value.split(':', 2) : ['location', value];
  return type === 'region' || type === 'route' || type === 'location' ? { type, id } : null;
}

function nextId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let index = used.size + 1;
  while (used.has(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}

/** 单个输入用 label 包住；含多个按钮或勾选框的一组控件用 div（label 里点文字会触发第一个按钮）。 */
function Field({ label, children, wide, group }: { label: string; children: ReactNode; wide?: boolean; group?: boolean }) {
  const className = `map-editor__field${wide ? ' is-wide' : ''}`;
  if (group) return <div className={className} role="group" aria-label={label}><span>{label}</span>{children}</div>;
  return <label className={className}><span>{label}</span>{children}</label>;
}

function NumberField({ label, value, onChange, min, max, step = 1, placeholder }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void; min?: number; max?: number; step?: number; placeholder?: string }) {
  return (
    <Field label={label}>
      <input type="number" value={value ?? ''} min={min} max={max} step={step} placeholder={placeholder}
        onChange={event => { const raw = event.target.value; onChange(raw === '' ? undefined : Number(raw)); }} />
    </Field>
  );
}

function DangerField({ value, onChange }: { value: number | undefined; onChange: (value: number | undefined) => void }) {
  return (
    <Field label="危险度" group>
      <div className="map-editor__danger" role="radiogroup" aria-label="危险度">
        {[0, 1, 2, 3, 4, 5].map(level => (
          <button type="button" key={level} role="radio" aria-checked={(value ?? 0) === level} className={(value ?? 0) === level ? 'is-active' : ''} onClick={() => onChange(level || undefined)}>{level}</button>
        ))}
      </div>
    </Field>
  );
}

function ChipPicker({ label, options, value, onChange, empty }: { label: string; options: Array<{ id: string; name: string }>; value: string[] | undefined; onChange: (next: string[]) => void; empty: string }) {
  const selected = new Set(value ?? []);
  return (
    <Field label={label} wide group>
      {options.length ? (
        <div className="map-editor__chips">
          {options.map(option => (
            <button type="button" key={option.id} className={selected.has(option.id) ? 'is-active' : ''} aria-pressed={selected.has(option.id)}
              onClick={() => { const next = new Set(selected); if (next.has(option.id)) next.delete(option.id); else next.add(option.id); onChange([...next]); }}>
              {option.name}
            </button>
          ))}
        </div>
      ) : <small className="map-editor__muted">{empty}</small>}
    </Field>
  );
}

function EffectsEditor({ effects, onChange, links }: { effects: MapEffect[] | undefined; onChange: (next: MapEffect[] | undefined) => void; links: MapLinkOptions }) {
  const targets = effectTargets(links);
  const list = effects ?? [];
  const update = (index: number, patch: Partial<MapEffect>) => onChange(list.map((effect, i) => i === index ? { ...effect, ...patch } : effect));
  return (
    <Field label="身处此地时的修正" wide group>
      <div className="map-editor__effects">
        {list.map((effect, index) => (
          <div key={index} className="map-editor__effect">
            <select value={effect.target} onChange={event => update(index, { target: event.target.value })}>
              {!targets.some(target => target.value === effect.target) && <option value={effect.target}>{effect.target}</option>}
              {[...new Set(targets.map(target => target.group))].map(group => (
                <optgroup key={group} label={group}>{targets.filter(target => target.group === group).map(target => <option key={target.value} value={target.value}>{target.label}</option>)}</optgroup>
              ))}
            </select>
            <select value={effect.mode ?? 'mult'} onChange={event => update(index, { mode: event.target.value as MapEffect['mode'] })} aria-label="方式">
              <option value="mult">百分比</option>
              <option value="flat">加减</option>
            </select>
            <input type="number" step={effect.mode === 'flat' ? 1 : 0.05} value={effect.value} onChange={event => update(index, { value: Number(event.target.value) || 0 })} aria-label="数值" />
            <input value={effect.label ?? ''} placeholder="说明" onChange={event => update(index, { label: event.target.value || undefined })} aria-label="说明" />
            <button type="button" className="map-editor__icon" onClick={() => { const next = list.filter((_, i) => i !== index); onChange(next.length ? next : undefined); }} aria-label="删除修正"><X size={13} /></button>
          </div>
        ))}
        <button type="button" className="btn-ghost btn-sm" onClick={() => onChange([...list, { target: targets[0]?.value ?? 'map.travel.time', mode: 'mult', value: 0.2 }])}><Plus size={13} />添加修正</button>
        {list.length > 0 && <small className="map-editor__muted">百分比写 0.2 表示 +20%，-0.3 表示 -30%。离开此地即失效。</small>}
      </div>
    </Field>
  );
}

export default function MapEditorWorkspace({ map, onChange, onClose, world, links, pending, generating, aiAvailable, onAiGenerate, onAiPlace, initialSelection, doneLabel = '完成', onDone }: MapEditorWorkspaceProps) {
  const dialog = useDialog();
  const [selection, setSelection] = useState<Selection>(() => parseSelection(initialSelection));
  const [tab, setTab] = useState<Tab>(() => selection?.type === 'region' ? 'regions' : selection?.type === 'route' ? 'routes' : 'locations');
  const [tool, setTool] = useState<MapEditTool>('select');
  const [query, setQuery] = useState('');
  const history = useRef<MapModuleSchema[]>([]);
  const future = useRef<MapModuleSchema[]>([]);
  const lastPush = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const [, setRevision] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const commit = useCallback((next: MapModuleSchema, key = '') => {
    const now = Date.now();
    const merge = key && lastPush.current.key === key && now - lastPush.current.at < 900;
    if (!merge) {
      history.current = [...history.current, map].slice(-40);
      future.current = [];
    }
    lastPush.current = { key, at: now };
    onChange(next);
    setRevision(value => value + 1);
  }, [map, onChange]);

  const undo = useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return;
    future.current = [map, ...future.current].slice(0, 40);
    onChange(previous);
    setRevision(value => value + 1);
  }, [map, onChange]);
  const redo = useCallback(() => {
    const [next, ...rest] = future.current;
    if (!next) return;
    future.current = rest;
    history.current = [...history.current, map];
    onChange(next);
    setRevision(value => value + 1);
  }, [map, onChange]);

  const previewWorld = useMemo(() => ({ id: 'map-editor', name: world.name || '世界', description: world.description || '', tags: world.tags ?? [], modules: world.modules }) as WorldDef, [world]);
  const view = useMemo(() => buildMapViewModel(previewWorld, null, { atlas: true, config: map }), [previewWorld, map]);
  const theme: MapTheme = resolveMapTheme(map.theme, world);
  const location = selection?.type === 'location' ? map.locations.find(item => item.id === selection.id) : undefined;
  const region = selection?.type === 'region' ? map.regions.find(item => item.id === selection.id) : undefined;
  const route = selection?.type === 'route' ? map.routes.find(item => item.id === selection.id) : undefined;

  const patchLocation = (id: string, patch: Partial<MapLocation>, key?: string) => commit({ ...map, locations: map.locations.map(item => item.id === id ? { ...item, ...patch } : item) }, key ?? `loc:${id}`);
  const patchRegion = (id: string, patch: Partial<MapRegion>, key?: string) => commit({ ...map, regions: map.regions.map(item => item.id === id ? { ...item, ...patch } : item) }, key ?? `region:${id}`);
  const patchRoute = (id: string, patch: Partial<MapRoute>) => commit({ ...map, routes: map.routes.map(item => item.id === id ? { ...item, ...patch } : item) }, `route:${id}`);

  const remove = useCallback(() => {
    if (!selection) return;
    if (selection.type === 'location') {
      commit({ ...map, locations: map.locations.filter(item => item.id !== selection.id), routes: map.routes.filter(item => item.from !== selection.id && item.to !== selection.id), ...(map.startLocationId === selection.id ? { startLocationId: undefined } : {}) });
    } else if (selection.type === 'region') {
      commit({ ...map, regions: map.regions.filter(item => item.id !== selection.id), locations: map.locations.map(item => item.regionId === selection.id ? { ...item, regionId: undefined } : item) });
    } else {
      commit({ ...map, routes: map.routes.filter(item => item.id !== selection.id) });
    }
    setSelection(null);
  }, [selection, map, commit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selection) { event.preventDefault(); remove(); }
      else if (event.key === 'Escape') {
        // 任何确认框（本编辑器或世界编辑器的）开着时，Esc 只关确认框。
        if (dialog.isOpen || document.querySelector('.pk-dialog-overlay')) return;
        event.stopPropagation();
        if (selection) setSelection(null); else if (tool !== 'select') setTool('select'); else onClose();
      }
      else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        const shortcut: Record<string, MapEditTool> = { v: 'select', a: 'add', c: 'connect', r: 'region' };
        const next = shortcut[event.key.toLowerCase()];
        if (next) setTool(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, remove, selection, tool, dialog.isOpen, onClose]);

  const edit = {
    tool,
    selectedRegionId: region?.id ?? null,
    selectedRouteId: route?.id ?? null,
    onMoveLocation: (id: string, x: number, y: number) => patchLocation(id, { x, y }, `move:${id}`),
    onMoveRegion: (id: string, x: number, y: number) => patchRegion(id, { x, y }, `move-region:${id}`),
    onResizeRegion: (id: string, radius: number) => patchRegion(id, { radius }, `radius:${id}`),
    onAddLocation: (x: number, y: number) => {
      const id = nextId('loc', map.locations.map(item => item.id));
      const created: MapLocation = { id, name: `新地点 ${map.locations.length + 1}`, kind: 'town', x, y, ...(nearestRegion(map.regions, x, y) ? { regionId: nearestRegion(map.regions, x, y)!.id } : {}) };
      commit({ ...map, locations: [...map.locations, created], ...(map.startLocationId ? {} : { startLocationId: id }) });
      setSelection({ type: 'location', id });
      setTab('locations');
      setTool('select');
    },
    onAddRegion: (x: number, y: number) => {
      const id = nextId('region', map.regions.map(item => item.id));
      commit({ ...map, regions: [...map.regions, { id, name: `新地区 ${map.regions.length + 1}`, terrain: map.landform === 'space' ? 'nebula' : 'plains', x, y, radius: 140 }] });
      setSelection({ type: 'region', id });
      setTab('regions');
      setTool('select');
    },
    onConnect: (from: string, to: string) => {
      if (map.routes.some(item => (item.from === from && item.to === to) || (item.from === to && item.to === from))) return;
      const id = nextId('route', map.routes.map(item => item.id));
      commit({ ...map, routes: [...map.routes, { id, from, to, kind: map.landform === 'space' ? 'warp' : 'road' }] });
      setSelection({ type: 'route', id });
      setTab('routes');
    },
    onSelectRegion: (id: string | null) => { setSelection(id ? { type: 'region', id } : null); if (id) setTab('regions'); },
    onSelectRoute: (id: string | null) => { setSelection(id ? { type: 'route', id } : null); if (id) setTab('routes'); },
  };

  const legEstimate = useMemo(() => {
    if (!route) return null;
    const graph = buildGraph(map);
    try { return estimateLeg(graph, route, route.from, legContextFor(configWithMap(map, previewWorld))); } catch { return null; }
  }, [route, map, previewWorld]);

  const replaceAll = async (next: MapModuleSchema, message: string) => {
    if (map.locations.length && !(await dialog.confirm(message, { confirmText: '替换', cancelText: '取消' }))) return;
    commit(next);
    setSelection(null);
  };
  const applyTemplate = (key: MapTheme) => void replaceAll({ ...MAP_TEMPLATES[key].build(), seed: map.seed }, `用模板「${MAP_TEMPLATES[key].label}」替换当前地图？（可以撤销）`);
  const sketch = () => void replaceAll(sketchMapFromLocations({ locations: pending.length || !map.locations.length ? [...map.locations.map(item => ({ name: item.name, description: item.description })), ...pending] : map.locations.map(item => ({ name: item.name, description: item.description })), theme: map.theme, worldName: world.name, description: world.description, tags: world.tags ?? [], seed: map.seed }), '按地名与描述重新排一张草图？现有坐标会被替换（可以撤销）');
  const autoRoutes = () => {
    const added = suggestRoutes(map.locations, map.routes, { landform: map.landform, maxLength: Math.max(map.width, map.height) * 0.3 });
    if (!added.length) { void dialog.alert('路网已经很完整，没有需要补的路。'); return; }
    commit({ ...map, routes: [...map.routes, ...added] });
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ type: 'omni-plane-travels-map', version: 1, data: map }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${map.title || world.name || 'world'}-地图.json`; anchor.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      const next = normalizeMapConfig(parsed.type === 'omni-plane-travels-map' ? parsed.data : parsed);
      if (!next.locations.length) throw new Error('文件里没有地点');
      await replaceAll(next, '导入的地图会替换当前地图（可以撤销），继续吗？');
    } catch (error) {
      await dialog.alert(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const disconnected = useMemo(() => disconnectedLocations(map), [map]);
  const filter = (name: string) => !query.trim() || name.includes(query.trim());
  const regionOptions = map.regions.map(item => ({ id: item.id, name: item.name }));
  const locationOptions = map.locations.map(item => ({ id: item.id, name: item.name }));
  const tierOptions = links.tiers;
  const locationName = useMemo(() => new globalThis.Map(map.locations.map(item => [item.id, item.name] as const)), [map.locations]);
  const regionName = useMemo(() => new globalThis.Map(map.regions.map(item => [item.id, item.name] as const)), [map.regions]);
  const regionAccent = useMemo(() => new globalThis.Map((view?.regions ?? []).map(item => [item.region.id, item.accent] as const)), [view]);
  const toolHint = tool === 'add' ? '点击地图空白处，放下一个新地点'
    : tool === 'connect' ? '先点起点，再点终点，就连出一条路'
      : tool === 'region' ? '点击地图，放下新地区的中心'
        : region ? '拖动地区中心移动它，拖外圈的把手调整范围' : '';

  const inspector = location ? (
    <>
      <div className="map-editor__inspector-title"><MapPin size={14} />地点<span>{location.id}</span></div>
      <div className="map-editor__grid">
        <Field label="名称" wide><input value={location.name} onChange={event => patchLocation(location.id, { name: event.target.value })} /></Field>
        <Field label="类型">
          <select value={location.kind} onChange={event => patchLocation(location.id, { kind: event.target.value as MapLocation['kind'] })}>
            {MAP_LOCATION_KINDS.map(kind => <option key={kind} value={kind}>{LOCATION_KIND_LABELS[kind]}</option>)}
          </select>
        </Field>
        <Field label="所属地区">
          <select value={location.regionId ?? ''} onChange={event => patchLocation(location.id, { regionId: event.target.value || undefined })}>
            <option value="">（自动）</option>
            {regionOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </Field>
        <Field label="描述（也会作为此地的设定给 AI）" wide><textarea rows={3} value={location.description ?? ''} onChange={event => patchLocation(location.id, { description: event.target.value || undefined })} /></Field>
        <Field label="别名（逗号分隔，正文里这样称呼也能对上）" wide><input value={(location.aliases ?? []).join('，')} onChange={event => patchLocation(location.id, { aliases: event.target.value.split(/[,，]/).map(item => item.trim()).filter(Boolean) })} /></Field>
        <NumberField label="X" value={Math.round(location.x)} min={0} max={map.width} onChange={value => patchLocation(location.id, { x: value ?? location.x })} />
        <NumberField label="Y" value={Math.round(location.y)} min={0} max={map.height} onChange={value => patchLocation(location.id, { y: value ?? location.y })} />
        <DangerField value={location.danger} onChange={value => patchLocation(location.id, { danger: value })} />
        <Field label="开局" wide group>
          <div className="map-editor__toggles">
            <label><input type="checkbox" checked={location.known === true} onChange={event => patchLocation(location.id, { known: event.target.checked || undefined })} />开局就知道</label>
            <button type="button" className={`btn-ghost btn-sm${map.startLocationId === location.id ? ' is-active' : ''}`} onClick={() => commit({ ...map, startLocationId: location.id })}><Flag size={12} />{map.startLocationId === location.id ? '开局位置' : '设为开局位置'}</button>
          </div>
        </Field>
        <ChipPicker label="服务" options={MAP_SERVICES.map(service => ({ id: service, name: SERVICE_LABELS[service] }))} value={location.services} onChange={next => patchLocation(location.id, { services: next.length ? next as MapLocation['services'] : undefined })} empty="" />
        {location.services?.includes('rest') && <NumberField label="休整花费" value={location.restPrice} min={0} onChange={value => patchLocation(location.id, { restPrice: value || undefined })} />}
        {tierOptions.length > 0 && (
          <Field label="推荐成长阶段">
            <select value={location.minTier ?? ''} onChange={event => patchLocation(location.id, { minTier: event.target.value === '' ? undefined : Number(event.target.value) })}>
              <option value="">不限</option>
              {tierOptions.map((name, index) => <option key={index} value={index}>{name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="map-editor__section"><Link2 size={13} />与其他模块的联动</div>
      <div className="map-editor__grid">
        <ChipPicker label="此地的市场（经营资产：身处此地即可交易）" options={links.markets} value={location.links?.markets} onChange={next => patchLocation(location.id, { links: { ...location.links, markets: next.length ? next : undefined } })} empty="未启用经营资产，或还没有市场。" />
        <ChipPicker label="此地的产业" options={links.holdings} value={location.links?.holdings} onChange={next => patchLocation(location.id, { links: { ...location.links, holdings: next.length ? next : undefined } })} empty="没有可挂接的产业。" />
        <Field label="可采集的物资（生存资源）" wide group>
          {links.resources.length ? (
            <div className="map-editor__gather">
              {links.resources.map(resource => {
                const entry = location.links?.gather?.find(item => item.id === resource.id);
                const set = (next: { id: string; bonus?: number } | null) => {
                  const others = (location.links?.gather ?? []).filter(item => item.id !== resource.id);
                  const gather = next ? [...others, next] : others;
                  patchLocation(location.id, { links: { ...location.links, gather: gather.length ? gather : undefined } });
                };
                return (
                  <div key={resource.id} className={`map-editor__gather-row${entry ? ' is-active' : ''}`}>
                    <label><input type="checkbox" checked={Boolean(entry)} onChange={event => set(event.target.checked ? { id: resource.id } : null)} />{resource.name}</label>
                    {entry && <input type="number" step={0.1} value={entry.bonus ?? 0} onChange={event => set({ id: resource.id, ...(Number(event.target.value) ? { bonus: Number(event.target.value) } : {}) })} aria-label={`${resource.name}采集加成`} title="采集量加成（0.5 = +50%）" />}
                  </div>
                );
              })}
            </div>
          ) : <small className="map-editor__muted">未启用生存资源。</small>}
        </Field>
        <ChipPicker label="职业会馆" options={links.professions} value={location.links?.professions} onChange={next => patchLocation(location.id, { links: { ...location.links, professions: next.length ? next : undefined } })} empty="未启用职业典藏。" />
        <Field label="首次到达时弹出的事件卡" wide>
          {links.events.length ? (
            <select value={location.links?.events?.[0]?.eventId ?? ''} onChange={event => {
              const picked = links.events.find(item => item.eventId === event.target.value);
              patchLocation(location.id, { links: { ...location.links, events: picked ? [{ eventId: picked.eventId, ...(picked.packId ? { packId: picked.packId } : {}) }] : undefined } });
            }}>
              <option value="">不弹卡</option>
              {links.events.map(item => <option key={`${item.packId}/${item.eventId}`} value={item.eventId}>{item.name}</option>)}
            </select>
          ) : <small className="map-editor__muted">世界还没有内置事件卡；也可以在事件中心给卡片设触发「抵达地点 map.arrived」。</small>}
        </Field>
        <EffectsEditor effects={location.effects} links={links} onChange={next => patchLocation(location.id, { effects: next })} />
      </div>
    </>
  ) : region ? (
    <>
      <div className="map-editor__inspector-title"><MapPinned size={14} />地区<span>{region.id}</span></div>
      <div className="map-editor__grid">
        <Field label="名称" wide><input value={region.name} onChange={event => patchRegion(region.id, { name: event.target.value })} /></Field>
        <Field label="地貌">
          <select value={region.terrain} onChange={event => patchRegion(region.id, { terrain: event.target.value as MapRegion['terrain'] })}>
            {MAP_TERRAINS.map(terrain => <option key={terrain} value={terrain}>{TERRAIN_LABELS[terrain]}</option>)}
          </select>
        </Field>
        <Field label="颜色"><input type="color" value={region.color ?? '#8c2f1c'} onChange={event => patchRegion(region.id, { color: event.target.value })} /></Field>
        <Field label="描述" wide><textarea rows={2} value={region.description ?? ''} onChange={event => patchRegion(region.id, { description: event.target.value || undefined })} /></Field>
        <NumberField label="中心 X" value={region.x} min={0} max={map.width} onChange={value => patchRegion(region.id, { x: value ?? region.x })} />
        <NumberField label="中心 Y" value={region.y} min={0} max={map.height} onChange={value => patchRegion(region.id, { y: value ?? region.y })} />
        <NumberField label="影响半径" value={region.radius} min={30} max={Math.max(map.width, map.height)} onChange={value => patchRegion(region.id, { radius: value ?? region.radius })} />
        <DangerField value={region.danger} onChange={value => patchRegion(region.id, { danger: value })} />
        <Field label="控制势力">
          <input list="map-editor-factions" value={region.faction ?? ''} onChange={event => patchRegion(region.id, { faction: event.target.value || undefined })} />
          <datalist id="map-editor-factions">{links.factions.map(name => <option key={name} value={name} />)}</datalist>
        </Field>
        {tierOptions.length > 0 && (
          <Field label="推荐成长阶段">
            <select value={region.minTier ?? ''} onChange={event => patchRegion(region.id, { minTier: event.target.value === '' ? undefined : Number(event.target.value) })}>
              <option value="">不限</option>
              {tierOptions.map((name, index) => <option key={index} value={index}>{name}</option>)}
            </select>
          </Field>
        )}
        {links.combat && <Field label="伏击时的敌人（逗号分隔）" wide><input value={(region.encounters ?? []).join('，')} placeholder="如：山匪，饿狼" onChange={event => patchRegion(region.id, { encounters: event.target.value.split(/[,，]/).map(item => item.trim()).filter(Boolean) })} /></Field>}
        <EffectsEditor effects={region.effects} links={links} onChange={next => patchRegion(region.id, { effects: next })} />
      </div>
    </>
  ) : route ? (
    <>
      <div className="map-editor__inspector-title"><Route size={14} />路线<span>{route.id}</span></div>
      <div className="map-editor__grid">
        <Field label="起点"><select value={route.from} onChange={event => patchRoute(route.id, { from: event.target.value })}>{locationOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
        <Field label="终点"><select value={route.to} onChange={event => patchRoute(route.id, { to: event.target.value })}>{locationOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></Field>
        <Field label="类型"><select value={route.kind} onChange={event => patchRoute(route.id, { kind: event.target.value as MapRoute['kind'] })}>{MAP_ROUTE_KINDS.map(kind => <option key={kind} value={kind}>{routeKindLabel(kind, theme)}</option>)}</select></Field>
        <Field label="名称"><input value={route.name ?? ''} placeholder="可选，如：洛京官道" onChange={event => patchRoute(route.id, { name: event.target.value || undefined })} /></Field>
        <NumberField label="时长（分钟）" value={route.minutes} min={1} placeholder={legEstimate ? `自动：约 ${formatMinutes(legEstimate.minutes)}` : '按距离估算'} onChange={value => patchRoute(route.id, { minutes: value || undefined })} />
        <DangerField value={route.danger} onChange={value => patchRoute(route.id, { danger: value })} />
        {links.stats.length > 0 && (route.danger ?? 0) >= 2 && (
          <>
            <Field label="检定属性">
              <select value={route.check?.stat ?? ''} onChange={event => patchRoute(route.id, { check: { ...route.check, stat: event.target.value || undefined } })}>
                <option value="">按路况自动</option>
                {links.stats.map(stat => <option key={stat.id} value={stat.id}>{stat.name}</option>)}
              </select>
            </Field>
            <NumberField label="检定难度" value={route.check?.dc} min={2} max={40} placeholder={`自动：${8 + (route.danger ?? 0) * 2}`} onChange={value => patchRoute(route.id, { check: { ...route.check, dc: value || undefined } })} />
          </>
        )}
        <NumberField label="额外体力" value={route.cost?.stamina} min={0} onChange={value => patchRoute(route.id, { cost: { ...route.cost, stamina: value || undefined } })} />
        <NumberField label="路费" value={route.cost?.currency} min={0} onChange={value => patchRoute(route.id, { cost: { ...route.cost, currency: value || undefined } })} />
        {links.resources.length > 0 && (
          <Field label="途中消耗的物资" wide group>
            <div className="map-editor__gather">
              {links.resources.map(resource => (
                <div key={resource.id} className={`map-editor__gather-row${route.cost?.resources?.[resource.id] ? ' is-active' : ''}`}>
                  <span>{resource.name}</span>
                  <input type="number" min={0} step={0.5} value={route.cost?.resources?.[resource.id] ?? 0} onChange={event => {
                    const resources = { ...(route.cost?.resources ?? {}) };
                    const amount = Number(event.target.value) || 0;
                    if (amount > 0) resources[resource.id] = amount; else delete resources[resource.id];
                    patchRoute(route.id, { cost: { ...route.cost, resources: Object.keys(resources).length ? resources : undefined } });
                  }} aria-label={`${resource.name}消耗`} />
                </div>
              ))}
            </div>
          </Field>
        )}
        {links.professions.length > 0 && <ChipPicker label="只有这些职业能走" options={links.professions} value={route.requires?.professions} onChange={next => patchRoute(route.id, { requires: { ...route.requires, professions: next.length ? next : undefined } })} empty="" />}
        <Field label="通行物品"><input value={route.requires?.item ?? ''} placeholder="如：通关文牒" onChange={event => patchRoute(route.id, { requires: { ...route.requires, item: event.target.value || undefined } })} /></Field>
        {tierOptions.length > 0 && (
          <Field label="至少达到">
            <select value={route.requires?.minTier ?? ''} onChange={event => patchRoute(route.id, { requires: { ...route.requires, minTier: event.target.value === '' ? undefined : Number(event.target.value) } })}>
              <option value="">不限</option>
              {tierOptions.map((name, index) => <option key={index} value={index}>{name}</option>)}
            </select>
          </Field>
        )}
        <Field label="其他" wide group>
          <div className="map-editor__toggles">
            <label><input type="checkbox" checked={route.hidden === true} onChange={event => patchRoute(route.id, { hidden: event.target.checked || undefined })} />隐秘路线（发现前不显示）</label>
            <label><input type="checkbox" checked={route.oneWay === true} onChange={event => patchRoute(route.id, { oneWay: event.target.checked || undefined })} />单向</label>
          </div>
        </Field>
      </div>
    </>
  ) : (
    <>
      <div className="map-editor__inspector-title"><Sparkles size={14} />地图设置</div>
      <div className="map-editor__grid">
        <Field label="地图名" wide><input value={map.title ?? ''} placeholder={world.name ? `${world.name}舆图` : '世界舆图'} onChange={event => commit({ ...map, title: event.target.value || undefined }, 'title')} /></Field>
        <Field label="画风">
          <select value={map.theme} onChange={event => commit({ ...map, theme: event.target.value as MapThemeSetting })}>
            <option value="auto">自动（{THEME_LABELS[resolveMapTheme('auto', world)]}）</option>
            {(['ancient', 'modern', 'scifi'] as const).map(key => <option key={key} value={key}>{THEME_LABELS[key]}</option>)}
          </select>
        </Field>
        <Field label="大地形">
          <select value={map.landform} onChange={event => commit({ ...map, landform: event.target.value as MapLandform })}>
            {(Object.keys(LANDFORM_LABELS) as MapLandform[]).map(key => <option key={key} value={key}>{LANDFORM_LABELS[key]}</option>)}
          </select>
        </Field>
        <Field label="尺度（影响赶路速度）">
          <select value={map.scale} onChange={event => commit({ ...map, scale: event.target.value as MapScale })}>
            {(Object.keys(SCALE_LABELS) as MapScale[]).map(key => <option key={key} value={key}>{scaleName(key, theme)}</option>)}
          </select>
        </Field>
        <Field label="地形种子" group>
          <div className="map-editor__seed">
            <input type="number" aria-label="地形种子" value={map.seed} onChange={event => commit({ ...map, seed: Math.abs(Math.trunc(Number(event.target.value) || 1)) }, 'seed')} />
            <button type="button" className="map-editor__icon" onClick={() => commit({ ...map, seed: Math.floor(Math.random() * 2147483646) + 1 })} aria-label="换一片山川" title="换一片山川"><Dices size={14} /></button>
          </div>
        </Field>
        <Field label="开局位置">
          <select value={map.startLocationId ?? ''} onChange={event => commit({ ...map, startLocationId: event.target.value || undefined })}>
            {locationOptions.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </Field>
        <Field label="迷雾与遭遇" wide group>
          <div className="map-editor__toggles">
            <label><input type="checkbox" checked={map.fog !== false} onChange={event => commit({ ...map, fog: event.target.checked })} />只显示知道和走过的地方</label>
            {links.combat && <label><input type="checkbox" checked={map.travel?.ambush !== false} onChange={event => commit({ ...map, travel: { ...map.travel, ambush: event.target.checked ? undefined : false } })} />危险路段可能遇伏（战斗）</label>}
          </div>
        </Field>
        <NumberField label="步行速度（分钟 / 单位）" value={map.travel?.minutesPerUnit} step={0.05} min={0.01} placeholder={`默认 ${map.scale === 'city' ? 0.12 : map.scale === 'region' ? 0.6 : 2.4}`} onChange={value => commit({ ...map, travel: { ...map.travel, minutesPerUnit: value || undefined } }, 'speed')} />
        <NumberField label="每小时体力" value={map.travel?.staminaPerHour} step={0.5} min={0} placeholder="默认 5" onChange={value => commit({ ...map, travel: { ...map.travel, staminaPerHour: value } }, 'stamina')} />
        {links.resources.length > 0 && (
          <Field label="每赶路 8 小时额外消耗" wide group>
            <div className="map-editor__gather">
              {links.resources.map(resource => (
                <div key={resource.id} className={`map-editor__gather-row${map.travel?.supplies?.[resource.id] ? ' is-active' : ''}`}>
                  <span>{resource.name}</span>
                  <input type="number" min={0} step={0.5} value={map.travel?.supplies?.[resource.id] ?? 0} onChange={event => {
                    const supplies = { ...(map.travel?.supplies ?? {}) };
                    const amount = Number(event.target.value) || 0;
                    if (amount > 0) supplies[resource.id] = amount; else delete supplies[resource.id];
                    commit({ ...map, travel: { ...map.travel, supplies: Object.keys(supplies).length ? supplies : undefined } }, `supply:${resource.id}`);
                  }} aria-label={`${resource.name}`} />
                </div>
              ))}
            </div>
          </Field>
        )}
      </div>
      <p className="map-editor__hint">画布工具：<b>V</b> 选择拖动 · <b>A</b> 点击添加地点 · <b>C</b> 依次点两个地点连路 · <b>R</b> 添加地区。拖动地区中心改位置，选中后拖右侧把手改半径。<b>Delete</b> 删除，<b>Ctrl+Z</b> 撤销。</p>
    </>
  );

  const counts = `${map.regions.length} 个地区 · ${map.locations.length} 个地点 · ${map.routes.length} 条路线`;
  const tools: Array<{ id: MapEditTool; icon: typeof MousePointer2; label: string; key: string }> = [
    { id: 'select', icon: MousePointer2, label: '选择 / 拖动', key: 'V' },
    { id: 'add', icon: MapPin, label: '添加地点', key: 'A' },
    { id: 'connect', icon: Cable, label: '连路', key: 'C' },
    { id: 'region', icon: MapPinned, label: '添加地区', key: 'R' },
  ];

  return (
    <>
      {dialog.DialogUI}
      <div className="map-editor__backdrop" aria-hidden="true" />
      <section className="map-editor" role="dialog" aria-modal="true" aria-label="地图编辑器">
        <DawnFrameV4 mode="panel" withFill className="map-editor__frame" ariaLabel="地图编辑器">
          <div className="map-editor__shell">
            <header className="map-editor__header">
              <div className="map-editor__heading">
                <span className="map-editor__kicker">ATLAS FORGE · 地图编辑器</span>
                <h2>{map.title || (world.name ? `${world.name} · 舆图` : '世界舆图')}</h2>
                <p>{counts}{pending.length ? ` · 世界书里还有 ${pending.length} 处没上图` : ''}</p>
              </div>
              <div className="map-editor__actions">
                <div className="map-editor__group map-editor__group--ai" role="group" aria-label="AI">
                  <button type="button" className="btn-primary btn-sm" onClick={onAiGenerate} disabled={!onAiGenerate || !aiAvailable || generating !== null} title={aiAvailable ? '按世界设定与世界书的地点生成整张地图' : '先在设置里配置 API'}>
                    {generating === 'map' ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}AI 生成地图
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={onAiPlace} disabled={!onAiPlace || !aiAvailable || generating !== null || !pending.length || !map.locations.length} title="让 AI 按描述把还没上图的地点放上去">
                    {generating === 'place' ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}AI 补全坐标{pending.length ? `（${pending.length}）` : ''}
                  </button>
                </div>
                <div className="map-editor__group" role="group" aria-label="本地工具">
                  <button type="button" className="btn-ghost btn-sm" onClick={() => commit(placePendingLocally(map, pending))} disabled={!pending.length || !map.locations.length} title="不调用 AI，按方位粗略放上去"><MapPin size={14} />放上未上图的地点</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={sketch} title="不调用 AI，按地名与描述排一张草图"><MapPinned size={14} />本地草图</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={autoRoutes} disabled={map.locations.length < 2} title="把离得近、还没连上的地点接进路网"><Route size={14} />自动连路</button>
                  <select className="map-editor__template" value="" onChange={event => { if (event.target.value) applyTemplate(event.target.value as MapTheme); }} aria-label="从模板开始">
                    <option value="">从模板开始…</option>
                    {(Object.keys(MAP_TEMPLATES) as MapTheme[]).map(key => <option key={key} value={key}>{MAP_TEMPLATES[key].label}</option>)}
                  </select>
                </div>
              </div>
              <button type="button" className="map-editor__close" onClick={onClose} aria-label="关闭地图编辑器" title="关闭（Esc）"><X size={18} /></button>
            </header>

            <div className="map-editor__body">
              <aside className="map-editor__lists" aria-label="地点、地区与路线">
                <div className="map-editor__tabs" role="tablist">
                  {([['locations', `地点 ${map.locations.length}`], ['regions', `地区 ${map.regions.length}`], ['routes', `路线 ${map.routes.length}`]] as Array<[Tab, string]>).map(([key, label]) => (
                    <button type="button" key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>
                  ))}
                </div>
                <input className="map-editor__search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称" aria-label="搜索" />
                <ul className="map-editor__list">
                  {tab === 'locations' && map.locations.filter(item => filter(item.name)).map(item => {
                    const Icon = placeIcon(theme, item.kind);
                    return (
                      <li key={item.id}><button type="button" className={location?.id === item.id ? 'is-active' : ''} onClick={() => setSelection({ type: 'location', id: item.id })}>
                        <i className={`map-editor__glyph${item.kind === 'capital' ? ' is-capital' : ''}`} aria-hidden="true"><Icon size={13} /></i>
                        <b>{item.name}</b>
                        <span>{LOCATION_KIND_LABELS[item.kind]}{regionName.get(item.regionId ?? '') ? ` · ${regionName.get(item.regionId ?? '')}` : ''}</span>
                        {map.startLocationId === item.id ? <em className="is-start">开局</em> : item.danger ? <em className={item.danger >= 3 ? 'is-danger' : ''}>危 {item.danger}</em> : null}
                      </button></li>
                    );
                  })}
                  {tab === 'regions' && map.regions.filter(item => filter(item.name)).map(item => (
                    <li key={item.id}><button type="button" className={region?.id === item.id ? 'is-active' : ''} onClick={() => setSelection({ type: 'region', id: item.id })}>
                      <i className="map-editor__swatch" aria-hidden="true" style={{ '--swatch': regionAccent.get(item.id) ?? item.color ?? '#c89b4b' } as CSSProperties} />
                      <b>{item.name}</b>
                      <span>{TERRAIN_LABELS[item.terrain]} · {map.locations.filter(place => place.regionId === item.id).length} 处地点</span>
                      {item.danger ? <em className={item.danger >= 3 ? 'is-danger' : ''}>危 {item.danger}</em> : null}
                    </button></li>
                  ))}
                  {tab === 'routes' && map.routes.filter(item => filter(`${locationName.get(item.from) ?? ''}${locationName.get(item.to) ?? ''}${item.name ?? ''}`)).map(item => (
                    <li key={item.id}><button type="button" className={route?.id === item.id ? 'is-active' : ''} onClick={() => setSelection({ type: 'route', id: item.id })}>
                      <i className={`map-editor__line map-legend-line is-${item.kind}${(item.danger ?? 0) >= 3 ? ' is-danger' : ''}`} aria-hidden="true" />
                      <b>{locationName.get(item.from) ?? item.from} — {locationName.get(item.to) ?? item.to}</b>
                      <span>{item.name || routeKindLabel(item.kind, theme)}{item.minutes ? ` · ${formatMinutes(item.minutes)}` : ''}{item.hidden ? ' · 隐秘' : ''}{item.oneWay ? ' · 单向' : ''}</span>
                      {item.danger ? <em className={item.danger >= 3 ? 'is-danger' : ''}>危 {item.danger}</em> : null}
                    </button></li>
                  ))}
                  {((tab === 'locations' && !map.locations.length) || (tab === 'regions' && !map.regions.length) || (tab === 'routes' && !map.routes.length)) && (
                    <li className="map-editor__list-empty">{tab === 'locations' ? '还没有地点。用画布左侧的「添加地点」点一下地图。' : tab === 'regions' ? '还没有地区。地区决定地貌与归属，可用「添加地区」放一个。' : '还没有路线。用「连路」依次点两个地点，或点上方「自动连路」。'}</li>
                  )}
                </ul>
                {pending.length > 0 && (
                  <div className="map-editor__pending">
                    <strong>世界书里没上图的地点</strong>
                    <ul>{pending.slice(0, 12).map(item => <li key={item.name}>{item.name}</li>)}</ul>
                  </div>
                )}
              </aside>

              <main className="map-editor__canvas">
                {view && map.locations.length > 0 ? (
                  <>
                    <MapView view={view} theme={theme} initialMode="2d" selectedId={location?.id ?? null} onSelect={id => { setSelection(id ? { type: 'location', id } : null); if (id) setTab('locations'); }} edit={edit} focusCurrent={false} allowFullscreen={false} />
                    <div className="map-editor__tools" role="toolbar" aria-label="画布工具" aria-orientation="vertical">
                      {tools.map(item => (
                        <button type="button" key={item.id} className={tool === item.id ? 'is-active' : ''} aria-pressed={tool === item.id} aria-label={item.label} onClick={() => setTool(item.id)}>
                          <item.icon size={16} aria-hidden="true" /><span className="map-editor__tip">{item.label}<kbd>{item.key}</kbd></span>
                        </button>
                      ))}
                      <i className="map-editor__tools-rule" aria-hidden="true" />
                      <button type="button" onClick={undo} disabled={!history.current.length} aria-label="撤销"><Undo2 size={16} aria-hidden="true" /><span className="map-editor__tip">撤销<kbd>Ctrl Z</kbd></span></button>
                      <button type="button" onClick={redo} disabled={!future.current.length} aria-label="重做"><Redo2 size={16} aria-hidden="true" /><span className="map-editor__tip">重做<kbd>Ctrl ⇧ Z</kbd></span></button>
                      {selection && (
                        <>
                          <i className="map-editor__tools-rule" aria-hidden="true" />
                          <button type="button" className="is-danger" onClick={remove} aria-label="删除所选"><Trash2 size={16} aria-hidden="true" /><span className="map-editor__tip">删除所选<kbd>Del</kbd></span></button>
                        </>
                      )}
                    </div>
                    {toolHint && <p className="map-editor__tool-hint" role="status"><span>{toolHint}</span><kbd>Esc</kbd></p>}
                  </>
                ) : (
                  <div className="map-editor__empty">
                    <MapPinned size={34} aria-hidden="true" />
                    <h3>这张地图还是空白的</h3>
                    <p>可以让 AI 按世界设定一次画好，按「地理区域」里的地点排一张草图，或者从模板开始；之后都能在这里拖动微调。</p>
                    <div>
                      <button type="button" className="btn-primary" onClick={onAiGenerate} disabled={!onAiGenerate || !aiAvailable || generating !== null}>{generating === 'map' ? <Loader size={15} className="animate-spin" /> : <Sparkles size={15} />}AI 生成地图</button>
                      <button type="button" className="btn-secondary" onClick={() => commit(sketchMapFromLocations({ locations: pending, theme: map.theme, worldName: world.name, description: world.description, tags: world.tags ?? [], seed: map.seed }))} disabled={!pending.length}>按地理区域排草图</button>
                      {(Object.keys(MAP_TEMPLATES) as MapTheme[]).map(key => <button type="button" key={key} className="btn-ghost" onClick={() => commit({ ...MAP_TEMPLATES[key].build(), seed: map.seed })}>{MAP_TEMPLATES[key].label}</button>)}
                    </div>
                  </div>
                )}
              </main>

              <aside className="map-editor__inspector" aria-label="属性">
                {inspector}
              </aside>
            </div>

            <footer className="map-editor__footer">
              {disconnected.length > 0
                ? <span className="is-warn">有 {disconnected.length} 个地点没接进路网：{disconnected.slice(0, 5).join('、')}{disconnected.length > 5 ? '…' : ''}（可用「自动连路」）</span>
                : map.locations.length > 0 ? <span className="is-ok">路网连通，{map.locations.length} 个地点都能走到。</span> : <span>还没有地点。</span>}
              {!map.startLocationId && map.locations.length > 0 && <span className="is-warn">还没有设开局位置，默认用都城或第一个地点。</span>}
              <span className="map-editor__footer-spacer" />
              <span className="map-editor__footer-meta">{THEME_LABELS[theme]} · {LANDFORM_LABELS[map.landform]} · {scaleName(map.scale, theme)}</span>
              <span className="map-editor__footer-files">
                <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()} title="导入地图 JSON"><Upload size={14} />导入</button>
                <button type="button" className="btn-ghost btn-sm" onClick={exportJson} disabled={!map.locations.length} title="导出地图 JSON"><Download size={14} />导出</button>
                <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importJson(file); }} />
              </span>
              <button type="button" className="btn-primary btn-sm" onClick={onDone ?? onClose}>{doneLabel}</button>
            </footer>
          </div>
        </DawnFrameV4>
      </section>
    </>
  );
}
