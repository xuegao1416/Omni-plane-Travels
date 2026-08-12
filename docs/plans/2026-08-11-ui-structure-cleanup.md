# 2.7.3 UI Structure Cleanup Implementation Plan

> **For implementer:** Use TDD throughout. Write each focused failing test first, run it and confirm the failure, then implement the smallest change that makes it pass.

**Goal:** Make desktop and mobile overlays, Dawn V4 frames, game title layout, settings, character history, and account/library entry points consistent and safe without changing the single-atlas frame architecture.

**Architecture:** Add one SSR-safe `OverlayPortal`/`ModalHost` contract that renders document-level overlays, owns focus/escape/scroll behavior, and uses backdrop target checks. Move only the confirmed nested-risk overlays onto it. Keep Dawn V4 as one `frame-alpha.png` atlas with sourceBox cropping; make underlay opt-in and make layout geometry constrained by both width and height. Migrate existing Settings and history surfaces to the current ritual tokens without changing their data or save behavior.

**Tech Stack:** React + TypeScript + Bun test + CSS modules/global CSS + existing `DawnFrameV4`, `Dialog`, and `useBodyScrollLock` utilities.

---

## Scope and invariants

- Do not restore or create twelve independent frame assets.
- Do not change the application version.
- Do not touch or commit `src/components/start/CustomModuleAgentWorkspace.tsx`, `src/custom-modules/agent.ts`, `.codex/`, or `.workbuddy/`.
- Do not modify `D:\Omni-plane-Travels`; work only in this worktree.
- Preserve all Settings tabs, NPC fields, history data, save behavior, and existing account/library components.

## Task 1: Add the overlay portal contract

**Files:**

- Create: `src/components/shared/OverlayPortal.tsx`
- Create: `src/components/shared/OverlayPortal.test.ts`
- Create: `src/components/shared/overlayMigrationContract.test.ts`
- Modify: `src/components/shared/Dialog.tsx`
- Modify: `src/components/shared/Dialog.module.css`
- Modify: `src/components/shared/templatePicker/styles.module.css`

**RED:** Test that the portal renders into `document.body`, exposes `role="dialog"` and `aria-modal="true"`, closes only when the backdrop itself is clicked, and restores focus after close.

**GREEN:** Implement an SSR-safe `document` guard, a body-mounted host, backdrop target handling, Escape handling, focus entry/restore, and scroll locking using the existing project utility.

**VERIFY:** `bun test src/components/shared/OverlayPortal.test.tsx` must pass; the initial test must fail before implementation.

## Task 2: Migrate NPC and template/dialog flows

**Files:**

- Create: `src/components/start/npcModalState.ts`
- Create: `src/components/start/npcModalState.test.ts`
- Modify: `src/components/start/NpcEditorModal.tsx`
- Modify: `src/components/shared/TemplatePickerDialog.tsx`
- Modify: `src/components/start/StepPersonalInfo.tsx`
- Modify: `src/components/start/StepCharacterHistory.tsx`
- Modify: `src/components/start/WizardShell.tsx`
- Modify: `src/styles/layout-wizard.css`

**RED:** Test dirty NPC close requests for mask, close, cancel, Escape, and wizard-step changes. Each must return a confirmation request rather than discard the draft. Test that a modal-open state disables the Wizard footer.

**GREEN:** Keep draft state local until save, route all close requests through the existing Chinese Dialog mechanism, render NPC/template/shared dialogs through `OverlayPortal`, and expose a modal-open guard to `WizardShell`. Keep the footer mounted but inert/disabled while a modal is open.

**VERIFY:** Focused tests pass; manually inspect the rendered tree to ensure these overlays are descendants of the body portal, not the V4 content span.

## Task 3: Make Dawn V4 geometry and underlay safe

**Files:**

- Modify: `src/components/shared/dawn/DawnFrameV4.tsx`
- Modify: `src/components/shared/dawn/dawnV4Assembly.ts`
- Modify: `src/components/shared/dawn/dawnV4Assembly.test.ts`
- Modify: `src/styles/entry-crystal.css`
- Modify: `src/styles/creation-ritual.css`

**RED:** Add geometry tests for `300x87`, `300x106`, `320x120`, and `360x144`. Assert visible pieces remain within bounds, corner heights fit the frame, and only intentional rail seam overlaps remain. Add a test that the underlay is absent by default and present only when explicitly requested.

**GREEN:** Derive panel scale from both available width and height, preserve isotropic sourceBox scaling, and use a named underlay opt-in prop/class. Do not change atlas paths or reconstruct individual assets. Keep unrelated legacy selectors isolated unless an active V4 consumer shows they are still applied.

**VERIFY:** `bun test src/components/shared/dawn/dawnV4Assembly.test.ts` passes and computed layout values are finite/non-negative for the four mobile sizes.

## Task 4: Fix mobile game title duplication

**Files:**

- Create: `src/components/game/gameScreen/mobileTitleContract.test.ts`
- Modify: `src/styles/game-journey.css`

**RED:** Test that mobile rendering exposes exactly one world-name element while desktop rendering keeps the narrative banner.

**GREEN:** Keep the MobileLayout header title and hide only the ChatPanel narrative banner below the mobile breakpoint. Preserve desktop markup and reserve message/input space.

**VERIFY:** Check 360x640 layout constraints and run the focused test.

## Task 5: Migrate Settings without changing behavior

**Files:**

- Create: `src/components/settingsScreenMigration.test.ts`
- Modify: `src/components/SettingsScreen.tsx`
- Modify: `src/styles/layout-settings.css`

**RED:** Assert all existing tabs remain available, the save/cancel actions remain present, the mobile content region can scroll, and the fixed action area does not cover the final content.

**GREEN:** Replace the old full-height/inline visual shell with the current theme/Dawn V4 surface contract, keep tab components and save callbacks unchanged, and use safe-area-aware mobile layout.

**VERIFY:** Focused test plus manual 360x640 DOM/layout check.

## Task 6: Rebuild the character-history surface

**Files:**

- Create: `src/components/start/historySurfaceContract.test.ts`
- Modify: `src/components/start/StepCharacterHistory.tsx`
- Modify: `src/styles/creation-ritual.css`

**RED:** Test that the stage rail is responsive/browsable, the active stage is exposed, and content, counters, prompts, and the external Wizard footer do not share an overlapping navigation region.

**GREEN:** Keep the embedded Wizard flow on its external footer (the optional standalone navigation remains supported), use ritual surface primitives, make the progress rail scroll or wrap safely, reduce empty vertical space, and retain all generation/preset handlers.

**VERIFY:** Review 360x640, 390x844, and 1440x900 layout constraints.

## Task 7: Restore account and library entry points

**Files:**

- Create: `src/components/start/accountLibraryEntry.test.ts`
- Modify: `src/components/start/StartScreen.tsx`
- Modify: `src/components/start/WorldHallView.tsx`

**RED:** Test that the hall account control opens `UserCenterPage`, that the library/save entry remains reachable, and that Settings remains a separate route/action.

**GREEN:** Correct only the existing route wiring and labels/entry placement; reuse current UserCenter and archive components. Do not introduce a new product feature or alter save data.

**VERIFY:** Focused route test and manual entry-point traversal.

## Task 8: Full verification and precise commit

**Commands:**

```text
bun test
bun run typecheck
bun run build
git diff --check
git status --short
```

Acceptance requires all commands to pass, no version change, no `.workbuddy/`, `.codex/`, or user-modified files staged, and a final diff limited to the plan plus implementation/test files listed above. Commit only explicit paths; never use `git add -A`.

## Final acceptance criteria

- NPC/template/shared Dialog overlays render above Wizard/Dawn V4 chrome and cannot click through to Wizard navigation.
- Dirty NPC drafts never disappear silently through mask, close, cancel, Escape, or step changes.
- Dawn V4 remains one atlas/sourceBox architecture; no default full rectangular underlay line; mobile frame geometry is bounded at all four target sizes.
- Mobile game shows one world title and retains usable message/input space.
- Settings preserves all logic and is visually part of the current theme; 360x640 scrolls correctly.
- History is a responsive ritual surface at 360x640, 390x844, and 1440x900.
- Account opens the account center; library/save and Settings remain clearly reachable.
- Full tests, typecheck, and build pass.
