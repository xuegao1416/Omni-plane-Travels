import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react';
import type { CSSProperties } from 'react';
import {
ArrowLeft,BookOpen,Boxes,ChevronLeft,ChevronRight,Copy,Menu,PenLine,Plus,Settings,Sparkles,Upload,UserRound,
} from 'lucide-react';
import type { WorldDef } from '../../data/worldLoader';
import { saveWorldDraft,deleteWorldDraft,type WorldDraft } from '../../data/worldLoader';
import type { SaveMeta } from '../../storage/db';
import { normalizeExternal } from './stepWorldBrowser/constants';
import { restoreDirectorDependencies } from '../../director/dependencies';
import { resolveWorldIcon } from '../shared/worldIcons';
import WorldForkSelectModal from './WorldForkSelectModal';
import SaveArchiveView from './SaveArchiveView';
import { NovelImportWorkbench } from './NovelImportWorkbench';
import { playHallSound } from '../../utils/hallAudio';
import { canAdvanceHallPage,getHallPageCount } from './worldHallPagination';
import Astrolabe from './orrery/Astrolabe';
import Prism from '../../ui/dawn/Prism';
import { useEntryLexicon } from '../../ui/dawn/entryLexicon';
import { sceneAccent,useDawnHallBridge } from '../../ui/dawn/useDawnHallBridge';
import { useUITheme } from '../../hooks/useUITheme';
import HallMusic from './orrery/HallMusic';
import PlaneDialog from './orrery/PlaneDialog';
import WorldDetailOverlay from './orrery/WorldDetailOverlay';
import { getOrbitGeometry,getOrbitSlot,type OrbitGeometry } from './orrery/orbitLayout';
import { BUILTIN_WORLD_ORDER,BUILTIN_WORLD_SET,difficultyLabel,getWorldVisual,planeCode } from './orrery/worldVisuals';

export { hasEnabledSystemModule } from './orrery/worldVisuals';

const SLOTS_PER_PAGE = 6;
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];

interface WorldHallViewProps {
  /** True right after the warp from the title screen: lenses emerge from the core. */
  arrival?: boolean;
  allWorlds: WorldDef[];
  allSaves: SaveMeta[];
  currentSaveId: string | null;
  selectedWorld: string;
  setSelectedWorld: (id: string) => void;
  onBackToHome: () => void;
  onStartWizard: () => void;
  creationDraftName?: string;
  onResumeCreation?: () => void;
  onOpenEvents: () => void;
  onOpenCustomModules: () => void;
  onOpenSettings: () => void;
  onOpenUserCenter: () => void;
  onOpenEditor: (world: WorldDef | null, step?: number) => void;
  onDeleteWorld: (worldId: string) => void | Promise<{ ok: boolean }>;
  onImportWorld: (world: WorldDef) => void;
  onLoadSave: (saveId: string) => Promise<void>;
  onDeleteSave: (id: string) => void | Promise<void>;
  onImportSave: (file: File) => void | Promise<void>;
  onExportSave: (id: string) => void | Promise<void>;
}

interface DetailState {
  world: WorldDef;
  originX: number;
  originY: number;
  radius: number;
}

function useStageGeometry() {
  const ref = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<OrbitGeometry | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setGeometry(getOrbitGeometry({ width: el.clientWidth, height: el.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, geometry };
}

export default function WorldHallView({
  arrival = false,
  allWorlds,
  allSaves,
  currentSaveId,
  selectedWorld,
  setSelectedWorld,
  onBackToHome,
  onStartWizard,
  creationDraftName, onResumeCreation,
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
  const builtinWorlds = useMemo(
    () => BUILTIN_WORLD_ORDER.map(id => allWorlds.find(world => world.id === id)).filter((world): world is WorldDef => Boolean(world)),
    [allWorlds],
  );
  const customWorlds = useMemo(() => allWorlds.filter(world => !BUILTIN_WORLD_SET.has(world.id)), [allWorlds]);
  const pageCount = getHallPageCount(customWorlds.length);
  const [hallPage, setHallPage] = useState(() => {
    const customIndex = customWorlds.findIndex(world => world.id === selectedWorld);
    return customIndex >= 0 ? 1 + Math.floor(customIndex / SLOTS_PER_PAGE) : 0;
  });
  const [pageDirection, setPageDirection] = useState<1 | -1>(1);
  // 翻页后改用左右滑入动画，不再重播「从星核弹出」。
  const [paged, setPaged] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [coreHover, setCoreHover] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [emptySlotOpen, setEmptySlotOpen] = useState(false);
  const [novelOpen, setNovelOpen] = useState(false);
  const [forkSelectOpen, setForkSelectOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importError, setImportError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { ref: stageRef, geometry } = useStageGeometry();
  const uiTheme = useUITheme();
  const lex = useEntryLexicon();

  useEffect(() => { setHallPage(page => Math.min(page, pageCount - 1)); }, [pageCount]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [menuOpen]);

  const pageWorlds = hallPage === 0 ? builtinWorlds : customWorlds.slice((hallPage - 1) * SLOTS_PER_PAGE, hallPage * SLOTS_PER_PAGE);
  const showEmptySlot = hallPage > 0 && pageWorlds.length < SLOTS_PER_PAGE;
  const canGoToNextPage = canAdvanceHallPage(hallPage, pageWorlds.length);
  const focusWorld = pageWorlds.find(world => world.id === hoveredId)
    ?? pageWorlds.find(world => world.id === selectedWorld)
    ?? null;
  const focusIndex = focusWorld ? pageWorlds.indexOf(focusWorld) : -1;
  const slotCount = SLOTS_PER_PAGE;

  // 晨雾琉璃: the 3D rotunda puts the bonfire under the core and a medallion under every
  // slot (all six, so the camera framing does not change with the page's world count).
  const sceneSlots = geometry ? Array.from({ length: slotCount }, (_, index) => {
    const slot = getOrbitSlot(geometry, index);
    const world = pageWorlds[index];
    return {
      x: slot.x,
      y: slot.y,
      occupied: index < pageWorlds.length || (showEmptySlot && index === pageWorlds.length),
      accent: world ? sceneAccent(getWorldVisual(world).accent) : null,
    };
  }) : [];
  const scenePulse = useDawnHallBridge(uiTheme === 'dawn', stageRef, geometry, sceneSlots, {
    hovered: hoveredId ? pageWorlds.findIndex(world => world.id === hoveredId) : -1,
    selected: pageWorlds.findIndex(world => world.id === selectedWorld),
    coreHover,
  });
  const shownPage = useRef(hallPage);
  useEffect(() => {
    if (shownPage.current === hallPage) return;
    shownPage.current = hallPage;
    scenePulse('page');
  }, [hallPage, scenePulse]);

  const changePage = useCallback((delta: 1 | -1) => {
    setPaged(true);
    setHallPage(page => {
      const next = page + delta;
      if (next < 0 || next >= pageCount) return page;
      playHallSound(delta > 0 ? 'confirm' : 'back');
      setPageDirection(delta);
      setHoveredId(null);
      return next;
    });
  }, [pageCount]);

  // Arrow keys page between sectors while no overlay is open.
  useEffect(() => {
    if (detail || archiveOpen || emptySlotOpen || novelOpen || forkSelectOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'PageDown' || (event.key === 'ArrowRight' && event.altKey)) { if (canGoToNextPage) changePage(1); }
      if (event.key === 'PageUp' || (event.key === 'ArrowLeft' && event.altKey)) changePage(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, archiveOpen, emptySlotOpen, novelOpen, forkSelectOpen, canGoToNextPage, changePage]);

  const openWorld = (world: WorldDef, element: HTMLElement) => {
    playHallSound('crystalSelect');
    scenePulse('select');
    const rect = element.getBoundingClientRect();
    setSelectedWorld(world.id);
    setDetail({ world, originX: rect.left + rect.width / 2, originY: rect.top + rect.height / 2, radius: rect.width / 2 });
  };

  const handleDeleteCustomWorld = async (worldId: string) => {
    const result = await onDeleteWorld(worldId);
    if (result?.ok) setDetail(null);
  };

  const handleFork = (draft: WorldDraft) => { saveWorldDraft(draft); setForkSelectOpen(false); onOpenEditor(draft, 1); };
  const handleEditDraft = (draft: WorldDraft) => { setForkSelectOpen(false); onOpenEditor(draft, 1); };
  const handleDeleteDraft = (draftId: string) => { deleteWorldDraft(draftId); };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setImportError('');
    try {
      const { directorDefinitions, ...data } = JSON.parse(await file.text());
      const isOurFormat = (Array.isArray(data.worldBookEntries) && data.worldBookEntries.some((entry: any) => typeof entry.entryType === 'string'))
        || Array.isArray(data.modules)
        || (typeof data.id === 'string' && data.id.startsWith('world_'));
      const imported = isOurFormat
        ? { ...data, id: data.id || `custom_${Date.now()}`, source: undefined } as WorldDef
        : normalizeExternal(data, file.name);
      if (!imported.name) throw new Error('导入世界缺少名称');
      await restoreDirectorDependencies({ customWorld: imported as unknown as Record<string, unknown> }, directorDefinitions);
      onImportWorld(imported);
      setEmptySlotOpen(false);
    } catch (error) { setImportError(`导入失败：${error instanceof Error ? error.message : String(error)}`); }
  };

  const navItems = [
    ...(onResumeCreation ? [{ id: 'resume', icon: PenLine, label: '继续创建', title: creationDraftName || undefined, action: onResumeCreation }] : []),
    { id: 'novel', icon: BookOpen, label: '小说拆解台', action: () => setNovelOpen(true) },
    { id: 'events', icon: Boxes, label: '事件中心', action: () => { playHallSound('confirm'); onOpenEvents(); } },
    { id: 'modules', icon: Sparkles, label: '自定义模块', action: () => { playHallSound('confirm'); onOpenCustomModules(); } },
  ];

  const stageStyle = geometry ? {
    '--pl-lens': `${geometry.lens}px`,
    '--pl-core': `${geometry.core}px`,
    '--pl-cx': `${geometry.cx}px`,
    '--pl-cy': `${geometry.cy}px`,
  } as CSSProperties : undefined;

  const sectorLabel = lex.sector(hallPage, ROMAN[hallPage - 1] ?? String(hallPage));

  return (
    <main className={`pl-hall${detail ? ' has-detail' : ''}${arrival ? ' is-arrival' : ''}`} aria-label={lex.hallLabel}>
      {/* World echoes: the focused plane bleeds its light into the sky. */}
      <div className="pl-hall__echoes" aria-hidden="true">
        {pageWorlds.map(world => (
          <img key={world.id} src={getWorldVisual(world).scene} alt="" className={focusWorld?.id === world.id ? 'is-on' : ''} />
        ))}
      </div>
      <div className="pl-hall__vignette" aria-hidden="true" />

      <header className="pl-hall__bar">
        <div className="pl-brand">
          <span className="pl-brand__mark" aria-hidden="true">{uiTheme === 'dawn' ? <Prism variant="mark" /> : <Astrolabe variant="home" />}</span>
          <span className="pl-brand__text"><b>OMNI·PLANE</b><small>{lex.brand}</small></span>
        </div>
        <nav className="pl-hall__nav" aria-label={lex.navLabel}>
          <div className="pl-hall__nav-wide">
            {navItems.map(item => {
              const Icon = item.icon;
              return <button key={item.id} type="button" className="pl-chip" onClick={item.action} title={item.title}><Icon size={14} aria-hidden="true" />{item.label}</button>;
            })}
          </div>
          <div className="pl-hall__nav-menu" ref={menuRef}>
            <button type="button" className="pl-chip pl-chip--icon" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="更多功能" onClick={() => setMenuOpen(open => !open)}><Menu size={16} aria-hidden="true" /></button>
            {menuOpen && (
              <div className="pl-menu" role="menu">
                {navItems.map(item => {
                  const Icon = item.icon;
                  return <button key={item.id} type="button" role="menuitem" onClick={() => { setMenuOpen(false); item.action(); }}><Icon size={15} aria-hidden="true" />{item.label}</button>;
                })}
              </div>
            )}
          </div>
          <span className="pl-hall__nav-sep" aria-hidden="true" />
          <button type="button" className="pl-chip pl-chip--icon" onClick={onOpenSettings} aria-label="设置" title="设置"><Settings size={16} aria-hidden="true" /></button>
          <button type="button" className="pl-chip pl-chip--icon" onClick={onOpenUserCenter} aria-label="账号与云端" title="账号与云端"><UserRound size={16} aria-hidden="true" /></button>
          <HallMusic />
        </nav>
      </header>

      <section ref={stageRef} className="pl-stage" style={stageStyle} aria-label={`${sectorLabel}，共 ${pageWorlds.length} 个位面`}>
        {geometry && (
          <>
            <svg className="pl-stage__lines" width={geometry.cx * 2} height={geometry.cy * 2} aria-hidden="true">
              <ellipse cx={geometry.cx} cy={geometry.cy} rx={geometry.rx} ry={geometry.ry} className="pl-orbit" />
              <ellipse cx={geometry.cx} cy={geometry.cy} rx={geometry.rx * 1.12} ry={geometry.ry * 1.12} className="pl-orbit pl-orbit--outer" />
              <circle cx={geometry.cx} cy={geometry.cy} r={geometry.core * .62} className="pl-orbit pl-orbit--outer" />
              {Array.from({ length: slotCount }, (_, index) => {
                const slot = getOrbitSlot(geometry, index);
                const occupied = index < pageWorlds.length || (showEmptySlot && index === pageWorlds.length);
                if (!occupied) return null;
                return (
                  <line
                    key={index}
                    x1={geometry.cx} y1={geometry.cy} x2={slot.x} y2={slot.y}
                    className={`pl-ley${focusIndex === index ? ' is-lit' : ''}`}
                  />
                );
              })}
            </svg>

            <button
              type="button"
              className="pl-core"
              onClick={() => { playHallSound('confirm'); scenePulse('core'); setArchiveOpen(true); }}
              onPointerEnter={() => setCoreHover(true)}
              onPointerLeave={() => setCoreHover(false)}
              onFocus={() => setCoreHover(true)}
              onBlur={() => setCoreHover(false)}
              aria-label={lex.logAria(allSaves.length)}
            >
              {uiTheme === 'dawn' ? (
                // The 3D bonfire shows through; this only draws the gilded sighting ring on hover / focus.
                <span className="dw-core" aria-hidden="true"><i className="dw-core__ring" /><i className="dw-core__ticks" /></span>
              ) : <Astrolabe variant="hall" />}
              <span className="pl-core__label">
                <small>{lex.log}</small>
                <b>{allSaves.length ? `${allSaves.length} 段旅程` : '尚无记录'}</b>
              </span>
            </button>

            <div key={`page-${hallPage}`} className={`pl-stage__lenses${arrival && !paged ? ' is-arrival' : pageDirection > 0 ? ' is-forward' : ' is-backward'}`}>
              {pageWorlds.map((world, index) => {
                const slot = getOrbitSlot(geometry, index);
                const visual = getWorldVisual(world);
                const Icon = resolveWorldIcon(world.icon);
                const code = planeCode(hallPage === 0 ? index : (hallPage - 1) * SLOTS_PER_PAGE + index + BUILTIN_WORLD_ORDER.length);
                const style = {
                  '--x': `${slot.x}px`,
                  '--y': `${slot.y}px`,
                  '--depth': slot.depth,
                  '--dx': `${geometry.cx - slot.x}px`,
                  '--dy': `${geometry.cy - slot.y}px`,
                  '--z': 10 + Math.round(slot.depth * 4),
                  '--i': index,
                  '--accent': visual.accent,
                  '--fx': `${visual.focalX * 100}%`,
                  '--fy': `${visual.focalY * 100}%`,
                } as CSSProperties;
                const selected = selectedWorld === world.id;
                return (
                  <div
                    key={world.id}
                    className={`pl-lens${selected ? ' is-selected' : ''}${hoveredId && hoveredId !== world.id ? ' is-dimmed' : ''}${slot.x < geometry.cx - 4 ? ' is-left' : slot.x > geometry.cx + 4 ? ' is-right' : ''}`}
                    style={style}
                    onPointerEnter={() => setHoveredId(world.id)}
                    onPointerLeave={() => setHoveredId(current => current === world.id ? null : current)}
                  >
                    <button
                      type="button"
                      className="pl-lens__button"
                      aria-label={`查看世界：${world.name}`}
                      aria-pressed={selected}
                      onFocus={() => setHoveredId(world.id)}
                      onBlur={() => setHoveredId(current => current === world.id ? null : current)}
                      onClick={event => openWorld(world, event.currentTarget)}
                    >
                      <span className="pl-lens__halo" aria-hidden="true" />
                      <span className="pl-lens__ring" aria-hidden="true" />
                      <span className="pl-lens__disc" aria-hidden="true">
                        <img src={visual.scene} alt="" loading="lazy" draggable={false} />
                        <span className="pl-lens__shine" />
                      </span>
                      <span className="pl-lens__code" aria-hidden="true">{code}</span>
                    </button>
                    <span className="pl-lens__caption" aria-hidden="true">
                      <span className="pl-lens__name"><Icon size={14} strokeWidth={1.7} />{world.name}</span>
                      <small>{world.tags?.slice(0, 2).join(' · ') || '未归档位面'} · {difficultyLabel(world.difficulty)}</small>
                    </span>
                  </div>
                );
              })}

              {showEmptySlot && (() => {
                const slot = getOrbitSlot(geometry, pageWorlds.length);
                return (
                  <div className="pl-lens pl-lens--empty" style={{ '--x': `${slot.x}px`, '--y': `${slot.y}px`, '--depth': slot.depth, '--i': pageWorlds.length } as CSSProperties}>
                    <button type="button" className="pl-lens__button" aria-label="创建或导入新世界" onClick={() => { playHallSound('crystalSelect'); setEmptySlotOpen(true); }}>
                      <span className="pl-lens__ring" aria-hidden="true" />
                      <span className="pl-lens__disc" aria-hidden="true"><Plus size={28} strokeWidth={1.3} /></span>
                    </button>
                    <span className="pl-lens__caption" aria-hidden="true">
                      <span className="pl-lens__name">未知位面</span>
                      <small>编织或导入新世界</small>
                    </span>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </section>

      <footer className="pl-hall__foot">
        <button type="button" className="pl-chip pl-back" aria-label={lex.backHome} onClick={() => { playHallSound('back'); onBackToHome(); }}>
          <ArrowLeft size={14} aria-hidden="true" /><span className="pl-back__text">{lex.backHome}</span>
        </button>

        <nav className="pl-sector" aria-label={lex.sectorNav}>
          <button type="button" className="pl-icon-button" onClick={() => changePage(-1)} disabled={hallPage === 0} aria-label={lex.prevSector}><ChevronLeft size={18} aria-hidden="true" /></button>
          <div className="pl-sector__label" aria-live="polite">
            <b>{sectorLabel}</b>
            <span className="pl-sector__dots" aria-hidden="true">
              {Array.from({ length: pageCount }, (_, index) => <i key={index} className={index === hallPage ? 'is-on' : ''} />)}
            </span>
          </div>
          <button type="button" className="pl-icon-button" onClick={() => changePage(1)} disabled={!canGoToNextPage || hallPage >= pageCount - 1} aria-label={lex.nextSector}><ChevronRight size={18} aria-hidden="true" /></button>
        </nav>

        <div className="pl-hall__readout" aria-live="polite">
          {focusWorld ? (
            <>
              <small>{selectedWorld === focusWorld.id && hoveredId !== focusWorld.id ? lex.locked : lex.watching}</small>
              <b>{focusWorld.name}</b>
            </>
          ) : (
            <>
              <small>{hallPage === 0 ? lex.pick : lex.emptySector}</small>
              <b>{hallPage === 0 ? lex.pickHint : lex.emptySectorHint}</b>
            </>
          )}
        </div>
      </footer>

      {detail && (
        <WorldDetailOverlay
          key={detail.world.id}
          world={detail.world}
          code={planeCode(Math.max(0, allWorlds.indexOf(detail.world)))}
          origin={{ x: detail.originX, y: detail.originY, radius: detail.radius }}
          isCustom={!BUILTIN_WORLD_SET.has(detail.world.id)}
          onClose={() => { playHallSound('back'); setDetail(null); }}
          onStart={() => { playHallSound('confirm'); onStartWizard(); }}
          onEdit={() => onOpenEditor(detail.world, 4)}
          onDelete={() => void handleDeleteCustomWorld(detail.world.id)}
        />
      )}

      {emptySlotOpen && (
        <PlaneDialog titleId="pl-empty-slot-title" kicker="UNCHARTED PLANE" title="编织一个新位面" onClose={() => setEmptySlotOpen(false)} size="sm">
          <p className="pl-lead">从世界编织仪式开始，或导入已有的世界档案。</p>
          {importError && <p className="pl-error" role="alert">{importError}</p>}
          <div className="pl-choice-grid">
            <button type="button" className="pl-choice" onClick={() => { setEmptySlotOpen(false); onOpenEditor(null); }}><Plus size={18} aria-hidden="true" /><b>创建世界</b><small>从零编织世界法则</small></button>
            <button type="button" className="pl-choice" onClick={() => { setEmptySlotOpen(false); setForkSelectOpen(true); }}><Copy size={18} aria-hidden="true" /><b>基于已有世界</b><small>复制一个位面再改写</small></button>
            <button type="button" className="pl-choice" onClick={() => importInputRef.current?.click()}><Upload size={18} aria-hidden="true" /><b>导入世界</b><small>JSON 世界档案或角色卡</small></button>
            <button type="button" className="pl-choice" onClick={() => { setEmptySlotOpen(false); setNovelOpen(true); }}><BookOpen size={18} aria-hidden="true" /><b>小说拆解台</b><small>从小说提炼世界</small></button>
          </div>
          <input ref={importInputRef} type="file" accept=".json,application/json" onChange={handleImportFile} hidden />
        </PlaneDialog>
      )}

      {novelOpen && <NovelImportWorkbench worlds={allWorlds} onClose={() => setNovelOpen(false)} onUpdateWorld={onImportWorld} onCreateWorld={world => { onImportWorld(world); setSelectedWorld(world.id); setNovelOpen(false); }} />}

      {forkSelectOpen && (
        <WorldForkSelectModal
          isOpen={forkSelectOpen}
          onClose={() => setForkSelectOpen(false)}
          onFork={handleFork}
          onEditDraft={handleEditDraft}
          onDeleteDraft={handleDeleteDraft}
        />
      )}

      {archiveOpen && (
        <SaveArchiveView
          allSaves={allSaves}
          allWorlds={allWorlds}
          currentSaveId={currentSaveId}
          onClose={() => { playHallSound('back'); setArchiveOpen(false); }}
          onLoadSave={onLoadSave}
          onCreateSave={onStartWizard}
          onDeleteSave={onDeleteSave}
          onImportSave={onImportSave}
          onExportSave={onExportSave}
        />
      )}
    </main>
  );
}
