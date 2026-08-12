# Hall Nocturne Theme Implementation Plan

> **For implementer:** Use TDD throughout. Write failing test first. Watch it fail. Then implement.

**Goal:** Make the hall follow the Nocturne theme with deterministic night relighting while preserving every existing background and calibrated coordinate.

**Architecture:** Keep the current layout-selected background asset as the sole geometry source. Scope CSS color grading, moonlight overlay, live crystal/fire illumination, and dark glass controls to `html[data-theme="dark"] .entry-default-theme.entry-hall`.

**Tech Stack:** React, CSS, Bun test

---

### Task 1: Lock the theme contract with one focused test

**Files:**
- Modify: `src/components/shared/dawn/dawnV4Migration.test.ts`

**Step 1:** Add a test asserting that the dark hall selector, deterministic backdrop filter, moonlight shade, crystal glow, and firelight overrides exist, while `WorldHallView.tsx` still reads the same calibrated background variable.

**Step 2:** Run `bun test src/components/shared/dawn/dawnV4Migration.test.ts` and confirm the new assertion fails because the dark hall rules do not exist.

### Task 2: Implement the scoped night lighting

**Files:**
- Modify: `src/styles/entry-crystal.css`

**Step 1:** Add the dark-only background filter and `.entry-hall-shade` moonlight gradients.

**Step 2:** Add dark-only crystal and fire illumination using the existing glow elements.

**Step 3:** Add dark glass overrides for hall navigation without changing the shared fixed-light entry tokens.

**Step 4:** Run the focused test and confirm it passes.

### Task 3: Visual calibration

**Files:**
- Modify if needed: `src/styles/entry-crystal.css`

**Step 1:** Inspect the hall at 16:9 in the Nocturne theme.

**Step 2:** Adjust only exposure and glow strength until it matches the approved deep-night reference.

**Step 3:** Inspect one portrait viewport to confirm the same rule follows calibrated assets without coordinate changes.

**Step 4:** Run `git diff --check` and commit only the plan, test, and CSS files.

