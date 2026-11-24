/**
 * 世界编辑里的「世界地图」卡：整张地图的缩略图、规模与画风，打开地图编辑器、AI 生成整张地图或补全坐标。
 * 具体编辑都在 MapEditorWorkspace 里做；这里只是入口和概况。
 */
import { useMemo } from 'react';
import { Loader, MapPinned, PencilRuler, Sparkles, Wand2 } from 'lucide-react';
import type { WorldDef } from '../../../data/worlds-schema';
import { normalizeMapConfig, resolveMapTheme } from '../../../domains/map/config';
import { LANDFORM_LABELS, THEME_LABELS, scaleName, type MapModuleSchema } from '../../../domains/map/types';
import { buildMapViewModel } from '../../../domains/map/viewModel';
import Map2D from '../../map/Map2D';
import '../../../ui/screens/map.css';
import '../../../ui/screens/map-editor.css';

export interface MapModuleEditorProps {
  data: MapModuleSchema | Record<string, unknown> | undefined;
  world: Pick<WorldDef, 'name' | 'description' | 'tags' | 'modules'>;
  /** 世界书「地理区域」里还没上图的地点数。 */
  pendingCount: number;
  generating: 'map' | 'place' | null;
  aiAvailable: boolean;
  onOpenEditor: () => void;
  onAiGenerate?: () => void;
  onAiPlace?: () => void;
  /** 只显示一行概况（模块数据列表里用），完整卡片在「世界地图」一栏。 */
  summary?: boolean;
}

export function MapModuleEditor({ data, world, pendingCount, generating, aiAvailable, onOpenEditor, onAiGenerate, onAiPlace, summary = false }: MapModuleEditorProps) {
  const map = useMemo(() => normalizeMapConfig(data ?? {}), [data]);
  const theme = resolveMapTheme(map.theme, world);
  const view = useMemo(() => {
    if (summary || !map.locations.length) return null;
    const previewWorld = { id: 'map-module-preview', name: world.name || '世界', description: world.description || '', tags: world.tags ?? [], modules: world.modules } as WorldDef;
    return buildMapViewModel(previewWorld, null, { atlas: true, config: map });
  }, [summary, map, world]);
  const counts = map.locations.length
    ? `${map.regions.length} 个地区 · ${map.locations.length} 个地点 · ${map.routes.length} 条路线`
    : '还没有地点';
  const busy = generating !== null;
  const aiTitle = aiAvailable ? undefined : '先在设置里配置 API';

  if (summary) {
    return (
      <div className="map-module-card is-summary">
        <div className="map-module-card__copy">
          <strong><MapPinned size={14} aria-hidden="true" />{map.title || (world.name ? `${world.name}舆图` : '世界舆图')}</strong>
          <span>{counts} · {THEME_LABELS[theme]}{pendingCount ? ` · ${pendingCount} 处没上图` : ''}</span>
        </div>
        <button type="button" className="btn-secondary btn-sm" onClick={onOpenEditor}><PencilRuler size={13} />打开地图编辑器</button>
      </div>
    );
  }

  return (
    <div className="map-module-card">
      <button type="button" className={`map-module-card__stage${view ? '' : ' is-empty'}`} onClick={onOpenEditor} aria-label="打开地图编辑器">
        {view ? <Map2D view={view} theme={theme} compact /> : (
          <span className="map-module-card__blank"><MapPinned size={26} aria-hidden="true" /><b>还没有地图</b><small>AI 一键生成，或进编辑器手绘</small></span>
        )}
        <span className="map-module-card__open"><PencilRuler size={13} aria-hidden="true" />打开编辑器</span>
      </button>
      <div className="map-module-card__copy">
        <span className="map-module-card__kicker">WORLD ATLAS · 世界地图</span>
        <strong>{map.title || (world.name ? `${world.name}舆图` : '世界舆图')}</strong>
        <span>{counts}</span>
        <div className="map-module-card__tags">
          <span>{THEME_LABELS[theme]}</span><span>{LANDFORM_LABELS[map.landform]}</span><span>{scaleName(map.scale, theme)}</span>
          {map.fog !== false && <span>迷雾</span>}
        </div>
        {pendingCount > 0 && <p className="map-module-card__pending">「地理区域」里还有 {pendingCount} 处地点没上图{map.locations.length ? '，可以让 AI 按描述补上坐标。' : '，生成地图时会一起画进去。'}</p>}
        <p className="map-module-card__note">开局时玩家站在开局位置；正文里提到的地名会自动对上地图，赶路会消耗时间、体力和补给。</p>
        <div className="map-module-card__actions">
          <button type="button" className="btn-primary btn-sm" onClick={onOpenEditor}><PencilRuler size={14} />打开地图编辑器</button>
          <button type="button" className="btn-secondary btn-sm" onClick={onAiGenerate} disabled={!onAiGenerate || !aiAvailable || busy} title={aiTitle}>
            {generating === 'map' ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}{map.locations.length ? 'AI 重新生成' : 'AI 生成地图'}
          </button>
          {map.locations.length > 0 && pendingCount > 0 && (
            <button type="button" className="btn-ghost btn-sm" onClick={onAiPlace} disabled={!onAiPlace || !aiAvailable || busy} title={aiTitle}>
              {generating === 'place' ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}AI 补全坐标
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
