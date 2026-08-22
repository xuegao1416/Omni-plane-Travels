import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Compass,
  ExternalLink,
  Layers,
  MousePointer2,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { WorldDef } from '../../data/worldLoader';
import { resolveWorldArtwork } from '../../data/worldArtwork';
import type { GameSave, SaveMeta } from '../../storage/db';
import { TABS, type TabKey } from './stepWorldBrowser/constants';
import { normalizeExternal } from './stepWorldBrowser/constants';
import {
  CultureTab,
  EconomyTab,
  FactionsTab,
  LoreTab,
  NpcsTab,
  OverviewTab,
  RulesTab,
  SystemsTab,
} from './stepWorldBrowser/WorldDetailTabs';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';
import { EntrySlicedButton } from './EntrySurface';
import SaveArchiveView from './SaveArchiveView';
import { playHallSound } from '../../utils/hallAudio';
import { canAdvanceHallPage, getHallPageCount } from './worldHallPagination';

const DEV_LAYOUT_SIGNAL = Boolean(
  (import.meta.env?.DEV as unknown) === true
  || import.meta.hot
  || (typeof window !== 'undefined'
    && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname)),
);
const DevLayoutCalibrationStudio = DEV_LAYOUT_SIGNAL
  ? lazy(() => import('../../dev/layout-calibration/LayoutCalibrationStudio'))
  : null;

const BASE_VARIANTS = [0, 1, 0, 2, 1, 0];
  // Fixed 800×580 hall canvas: rear, middle, then front platforms.
const BUILTIN_WORLD_ORDER = [
  'japanese_school',
  'desire_metropolis',
  'wuxia_world',
  'wasteland_apocalypse',
  'stranded_island',
  'border_trade',
] as const;
const BUILTIN_WORLD_SET = new Set<string>(BUILTIN_WORLD_ORDER);
const HALL_SLOT_ORDER = ['border_trade', 'wasteland_apocalypse', 'japanese_school', 'desire_metropolis', 'stranded_island', 'wuxia_world'] as const;

type HallWorldId = typeof BUILTIN_WORLD_ORDER[number];
type HallLayoutKey = '21x9' | '16x9' | '40x29' | '1x1' | '9x16';
type CrystalVariant = 'C' | 'D';

interface HallNodeSize {
  width: string;
  height: string;
}

interface HallAnchor {
  x: number;
  y: number;
  scale: number;
  layoutScale?: number;
  captionScale?: number;
  offsetX: number;
  offsetY: number;
}

interface HallFireAnchor {
  x: number;
  y: number;
  offsetY: number;
  scale: number;
  width?: string;
  height?: string;
  flame?: HallFireLayerCalibration;
  pedestal?: HallFireLayerCalibration;
}

interface HallFireLayerCalibration {
  offsetXPct?: number;
  offsetYPct?: number;
  scaleX?: number;
  scaleY?: number;
  cropBottomPct?: number;
}

interface HallOverlayAnchor {
  x: number;
  y: number;
  width: string;
  height: string;
  borderOpacity: number;
}

interface HallLayout {
  background: string;
  aspect: number;
  nodeWidth: string;
  nodeHeight: string;
  anchors: Record<HallWorldId, HallAnchor>;
  fire: HallFireAnchor;
  anchorMode?: 'center';
  nodeSizes?: Record<CrystalVariant, HallNodeSize>;
  nav?: HallOverlayAnchor;
  back?: HallOverlayAnchor;
}

const HALL_LAYOUTS: Record<HallLayoutKey, HallLayout> = {
  '21x9': {
    background: '/art/theme/entry/hall-background-21x9-v2.png',
    aspect: 1915 / 821,
    nodeWidth: '9%',
    nodeHeight: '28%',
    anchors: {
      border_trade: { x: .25, y: .67, scale: .58, offsetX: 0, offsetY: 0 },
      wasteland_apocalypse: { x: .33, y: .65, scale: .58, offsetX: 0, offsetY: 0 },
      japanese_school: { x: .40, y: .63, scale: .58, offsetX: 0, offsetY: 0 },
      desire_metropolis: { x: .60, y: .63, scale: .58, offsetX: 0, offsetY: 0 },
      stranded_island: { x: .67, y: .65, scale: .58, offsetX: 0, offsetY: 0 },
      wuxia_world: { x: .75, y: .67, scale: .58, offsetX: 0, offsetY: 0 },
    },
    fire: { x: .50, y: .70, offsetY: 0, scale: 1 },
  },
  '16x9': {
    background: '/art/theme/entry/hall-background-16x9-v3.png',
    aspect: 1672 / 941,
    nodeWidth: '10%',
    nodeHeight: '24%',
    anchorMode: 'center',
    nodeSizes: {
      C: { width: '11.0653%', height: '31.8134%' },
      D: { width: '9.9460%', height: '29.1622%' },
    },
    anchors: {
      border_trade: { x: .1112930538, y: .4731198865, scale: 1, offsetX: 0, offsetY: 0 },
      wasteland_apocalypse: { x: .2383114162, y: .4363046227, scale: 1, offsetX: 0, offsetY: 0 },
      japanese_school: { x: .3610848153, y: .4332815037, scale: 1, offsetX: 0, offsetY: 0 },
      desire_metropolis: { x: .6435738907, y: .4399534417, scale: 1, offsetX: 0, offsetY: 0 },
      stranded_island: { x: .7509005229, y: .4418059077, scale: 1, offsetX: 0, offsetY: 0 },
      wuxia_world: { x: .8834112412, y: .4738922593, scale: 1, offsetX: 0, offsetY: 0 },
    },
    fire: {
      x: .5011769590,
      y: .4803197454,
      offsetY: 0,
      scale: 1,
      width: '16.9339%',
      height: '37.2255%',
      flame: { offsetYPct: 40.2610, scaleX: 1.046335, scaleY: 1.149808, cropBottomPct: 30 },
      pedestal: { offsetYPct: 21.5349, scaleX: 1.104314, scaleY: 1.045537 },
    },
    nav: { x: .8510781044, y: .0395759758, width: '475.4688px', height: '52px', borderOpacity: .9 },
    back: { x: .0500196160, y: .9632508634, width: '140.6667px', height: '44px', borderOpacity: .28 },
  },
  '40x29': {
    background: '/art/theme/entry/hall-background-40x29-v2.png',
    aspect: 1473 / 1068,
    nodeWidth: '11%',
    nodeHeight: '20%',
    anchors: {
      border_trade: { x: .10, y: .64, scale: .68, offsetX: 0, offsetY: 0 },
      wasteland_apocalypse: { x: .24, y: .61, scale: .68, offsetX: 0, offsetY: 0 },
      japanese_school: { x: .34, y: .57, scale: .68, offsetX: 0, offsetY: 0 },
      desire_metropolis: { x: .66, y: .57, scale: .68, offsetX: 0, offsetY: 0 },
      stranded_island: { x: .76, y: .61, scale: .68, offsetX: 0, offsetY: 0 },
      wuxia_world: { x: .90, y: .64, scale: .68, offsetX: 0, offsetY: 0 },
    },
    fire: { x: .50, y: .69, offsetY: 0, scale: 1.6, flame: { offsetYPct: 7 } },
  },
  '1x1': {
    background: '/art/theme/entry/hall-background-1x1-v2.png',
    aspect: 1,
    nodeWidth: '12%',
    nodeHeight: '16%',
    anchors: {
      border_trade: { x: .09, y: .70, scale: .74, offsetX: 0, offsetY: 0 },
      wasteland_apocalypse: { x: .20, y: .64, scale: .72, offsetX: 0, offsetY: 0 },
      japanese_school: { x: .32, y: .60, scale: .70, offsetX: 0, offsetY: 0 },
      desire_metropolis: { x: .68, y: .60, scale: .70, offsetX: 0, offsetY: 0 },
      stranded_island: { x: .80, y: .64, scale: .74, offsetX: 0, offsetY: 0 },
      wuxia_world: { x: .91, y: .70, scale: .72, offsetX: 0, offsetY: 0 },
    },
    fire: { x: .50, y: .73, offsetY: 0, scale: 1.8, flame: { offsetYPct: 7 } },
  },
  '9x16': {
    background: '/art/theme/entry/hall-background-9x16-v3.png',
    aspect: 853 / 1844,
    nodeWidth: '12%',
    nodeHeight: '9%',
    anchorMode: 'center',
    nodeSizes: {
      C: { width: '20.0483%', height: '14.7321%' },
      D: { width: '17.6329%', height: '13.7277%' },
    },
    anchors: {
      japanese_school: { x: .2680118092, y: .3632813650, scale: 1, offsetX: 0, offsetY: 0 },
      desire_metropolis: { x: .7349057293, y: .3624981259, scale: 1, offsetX: 0, offsetY: 0 },
      wasteland_apocalypse: { x: .1902118238, y: .4701794556, scale: 1, offsetX: 0, offsetY: 0 },
      stranded_island: { x: .8112740047, y: .4745852734, scale: 1, offsetX: 0, offsetY: 0 },
      border_trade: { x: .1655079375, y: .6115370989, scale: 1, offsetX: 0, offsetY: 0 },
      wuxia_world: { x: .8328407447, y: .6192507063, scale: 1, offsetX: 0, offsetY: 0 },
    },
    fire: {
      x: .5067600244,
      y: .2716401411,
      offsetY: 0,
      scale: 1,
      width: '33.4668vw',
      height: '61.2725vh',
      flame: { offsetYPct: 20.0907, scaleX: 1.020260, scaleY: 1.023611, cropBottomPct: 29 },
      pedestal: { offsetYPct: 1.8215 },
    },
    nav: { x: .6902165436, y: .0507322906, width: '240.1146px', height: '79.3333px', borderOpacity: .26 },
    back: { x: .1568161232, y: .96875, width: '107.8438px', height: '36px', borderOpacity: .28 },
  },
};

function getHallLayoutKey(ratio: number): HallLayoutKey {
  if (ratio >= 2) return '21x9';
  if (ratio >= 1.5) return '16x9';
  if (ratio >= 1.2) return '40x29';
  if (ratio >= .8) return '1x1';
  return '9x16';
}

const CRYSTAL_ASSETS: Record<CrystalVariant, string> = {
  C: '/art/theme/crystals/crystal-c.png',
  D: '/art/theme/crystals/crystal-d-v2.png',
};

const WORLD_HALL_ASSETS: Record<string, { scene: string; crystal: CrystalVariant; emblem: string }> = {
  japanese_school: { scene: '/art/theme/worlds/japanese_school-scene.png', crystal: 'D', emblem: '/art/theme/emblems/emblem-01-v2.png' },
  desire_metropolis: { scene: '/art/theme/worlds/desire_metropolis-scene.png', crystal: 'D', emblem: '/art/theme/emblems/emblem-02-v2.png' },
  wuxia_world: { scene: '/art/theme/worlds/wuxia_world-scene.png', crystal: 'C', emblem: '/art/theme/emblems/emblem-03-v2.png' },
  wasteland_apocalypse: { scene: '/art/theme/worlds/wasteland_apocalypse-scene.png', crystal: 'C', emblem: '/art/theme/emblems/emblem-04-v2.png' },
  stranded_island: { scene: '/art/theme/worlds/stranded_island-scene.png', crystal: 'D', emblem: '/art/theme/emblems/emblem-05-v2.png' },
  border_trade: { scene: '/art/theme/worlds/border_trade-scene.png', crystal: 'C', emblem: '/art/theme/emblems/emblem-06-v2.png' },
};

const CRYSTAL_CLIPS: Record<CrystalVariant, string> = {
  C: 'polygon(50% 0%, 82% 18%, 94% 50%, 82% 82%, 50% 100%, 18% 82%, 6% 50%, 18% 18%)',
  D: 'polygon(50% 3%, 66% 13%, 83% 26%, 94% 46%, 92% 66%, 82% 81%, 66% 94%, 50% 99%, 34% 94%, 18% 81%, 8% 66%, 6% 46%, 17% 26%, 34% 13%)',
};

function getWorldHallAssets(world: WorldDef, index: number) {
  return WORLD_HALL_ASSETS[world.id] ?? {
    scene: resolveWorldArtwork(world).src,
    crystal: (['C', 'D'] as CrystalVariant[])[index % 2],
    emblem: `/art/theme/emblems/emblem-${String(index + 1).padStart(2, '0')}-v2.png`,
  };
}

const HALL_EMBER_COUNT = 12;
const HALL_FIRE_ASSET = '/art/theme/entry/morning-ritual-fire-v1.png';
const HALL_FIRE_PEDESTAL_ASSET = '/art/theme/entry/morning-ritual-pedestal-v2.png';

function SacredFire() {
  return (
    <span className="entry-hall-portal__sacred-fire" aria-hidden="true">
      <svg className="entry-hall-portal__fire-filters" width="0" height="0" focusable="false">
        <defs>
          <filter id="entry-sacred-fire-warp" x="-24%" y="-18%" width="148%" height="142%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.026" numOctaves="2" seed="7" result="fireNoise">
              <animate attributeName="baseFrequency" dur="3.4s" values="0.008 0.026;0.012 0.034;0.006 0.029;0.008 0.026" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="fireNoise" scale="9" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <span
        className="entry-hall-portal__flame-stage"
        data-layout-id="hall.fire.flame"
        data-layout-label="圣火 · 火焰动画层"
        data-layout-editable="true"
        data-layout-container="hall.fire"
        data-layout-origin="bottom center"
        data-layout-kind="fire-flame"
      >
        <img className="entry-hall-portal__flame entry-hall-portal__flame--outer" src={HALL_FIRE_ASSET} alt="" />
      </span>
      <img
        className="entry-hall-portal__pedestal"
        src={HALL_FIRE_PEDESTAL_ASSET}
        alt=""
        data-layout-id="hall.fire.pedestal"
        data-layout-label="圣火 · 水晶底座"
        data-layout-editable="true"
        data-layout-container="hall.fire"
        data-layout-origin="bottom center"
      />
    </span>
  );
}

function HallEmbers() {
  return (
    <span className="entry-hall-portal__embers" aria-hidden="true">
      {Array.from({ length: HALL_EMBER_COUNT }, (_, index) => (
        <i
          key={index}
          data-hall-ember
          style={{
            '--entry-ember-x': `${18 + ((index * 29) % 64)}%`,
            '--entry-ember-y': `${40 + ((index * 17) % 34)}%`,
            '--entry-ember-delay': `${-((index * .41) % 2.8)}s`,
            '--entry-ember-duration': `${2.3 + (index % 4) * .32}s`,
            '--entry-ember-drift': `${index % 2 === 0 ? 1 : -1}${3 + (index % 4)}px`,
          } as CSSProperties}
        />
      ))}
    </span>
  );
}

interface WorldHallViewProps {
  allWorlds: WorldDef[];
  allSaves: SaveMeta[];
  currentSaveId: string | null;
  selectedWorld: string;
  setSelectedWorld: (id: string) => void;
  onBackToHome: () => void;
  onStartWizard: () => void;
  onOpenEvents: () => void;
  onOpenCustomModules: () => void;
  onOpenSettings: () => void;
  onOpenUserCenter: () => void;
  onOpenEditor: (world: WorldDef | null, step?: number) => void;
  onDeleteWorld: (worldId: string) => void | Promise<{ ok: boolean }>;
  onImportWorld: (world: WorldDef) => void;
  onLoadSave: (save: GameSave) => void;
  onDeleteSave: (id: string) => void | Promise<void>;
  onImportSave: (file: File) => void | Promise<void>;
  onExportSave: (id: string) => void | Promise<void>;
}

export default function WorldHallView({
  allWorlds,
  allSaves,
  currentSaveId,
  selectedWorld,
  setSelectedWorld,
  onBackToHome,
  onStartWizard,
  onOpenEvents,
  onOpenCustomModules,
  onOpenSettings,
  onOpenUserCenter,
  onOpenEditor,
  onDeleteWorld,
  onImportWorld,
  onLoadSave,
  onDeleteSave,
  onImportSave,
  onExportSave,
}: WorldHallViewProps) {
  const worlds = useMemo(
    () => BUILTIN_WORLD_ORDER.map(id => allWorlds.find(world => world.id === id)).filter((world): world is WorldDef => Boolean(world)),
    [allWorlds],
  );
  const customWorlds = useMemo(() => allWorlds.filter(world => !BUILTIN_WORLD_SET.has(world.id)), [allWorlds]);
  const pageCount = getHallPageCount(customWorlds.length);
  const [hallPage, setHallPage] = useState(0);
  const [emptySlotOpen, setEmptySlotOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [activeWorldId, setActiveWorldId] = useState(() => (
    allWorlds.some(world => world.id === selectedWorld) ? selectedWorld : worlds[0]?.id ?? ''
  ));
  const [detailOpen, setDetailOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const layoutEditorEnabled = Boolean(
    DevLayoutCalibrationStudio
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('layoutEditor') === '1',
  );
  const [hallLayoutKey, setHallLayoutKey] = useState<HallLayoutKey>(() => (
    getHallLayoutKey(typeof window === 'undefined' ? 16 / 9 : window.innerWidth / window.innerHeight)
  ));

  useEffect(() => {
    const updateHallLayout = () => {
      const nextLayout = getHallLayoutKey(window.innerWidth / window.innerHeight);
      setHallLayoutKey(currentLayout => currentLayout === nextLayout ? currentLayout : nextLayout);
    };

    updateHallLayout();
    window.addEventListener('resize', updateHallLayout);
    return () => window.removeEventListener('resize', updateHallLayout);
  }, []);

  useEffect(() => {
    const customIndex = customWorlds.findIndex(world => world.id === selectedWorld);
    if (customIndex >= 0) setHallPage(1 + Math.floor(customIndex / 6));
    if (allWorlds.some(world => world.id === selectedWorld)) setActiveWorldId(selectedWorld);
  }, [allWorlds, customWorlds, selectedWorld]);

  useEffect(() => {
    setHallPage(page => Math.min(page, pageCount - 1));
  }, [pageCount]);

  const pageWorlds = hallPage === 0 ? worlds : customWorlds.slice((hallPage - 1) * 6, hallPage * 6);
  const canGoToNextPage = canAdvanceHallPage(hallPage, pageWorlds.length);
  const activeWorld = pageWorlds.find(world => world.id === activeWorldId) ?? ({
    id: '__empty_hall_slot__',
    name: hallPage === 0 ? '请选择一枚世界晶体' : '空晶体等待编织',
    description: '',
  } as WorldDef);
  const activeWorldName = activeWorld.name;
  const hallLayout = HALL_LAYOUTS[hallLayoutKey];
  const hallStyle = {
    '--entry-hall-background': `url("${hallLayout.background}")`,
    '--entry-stage-aspect': hallLayout.aspect,
    '--entry-node-width': hallLayout.nodeWidth,
    '--entry-node-height': hallLayout.nodeHeight,
    '--entry-fire-x': hallLayout.fire.x,
    '--entry-fire-y': hallLayout.fire.y,
    '--entry-fire-offset-y': `${hallLayout.fire.offsetY}px`,
    '--entry-fire-width': hallLayout.fire.width ?? `${8.5 * hallLayout.fire.scale}%`,
    '--entry-fire-height': hallLayout.fire.height ?? `${26 * hallLayout.fire.scale}%`,
    '--entry-flame-offset-x': `${hallLayout.fire.flame?.offsetXPct ?? 0}%`,
    '--entry-flame-offset-y': `${hallLayout.fire.flame?.offsetYPct ?? 0}%`,
    '--entry-flame-scale-x': hallLayout.fire.flame?.scaleX ?? 1,
    '--entry-flame-scale-y': hallLayout.fire.flame?.scaleY ?? 1,
    '--entry-flame-crop-bottom': `${hallLayout.fire.flame?.cropBottomPct ?? 28}%`,
    '--entry-pedestal-offset-x': `${hallLayout.fire.pedestal?.offsetXPct ?? 0}%`,
    '--entry-pedestal-offset-y': `${hallLayout.fire.pedestal?.offsetYPct ?? 0}%`,
    '--entry-pedestal-scale-x': hallLayout.fire.pedestal?.scaleX ?? 1,
    '--entry-pedestal-scale-y': hallLayout.fire.pedestal?.scaleY ?? 1,
    '--entry-hall-nav-x': hallLayout.nav?.x ?? 0,
    '--entry-hall-nav-y': hallLayout.nav?.y ?? 0,
    '--entry-hall-nav-width': hallLayout.nav?.width ?? 'auto',
    '--entry-hall-nav-height': hallLayout.nav?.height ?? 'auto',
    '--entry-hall-nav-border-opacity': hallLayout.nav?.borderOpacity ?? .26,
    '--entry-hall-back-x': hallLayout.back?.x ?? 0,
    '--entry-hall-back-y': hallLayout.back?.y ?? 0,
    '--entry-hall-back-width': hallLayout.back?.width ?? 'auto',
    '--entry-hall-back-height': hallLayout.back?.height ?? 'auto',
    '--entry-hall-back-border-opacity': hallLayout.back?.borderOpacity ?? .28,
  } as CSSProperties;
  const handleWorldSelect = (world: WorldDef) => {
    setActiveWorldId(world.id);
    setSelectedWorld(world.id);
    setDetailOpen(true);
  };

  const closeEmptySlot = () => {
    setEmptySlotOpen(false);
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.entry-world-node--empty button')?.focus());
  };
  const handleEmptySlot = () => {
    playHallSound('crystalSelect');
    setEmptySlotOpen(true);
  };
  const handleDeleteCustomWorld = async (worldId: string) => {
    const result = await onDeleteWorld(worldId);
    if (result?.ok) {
      setDetailOpen(false);
      setActiveWorldId('');
    }
  };
  useEffect(() => {
    if (!emptySlotOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeEmptySlot(); } };
    document.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.entry-hall-empty-choice__close')?.focus());
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [emptySlotOpen]);
  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const isOurFormat = (Array.isArray(data.worldBookEntries) && data.worldBookEntries.some((entry: any) => typeof entry.entryType === 'string'))
          || Array.isArray(data.modules)
          || (typeof data.id === 'string' && data.id.startsWith('world_'));
        const imported = isOurFormat
          ? { ...data, id: data.id || `custom_${Date.now()}`, entryId: null, source: undefined } as WorldDef
          : normalizeExternal(data, file.name);
        if (!imported.name) throw new Error('导入世界缺少名称');
        onImportWorld(imported);
        setEmptySlotOpen(false);
      } catch { /* The existing editor/import flow reports malformed files; keep this slot chooser open. */ }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  return (
    <main className={`entry-default-theme entry-hall entry-hall--layout-${hallLayoutKey}${hallLayout.anchorMode === 'center' ? ' entry-hall--anchor-center' : ''}`} style={hallStyle} data-hall-layout={hallLayoutKey} data-layout-id="hall.screen">
      <div className="entry-hall-backdrop" aria-hidden="true" data-layout-id="hall.background" />
      <div className="entry-hall-shade" aria-hidden="true" data-layout-id="hall.veil" />
      <header className="entry-hall-header">
        <div className="entry-hall-brand">
          <span className="entry-hall-brand__mark"><Compass size={15} /></span>
          <span><b>世界漫游指南</b><small>OMNI PLANE TRAVELS</small></span>
        </div>
        <div className="entry-hall-header__actions" data-layout-id="hall.nav" data-layout-label="顶部导航整体" data-layout-editable="true" data-layout-container="hall.screen">
          <EntrySlicedButton frame="dawn-v4-compact" emblemSrc="/art/theme/emblems/emblem-26-v2.png" icon={Settings} onClick={() => { playHallSound('confirm'); onOpenSettings(); }} data-layout-id="hall.nav.save" data-layout-label="导航 · 设置" data-layout-editable="true" data-layout-container="hall.screen" data-layout-kind="compact">设置</EntrySlicedButton>
          <EntrySlicedButton frame="dawn-v4-compact" emblemSrc="/art/theme/emblems/emblem-07-v2.png" icon={Boxes} onClick={() => { playHallSound('confirm'); onOpenEvents(); }} data-layout-id="hall.nav.events" data-layout-label="导航 · 事件中心" data-layout-editable="true" data-layout-container="hall.screen" data-layout-kind="compact">事件中心</EntrySlicedButton>
          <EntrySlicedButton frame="dawn-v4-compact" emblemSrc="/art/theme/emblems/emblem-13-v2.png" icon={Sparkles} onClick={() => { playHallSound('confirm'); onOpenCustomModules(); }} data-layout-id="hall.nav.modules" data-layout-label="导航 · 自定义模块" data-layout-editable="true" data-layout-container="hall.screen" data-layout-kind="compact">自定义模块</EntrySlicedButton>
          <EntrySlicedButton frame="dawn-v4-compact" emblemSrc="/art/theme/emblems/emblem-25-v2.png" icon={MousePointer2} onClick={() => { playHallSound('confirm'); onOpenUserCenter(); }} data-layout-id="hall.nav.account" data-layout-label="导航 · 账号" data-layout-editable="true" data-layout-container="hall.screen" data-layout-kind="compact">账号</EntrySlicedButton>
        </div>
      </header>

      <section className="entry-hall-stage" aria-label="世界晶体大厅" data-layout-id="hall.stage">
        <div className="entry-hall-orbit entry-hall-orbit--outer" aria-hidden="true" />
        <div className="entry-hall-orbit entry-hall-orbit--inner" aria-hidden="true" />
        <div className="entry-hall-ritual-lines" aria-hidden="true" />
        <div key={`hall-page-fx-${hallPage}`} className="entry-hall-stage__page-fx" aria-hidden="true" />

        <button type="button" className="entry-hall-portal" onClick={() => setArchiveOpen(true)} aria-label="打开存档空间接口" data-layout-id="hall.fire" data-layout-label="中央晨光篝火" data-layout-editable="true" data-layout-container="hall.stage" data-layout-origin="bottom center">
          <SacredFire />
          <span className="entry-hall-portal__firelight" aria-hidden="true" />
          <HallEmbers />
          <span className="entry-hall-portal__halo" aria-hidden="true" />
          <span className="entry-hall-portal__core" aria-hidden="true"><Archive size={23} strokeWidth={1.2} /></span>
          <span className="entry-hall-portal__label">存档裂隙</span>
        </button>

        <div key={`hall-page-${hallPage}`} className="entry-hall-page-layer">
          {pageWorlds.map((world, index) => (
            <WorldCrystalNode
              key={world.id}
              world={world}
              index={index}
              anchor={hallLayout.anchors[(hallPage === 0 ? world.id : HALL_SLOT_ORDER[index]) as HallWorldId]}
              nodeSizes={hallLayout.nodeSizes}
              selected={activeWorldId === world.id}
              onSelect={() => handleWorldSelect(world)}
            />
          ))}

          {hallPage > 0 && pageWorlds.length < 6 && (
            <EmptyWorldCrystalNode
              index={pageWorlds.length}
              anchor={hallLayout.anchors[HALL_SLOT_ORDER[pageWorlds.length]]}
              nodeSizes={hallLayout.nodeSizes}
              onSelect={handleEmptySlot}
            />
          )}
        </div>

        <div className="entry-hall-instruction">
          <span className="entry-hall-instruction__eyebrow">THE HALL OF CROSSINGS</span>
          <strong>选择一枚世界晶体</strong>
          <span>悬停查看共鸣，点击展开世界详情</span>
        </div>
      </section>

      <footer className="entry-hall-footer">
        <nav className="entry-hall-pagination" aria-label="大厅分页">
          <button type="button" onClick={() => { playHallSound('back'); setDetailOpen(false); setHallPage(page => Math.max(0, page - 1)); }} disabled={hallPage === 0} aria-label="上一页"><ArrowLeft size={15} /></button>
          <span>{hallPage === 0 ? '内置' : hallPage}</span>
          <span className="entry-hall-pagination__dots">{Array.from({ length: pageCount }, (_, index) => <i key={index} className={index === hallPage ? 'is-active' : ''} />)}</span>
          <button type="button" onClick={() => { playHallSound('confirm'); setDetailOpen(false); setHallPage(page => page + 1); }} disabled={!canGoToNextPage} aria-label="下一页"><ArrowRight size={15} /></button>
        </nav>
        <EntrySlicedButton frame="dawn-v4-compact" emblemSrc="/art/theme/emblems/emblem-27-v2.png" icon={ArrowLeft} onClick={() => { playHallSound('back'); onBackToHome(); }} data-layout-id="hall.back" data-layout-label="左下返回首页" data-layout-editable="true" data-layout-container="hall.screen" data-layout-kind="compact">返回首页</EntrySlicedButton>
        <span className="entry-hall-footer__selected"><span /> 当前共鸣：{activeWorld.name}</span>
        <span className="entry-hall-footer__hint">拖尾光迹可在首页关闭</span>
      </footer>

      {activeWorld && detailOpen && (
        <WorldDetailOverlay
          key={activeWorld.id}
          world={activeWorld}
          onClose={() => { playHallSound('back'); setDetailOpen(false); }}
          onStart={() => { playHallSound('confirm'); onStartWizard(); }}
            isCustom={!BUILTIN_WORLD_SET.has(activeWorld.id)}
            onEdit={() => onOpenEditor(activeWorld, 4)}
            onDelete={() => void handleDeleteCustomWorld(activeWorld.id)}
        />
      )}

      {emptySlotOpen && (
        <div className="entry-hall-empty-choice" role="dialog" aria-modal="true" aria-labelledby="entry-hall-empty-choice-title" onClick={event => { if (event.target === event.currentTarget) closeEmptySlot(); }}>
          <div className="entry-hall-empty-choice__backdrop" aria-hidden="true" onClick={closeEmptySlot} />
          <DawnFrameV4 mode="panel" withFill className="entry-hall-empty-choice__frame" ariaLabel="新世界入口">
            <div className="entry-hall-empty-choice__content">
              <button type="button" className="entry-hall-empty-choice__close" onClick={closeEmptySlot} aria-label="关闭"><X size={18} /></button>
              <Sparkles size={22} aria-hidden="true" />
              <span className="entry-hall-empty-choice__kicker">NEW WORLD SLOT</span>
              <h2 id="entry-hall-empty-choice-title">编织一枚新世界</h2>
              <p>从世界编织仪式开始，或导入已有世界档案。</p>
              <div className="entry-hall-empty-choice__actions">
                <button type="button" onClick={() => { closeEmptySlot(); onOpenEditor(null); }}><Plus size={16} />创建世界</button>
                <button type="button" onClick={() => importInputRef.current?.click()}><Upload size={16} />导入世界</button>
              </div>
              <input ref={importInputRef} type="file" accept=".json,application/json" onChange={handleImportFile} hidden />
            </div>
          </DawnFrameV4>
        </div>
      )}

      {archiveOpen && (
        <SaveArchiveView
          allSaves={allSaves}
          currentSaveId={currentSaveId}
          onClose={() => { playHallSound('back'); setArchiveOpen(false); }}
          onLoadSave={onLoadSave}
          onCreateSave={onStartWizard}
          onDeleteSave={onDeleteSave}
          onImportSave={onImportSave}
          onExportSave={onExportSave}
        />
      )}

      {layoutEditorEnabled && DevLayoutCalibrationStudio && (
        <Suspense fallback={null}>
          <DevLayoutCalibrationStudio screen={archiveOpen ? 'save' : 'hall'} />
        </Suspense>
      )}

    </main>
  );
}

function WorldCrystalNode({
  world,
  index,
  anchor,
  nodeSizes,
  selected,
  onSelect,
}: {
  world: WorldDef;
  index: number;
  anchor: HallAnchor;
  nodeSizes?: Record<CrystalVariant, HallNodeSize>;
  selected: boolean;
  onSelect: () => void;
}) {
  const [isAwakening, setIsAwakening] = useState(false);
  const activationTimerRef = useRef<number | null>(null);
  const assets = getWorldHallAssets(world, index);
  const nodeSize = nodeSizes?.[assets.crystal];
  const style = {
    '--entry-angle': `${index * 60}deg`,
    '--entry-anchor-x': anchor.x,
    '--entry-anchor-y': anchor.y,
    '--entry-anchor-offset-x': `${anchor.offsetX}px`,
    '--entry-anchor-offset-y': `${anchor.offsetY}px`,
    '--entry-node-scale': anchor.scale * (anchor.layoutScale ?? 1),
    '--entry-caption-scale': anchor.captionScale ?? 1,
    '--entry-world-accent': world.coverColor ?? '#b99a6b',
    '--entry-scene-image': `url("${assets.scene}")`,
    '--entry-crystal-clip': CRYSTAL_CLIPS[assets.crystal],
    ...(nodeSize ? {
      '--entry-node-width': nodeSize.width,
      '--entry-node-height': nodeSize.height,
    } : {}),
  } as CSSProperties;
  const floatStyle = {
    '--entry-float-delay': `${-(index * .63 + .18)}s`,
    '--entry-float-duration': `${3.8 + (index % 4) * .42}s`,
  } as CSSProperties;

  useEffect(() => () => {
    if (activationTimerRef.current !== null) window.clearTimeout(activationTimerRef.current);
  }, []);

  const handleActivate = () => {
    if (activationTimerRef.current !== null) return;
    playHallSound('crystalSelect');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onSelect();
      return;
    }
    setIsAwakening(true);
    activationTimerRef.current = window.setTimeout(() => {
      activationTimerRef.current = null;
      setIsAwakening(false);
      onSelect();
    }, 360);
  };

  return (
    <div
      className="entry-world-node"
      style={style}
      data-base-variant={BASE_VARIANTS[index] ?? 0}
      data-layout-id={`hall.world.${world.id}`}
      data-layout-label={`世界节点 · ${world.name}`}
      data-layout-editable="true"
      data-layout-container="hall.stage"
      data-layout-origin="bottom center"
    >
      <button
        type="button"
        className={`entry-world-crystal${selected ? ' is-selected' : ''}${isAwakening ? ' is-awakening' : ''}`}
        onClick={handleActivate}
        aria-pressed={selected}
        aria-label={`查看世界：${world.name}`}
        data-crystal={assets.crystal}
      >
        <span className="entry-world-crystal__float-layer" style={floatStyle} aria-hidden="true">
          <span className="entry-world-crystal__halo" />
          <span className="entry-world-crystal__scene" />
          <img className="entry-world-crystal__art" src={CRYSTAL_ASSETS[assets.crystal]} alt="" />
          <span className="entry-world-crystal__glow" />
          {isAwakening && (
            <span className="entry-world-crystal__awakening">
              <i /><i /><i /><i /><i />
            </span>
          )}
        </span>
        <span className="entry-world-crystal__caption">
          <img src={assets.emblem} alt="" className="entry-world-crystal__emblem" />
          <span>{world.name}</span>
        </span>
      </button>
    </div>
  );
}

function EmptyWorldCrystalNode({
  index,
  anchor,
  nodeSizes,
  onSelect,
}: {
  index: number;
  anchor: HallAnchor;
  nodeSizes?: Record<CrystalVariant, HallNodeSize>;
  onSelect: () => void;
}) {
  const variant: CrystalVariant = BASE_VARIANTS[index] === 1 ? 'D' : 'C';
  const nodeSize = nodeSizes?.[variant];
  const style = {
    '--entry-angle': `${index * 60}deg`,
    '--entry-anchor-x': anchor.x,
    '--entry-anchor-y': anchor.y,
    '--entry-anchor-offset-x': `${anchor.offsetX}px`,
    '--entry-anchor-offset-y': `${anchor.offsetY}px`,
    '--entry-node-scale': anchor.scale * (anchor.layoutScale ?? 1),
    '--entry-crystal-clip': CRYSTAL_CLIPS[variant],
    ...(nodeSize ? { '--entry-node-width': nodeSize.width, '--entry-node-height': nodeSize.height } : {}),
  } as CSSProperties;
  const floatStyle = {
    '--entry-float-delay': `${-(index * .63 + .42)}s`,
    '--entry-float-duration': `${4.1 + (index % 3) * .48}s`,
  } as CSSProperties;

  return (
    <div className="entry-world-node entry-world-node--empty" style={style} data-base-variant={BASE_VARIANTS[index] ?? 0} data-layout-id={`hall.world.empty.${index}`} data-layout-container="hall.stage" data-layout-origin="bottom center">
      <button type="button" className="entry-world-crystal entry-world-crystal--empty" data-crystal={variant} onClick={onSelect} aria-label="创建或导入新世界">
        <span className="entry-world-crystal__float-layer" style={floatStyle} aria-hidden="true">
          <span className="entry-world-crystal__halo" />
          <span className="entry-world-crystal__scene" />
          <img className="entry-world-crystal__art" src={CRYSTAL_ASSETS[variant]} alt="" />
          <span className="entry-world-crystal--empty__core"><Plus size={22} /></span>
        </span>
        <span className="entry-world-crystal--empty__label">新世界</span>
      </button>
    </div>
  );
}

function WorldDetailOverlay({
  world,
  onClose,
  onStart,
  isCustom,
  onEdit,
  onDelete,
}: {
  world: WorldDef;
  onClose: () => void;
  onStart: () => void;
  isCustom: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const visibleTabs = TABS.filter(tab => tab.key !== 'systems' || hasEnabledSystemModule(world));
  const assets = getWorldHallAssets(world, Math.max(0, BUILTIN_WORLD_ORDER.indexOf(world.id as typeof BUILTIN_WORLD_ORDER[number])));
  const style = {
    '--entry-world-accent': world.coverColor ?? '#b99a6b',
    '--entry-scene-image': `url("${assets.scene}")`,
    '--entry-crystal-clip': CRYSTAL_CLIPS[assets.crystal],
  } as CSSProperties;

  const tabContent = (() => {
    switch (activeTab) {
      case 'lore': return <LoreTab world={world} />;
      case 'factions': return <FactionsTab world={world} />;
      case 'culture': return <CultureTab world={world} />;
      case 'economy': return <EconomyTab world={world} />;
      case 'npcs': return <NpcsTab world={world} />;
      case 'rules': return <RulesTab world={world} />;
      case 'systems': return <SystemsTab world={world} />;
      default: return <OverviewTab world={world} worldEntry={null} />;
    }
  })();

  return (
    <div className="entry-detail-layer" role="presentation">
      <button type="button" className="entry-detail-backdrop" onClick={onClose} aria-label="关闭世界详情" />
      <section className="entry-detail-panel" role="dialog" aria-modal="true" aria-labelledby="entry-detail-title">
        <DawnFrameV4 mode="panel" withFill className="entry-detail-dawn-frame">
        <div className="entry-detail-layout">
          <aside className="entry-detail-visual">
            <span className="entry-detail-visual__eyebrow">WORLD FRAGMENT / {world.id.slice(0, 8).toUpperCase()}</span>
            <div className={`entry-detail-crystal entry-detail-crystal--${assets.crystal}`} style={style}>
              <span
                className="entry-world-crystal__float-layer"
                style={{ '--entry-float-delay': '-.32s', '--entry-float-duration': '4.6s' } as CSSProperties}
                aria-hidden="true"
              >
                <span className="entry-world-crystal__halo" />
                <span className="entry-world-crystal__scene" />
                <img className="entry-world-crystal__art" src={CRYSTAL_ASSETS[assets.crystal]} alt="" />
                <span className="entry-world-crystal__glow" />
              </span>
            </div>
            <div className="entry-detail-visual__meta">
              <span className="entry-detail-visual__icon"><img src={assets.emblem} alt="" /></span>
              <span><b>{world.name}</b><small>{world.difficulty ? `难度 · ${world.difficulty}` : '待归档世界'}</small></span>
            </div>
            <div className="entry-detail-visual__line"><span /> <small>晶体状态</small> <b>可共鸣</b></div>
          </aside>

          <div className="entry-detail-content">
            <div className="entry-detail-heading">
              {isCustom && <button type="button" className="entry-detail-edit-world" onClick={onEdit}><Pencil size={14} />编辑世界</button>}
              <span className="entry-detail-heading__kicker"><Compass size={13} /> 世界详情</span>
              <h2 id="entry-detail-title">{world.name}</h2>
              <p>{world.description || '一枚尚未写完的世界碎片，等待你的角色进入其中。'}</p>
              <div className="entry-detail-tags">
                {world.tags?.map(tag => <span key={tag}>{tag}</span>)}
                {world.source === 'external' && <span><ExternalLink size={11} /> 外部</span>}
              </div>
            </div>

            <div className="entry-detail-tabs" role="tablist" aria-label="世界信息分类">
              {visibleTabs.map(tab => {
                const TabIcon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    type="button"
                    role="tab"
                    key={tab.key}
                    aria-selected={isActive}
                    className={isActive ? 'is-active' : ''}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    <TabIcon size={14} strokeWidth={1.7} />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {isCustom && <button type="button" className="entry-detail-artwork-action" onClick={onEdit}><Pencil size={13} /> 更换图景</button>}
            <div className="entry-detail-tab-scroll">{tabContent}</div>

            <div className="entry-detail-actions">
              <EntrySlicedButton frame="dawn-v4-compact" tone="primary" emblemSrc="/art/theme/emblems/emblem-20-v2.png" icon={ArrowRight} onClick={onStart}>选择并继续</EntrySlicedButton>
              {isCustom && <button type="button" className="entry-detail-delete-world" onClick={onDelete}><Trash2 size={14} />删除世界定义</button>}
            </div>
          </div>
        </div>
        </DawnFrameV4>
        <EntrySlicedButton frame="dawn-v4-compact" icon={X} className="entry-detail-close entry-sliced-button--icon-only" onClick={onClose} aria-label="关闭">
          <span className="entry-sr-only">关闭</span>
        </EntrySlicedButton>
      </section>
    </div>
  );
}

function hasEnabledSystemModule(world: WorldDef) {
  return world.modules?.some(module => module.enabled) ?? false;
}
