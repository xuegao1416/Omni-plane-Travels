import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('shared overlay migration contract', () => {
  test('routes the three high-risk modal families through the document-level host', () => {
    const portal = read('./OverlayPortal.tsx');
    const contract = read('./overlayPortalContract.ts');
    const dialog = read('./Dialog.tsx');
    const picker = read('./TemplatePickerDialog.tsx');
    const npc = read('../start/NpcEditorModal.tsx');

    expect(portal).toContain('createPortal(');
    expect(contract).toContain('document.body');
    expect(portal).toContain('aria-modal="true"');
    expect(portal).toContain('shouldDismissOverlay(event.target, event.currentTarget)');
    expect(portal).toContain('onPointerDownCapture');
    expect(portal).toContain('previousFocusRef.current?.focus');
    expect(dialog).toContain('<OverlayPortal');
    expect(picker).toContain('<OverlayPortal');
    expect(npc).toContain('<OverlayPortal');
    expect(npc).not.toContain('onClick={onCancel}');
    expect(npc).toContain('requestClose');
  });
});
