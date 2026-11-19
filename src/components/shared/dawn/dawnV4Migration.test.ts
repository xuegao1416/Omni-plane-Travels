import { describe,expect,test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('Dawn V4 production migration', () => {
  const entrySurface = read('../../start/EntrySurface.tsx');
  const worldHall = read('../../start/WorldHallView.tsx');
  const saveArchive = read('../../start/SaveArchiveView.tsx');
  const entryOverlays = read('../../start/orrery/WorldDetailOverlay.tsx');
  const wizardShell = read('../../start/WizardShell.tsx');
  const ritualStyles = read('../../../ui/screens/wizard.css');
  const assembly = read('./dawnV4Assembly.ts');
  const gamePanel = read('../../game/chat/ChatPanel.tsx');
  const gameStyles = read('../../../ui/screens/game-story.css');
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

  test('compact actions do not render the V4 decorative frame tree', () => {
    expect(entrySurface).toContain('entry-sliced-button--compact');
  });

  test('places ritual navigation in its own row outside the paper frame', () => {
    expect(ritualStyles).toMatch(/\.creation-ritual-shell__footer \{[^}]*display: flex;/);
    expect(ritualStyles).toContain('.creation-ritual-shell__footer.is-modal-blocked');
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
    expect(read('../../../ui/planar/planar-kit.css')).toContain('.dawn-frame-v4--with-underlay > .dawn-frame-v4__underlay');
  });

  test('game journey banner separates softened scene art from readable content', () => {
    expect(gamePanel).toContain('game-journey__narrative-banner-scene');
    expect(gameStyles).toMatch(/\.game-journey__narrative-banner-scene \{[^}]*filter: blur\(2px\)/);
    expect(gameStyles).toContain('game-journey__narrative-banner-glass');
  });

  test('contains no production calls to the retired Dawn panel or compact aliases', () => {
    expect(productionSources).not.toMatch(/<DawnFrame(?:\s|>)/);
    expect(productionSources).not.toContain('frame="dawn-compact"');
    expect(productionSources).not.toContain('frame="dawn-panel"');
  });

  test('entry overlays use the shared portal for focus, Escape and scroll lock', () => {
    expect(saveArchive).toContain('OverlayPortal');
    expect(entryOverlays).toContain('<OverlayPortal');
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
    expect(wizardShell).toContain('creation-ritual-shell__footer${currentStep === historyStep');
    expect(wizardShell).toContain("${modalOpen || professionLibraryOpen ? ' is-modal-blocked' : ''}");
    expect(wizardShell).toContain('disabled={navigationBlocked}');
  });

  test('keeps the shared frame contract and world-weave CTA non-blocking without API setup', () => {
    expect(read('./DawnFrameV4.tsx')).toContain('pk-frame__ornaments');
    const worldEditor = read('../../start/WorldEditorForm.tsx');
    expect(worldEditor).not.toContain('if (disabledByConflict.size > 0)');
    expect(worldEditor).toContain('请先在设置中配置API');
    expect(worldEditor).not.toContain('onClick={() => setWeaveStep(2)}');
    expect(worldEditor).not.toContain('onClick={() => setWeaveStep(3)}');
  });

  test('uses a frameless narrative surface and releases the collapsed desktop rail', () => {
    const desktopLayout = read('../../game/gameScreen/DesktopLayout.tsx');
    const mobileLayout = read('../../game/gameScreen/MobileLayout.tsx');
    const journeyStyles = read('../../../ui/screens/game.css');
    expect(desktopLayout).not.toContain('DawnFrameV4');
    expect(mobileLayout).not.toContain('DawnFrameV4');
    expect(journeyStyles).toContain('.game-journey__right-panel.is-collapsed {');
    expect(journeyStyles).toContain('.game-journey__right-panel.is-collapsed { width: 0;');
    expect(journeyStyles).toContain('.game-journey__reading-surface--main');
  });
});
