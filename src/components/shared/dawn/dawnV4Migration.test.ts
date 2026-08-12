import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('Dawn V4 production migration', () => {
  const entrySurface = read('../../start/EntrySurface.tsx');
  const worldHall = read('../../start/WorldHallView.tsx');
  const saveArchive = read('../../start/SaveArchiveView.tsx');
  const wizardShell = read('../../start/WizardShell.tsx');
  const entryStyles = read('../../../styles/entry-crystal.css');
  const ritualStyles = read('../../../styles/creation-ritual.css');
  const assembly = read('./dawnV4Assembly.ts');
  const gamePanel = read('../../game/chat/ChatPanel.tsx');
  const gameStyles = read('../../../styles/game-journey.css');
  const startScreen = read('../../start/StartScreen.tsx');
  const startHandlers = read('../../start/useStartScreen.ts');
  const productionSources = `${entrySurface}\n${worldHall}\n${saveArchive}`;

  test('uses V4 compact frames by default and leaves legacy as explicit opt-in', () => {
    expect(entrySurface).toContain("frame = 'dawn-v4-compact'");
    expect(entrySurface).not.toContain("export function DawnFrame(");
    expect(entrySurface).not.toContain("'dawn-compact'");
    expect(entrySurface).not.toContain("'dawn-panel'");
    expect(entrySurface).toContain('borderLayer="front"');
    expect(entrySurface).toContain("const isCompactFrame = frame === 'dawn-v4-compact'");
    expect(entrySurface).toContain("isCompactFrame ? content : (");
  });

  test('entry surfaces have a fixed-light boundary while ritual stays player-themed', () => {
    expect(worldHall).toContain('entry-default-theme entry-hall');
    expect(saveArchive).toContain('entry-default-theme entry-archive-layer');
    expect(entryStyles).toContain('.entry-default-theme {');
    expect(entryStyles).toContain('--creation-bg: #edf5f0 !important;');
    expect(wizardShell).not.toContain('entry-default-theme');
  });

  test('lets only the hall adopt deterministic Nocturne relighting', () => {
    expect(worldHall).toContain("'--entry-hall-background': `url(\"${hallLayout.background}\")`");
    expect(entryStyles).toContain('html[data-theme="dark"] .entry-default-theme.entry-hall .entry-hall-backdrop');
    expect(entryStyles).toContain('filter: brightness(.48) contrast(1.18) saturate(1.32) hue-rotate(7deg);');
    expect(entryStyles).toContain('html[data-theme="dark"] .entry-default-theme.entry-hall .entry-hall-shade');
    expect(entryStyles).toContain('html[data-theme="dark"] .entry-default-theme.entry-hall .entry-world-crystal__glow');
    expect(entryStyles).toContain('html[data-theme="dark"] .entry-default-theme.entry-hall .entry-hall-portal__firelight');
    expect(entryStyles).not.toContain('hall-background-16x9-nocturne');
  });

  test('compact actions do not render the V4 decorative frame tree', () => {
    expect(entrySurface).toContain('entry-sliced-button--compact');
    expect(entryStyles).toContain('.entry-sliced-button--compact > .dawn-frame-v4 { display: none !important; }');
  });

  test('empty slot keeps the formal slot-one anchor', () => {
    expect(worldHall).toContain('HALL_SLOT_ORDER[pageWorlds.length]');
    expect(entryStyles).toContain('The formal node and the empty slot now share the same visual transform.');
  });

test('hall navigation remains a content-sized transparent group', () => {
  expect(entryStyles).toMatch(/entry-default-theme \.entry-hall-header__actions[\s\S]*width: max-content !important;[\s\S]*background: transparent !important;/);
  const mobileNavigationRule = entryStyles.slice(entryStyles.lastIndexOf('@media (max-width: 560px)'));
  expect(mobileNavigationRule).toContain('display: grid !important;');
  expect(mobileNavigationRule).toContain('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;');
  expect(mobileNavigationRule).toContain('grid-auto-rows: minmax(32px, 1fr) !important;');
  expect(mobileNavigationRule).toContain('height: auto !important;');
  expect(mobileNavigationRule).toMatch(/\.entry-default-theme \.entry-hall-header__actions[\s\S]*display: grid !important;/);
});

  test('Dawn V4 rails overlap seams and keep the optional underlay opt-in', () => {
    expect(assembly).toContain('const seamOverlap');
    expect(assembly).toContain("railLayerMode: 'segmented-overlap'");
    expect(assembly).toContain('renderCompleteRailUnderlays: true');
    const frameSource = read('./DawnFrameV4.tsx');
    expect(frameSource).toContain('withUnderlay');
    expect(frameSource).toContain('withUnderlay = false');
    expect(frameSource).toContain('{withUnderlay &&');
    expect(frameSource).toContain('dawn-frame-v4--with-underlay');
    expect(read('../../../styles/entry-crystal.css')).toContain('.dawn-frame-v4--with-underlay .dawn-frame-v4__underlay');
  });

  test('game journey banner separates softened scene art from readable content', () => {
    expect(gamePanel).toContain('game-journey__narrative-banner-scene');
    expect(gameStyles).toContain('filter: blur(2px) saturate(.78) contrast(.9);');
    expect(gameStyles).toContain('game-journey__narrative-banner-glass');
  });

  test('contains no production calls to the retired Dawn panel or compact aliases', () => {
    expect(productionSources).not.toMatch(/<DawnFrame(?:\s|>)/);
    expect(productionSources).not.toContain('frame="dawn-compact"');
    expect(productionSources).not.toContain('frame="dawn-panel"');
  });

  test('lets the world detail frame own both content surfaces and their stacking order', () => {
    expect(worldHall).not.toMatch(/<DawnFrameV4[^>]*entry-detail-dawn-frame[^>]*>\{null\}<\/DawnFrameV4>/);
    expect(worldHall).toMatch(/<DawnFrameV4[^>]*entry-detail-dawn-frame[^>]*>[\s\S]*entry-detail-layout[\s\S]*<\/DawnFrameV4>/);
  });

  test('keeps the close control as an explicit overlay above the completed outer frame', () => {
    expect(worldHall).toMatch(/<\/DawnFrameV4>\s*<EntrySlicedButton[^>]*entry-detail-close/);
  });

  test('uses the shared V4 component for save cards and the selected-save detail strip', () => {
    expect(saveArchive).toContain("import DawnFrameV4 from '../shared/dawn/DawnFrameV4'");
    expect(saveArchive.match(/<DawnFrameV4/g)?.length).toBe(2);
  });

  test('restores SAVE import, export, and delete actions through the existing handlers', () => {
    expect(saveArchive).toContain('onImportSave');
    expect(saveArchive).toContain('onExportSave(selectedSave.id)');
    expect(saveArchive).toContain('onDeleteSave(selectedSave.id)');
    expect(worldHall).toContain('onImportSave={onImportSave}');
    expect(worldHall).toContain('onExportSave={onExportSave}');
    expect(worldHall).toContain('onDeleteSave={onDeleteSave}');
    expect(startScreen).toContain('onImportSave={h.handleImportSave}');
    expect(startScreen).toContain('onExportSave={h.handleExportSave}');
    expect(startScreen).toContain('onDeleteSave={h.handleDeleteSave}');
    expect(startHandlers).toContain('if (!await confirm(');
    expect(startHandlers).toContain('await importSaveToStore(data)');
    expect(startHandlers).toContain('await exportSaveFromStore(saveId)');
    expect(startHandlers).toContain("await showAlert(`导入失败: ${errMsg}`");
  });

  test('renders wizard navigation as V4 overlay controls outside the main paper frame', () => {
    expect(wizardShell).toContain("import { EntrySlicedButton } from './EntrySurface'");
    expect(wizardShell).not.toContain('<button type="button" className="btn-secondary"');
    expect(wizardShell).not.toContain('<button type="button" className="btn-primary"');
    expect(wizardShell).toContain('creation-ritual-shell__footer${modalOpen');
    expect(wizardShell).toContain('disabled={modalOpen}');
  });

  test('defines portrait-specific 2x2 navigation and frameless current-journey treatment', () => {
    expect(entryStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(entryStyles).toContain('.entry-save-details__frame.dawn-frame-v4 > .dawn-frame-v4__border');
    expect(entryStyles).toContain('display: none !important;');
  });

  test('keeps the desktop save gate centered and removes selected-card vertical drift', () => {
    expect(entryStyles).toMatch(/\.entry-archive-space \.entry-archive-gate \{\s*left: 50vw;/);
    expect(entryStyles).toMatch(/\.entry-save-shard-card\.is-selected \{\s*transform: none;/);
    expect(entryStyles).toMatch(/\.entry-archive-gate \.entry-hall-portal__label \{\s*left: 50%;\s*transform: translateX\(-50%\);/);
    expect(entryStyles).toMatch(/\[data-layout-id="save\.back"\][\s\S]*right: 20px;[\s\S]*left: auto;/);
  });

  test('places ritual navigation above and spatially clear of the paper frame', () => {
    expect(ritualStyles).toMatch(/\.creation-ritual-shell__footer \{[\s\S]*position: absolute;[\s\S]*z-index: 30;/);
    expect(ritualStyles).toContain('bottom: max(30px, env(safe-area-inset-bottom));');
    expect(ritualStyles).toContain('background: rgba(248, 252, 242, .94);');
  });

  test('removes obsolete one-row separators from the mobile navigation grid', () => {
    expect(entryStyles).toMatch(/\.entry-hall-header__actions > \.entry-sliced-button \+ \.entry-sliced-button \{\s*border-left: 0;/);
  });

  test('keeps the shared frame contract and world-weave CTA non-blocking without API setup', () => {
    expect(ritualStyles).toContain('--dawn-frame-fill-inset-panel: 12px;');
    expect(ritualStyles).toMatch(/\.dawn-frame-v4 > \.dawn-frame-v4__border[\s\S]*z-index: 20 !important/);
    const worldEditor = read('../../start/WorldEditorForm.tsx');
    expect(worldEditor).not.toContain('if (disabledByConflict.size > 0)');
    expect(worldEditor).toContain('未配置 AI，可继续手动编织。');
    expect(worldEditor).not.toContain('onClick={() => setWeaveStep(2)}');
    expect(worldEditor).not.toContain('onClick={() => setWeaveStep(3)}');
  });

  test('uses a frameless narrative surface and releases the collapsed desktop rail', () => {
    const desktopLayout = read('../../game/gameScreen/DesktopLayout.tsx');
    const mobileLayout = read('../../game/gameScreen/MobileLayout.tsx');
    const journeyStyles = read('../../../styles/game-journey.css');
    expect(desktopLayout).not.toContain('DawnFrameV4');
    expect(mobileLayout).not.toContain('DawnFrameV4');
    expect(journeyStyles).toContain('.game-journey__right-panel.is-collapsed {');
    expect(journeyStyles).toContain('flex-basis: 44px !important;');
    expect(journeyStyles).toContain('.game-journey__reading-surface--main');
  });
});
