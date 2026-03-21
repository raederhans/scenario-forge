# QA-043 — UI Polish Audit: Layout, Interaction & Detail

**Date:** 2026-03-03
**Scope:** Full UI audit — layout structure, interaction patterns, visual details, accessibility, micro-interactions
**Baseline:** Post QA-038 fixes (phantom Tailwind classes resolved, toast/shortcuts/zoom/undo-redo/focus-visible all implemented)
**Method:** Static code review of `index.html`, `css/style.css`, `js/ui/*.js`, cross-referenced with QA-038 recommendations

---

## Executive Summary

Since QA-038, the following P0/P1 items have been **resolved**:
- Phantom Tailwind classes → all JS-generated DOM now uses design-system classes
- Toast notification system → implemented (`toast.js`)
- Keyboard shortcuts → implemented (`shortcuts.js`: Ctrl+Z/Y, F/E/I, +/-/0, Ctrl+S)
- Visible zoom controls → implemented (top-right floating cluster)
- Undo/redo for paint operations → implemented (`history_manager.js`, 80-entry stack)
- `:focus-visible` global outline → implemented
- Disabled button styling → implemented (`.btn-primary:disabled` etc.)
- `@media (prefers-reduced-motion)` → implemented
- Design tokens `--color-danger`, `--color-success`, etc. → implemented

**Remaining issues** fall into 5 categories, detailed below with priority and estimated effort.

---

## 1. Layout Issues

### 1.1 Left Sidebar — Monolithic Scroll (P1, Medium)

**Problem:** The left sidebar is a single scrollable column with 8 top-level sections (Header, Color Library, Appearance, Editing Rules, Reference Image, Export Map, Special Zone Editor, Tip). At full expansion, scroll depth exceeds 3,500 px (~5× viewport height). Users must scroll extensively to reach Export or Reference Image controls.

**Current structure:**
```
Left Sidebar (320px, single scroll)
├── Header block (title, description)
├── card: Color Library (expandable)
├── details[open]: Appearance          ← ~1,800px when open
│   ├── Ocean (5 controls)
│   ├── Internal Borders (3 controls)
│   ├── Empire Borders (2 controls)
│   ├── Coastlines (2 controls)
│   ├── Parent Borders (5 controls + country list)
│   ├── Context Layers (Physical/Urban/Rivers/Special — 25+ controls)
│   ├── Special Zone Editor (8 controls)
│   └── Texture (1 control)
├── card: Editing Rules
├── card: Reference Image
├── card: Export Map
└── card-compact: Tip
```

**Recommendation:** Convert Appearance sub-sections (Ocean, Borders, Context Layers, etc.) into individually collapsible `<details>` elements instead of one giant `<details>` block. This lets users expand only the section they need.

**Suggested refactor:**
```
details: Appearance
├── details: Ocean Settings
├── details: Border Settings (Internal + Empire + Coastlines + Parent)
├── details: Context Layers (Physical/Urban/Rivers)
├── details: Special Zones
└── details: Texture
```

### 1.2 Appearance Section Contains Unrelated Items (P1, Small)

**Problem:** "Special Zone Editor" (a drawing tool with Start/Finish/Cancel workflow) lives inside the "Appearance" `<details>` block alongside passive styling controls. This is a functional mismatch — the editor is an active workflow tool, not a style setting.

**Recommendation:** Move Special Zone Editor out of Appearance into its own top-level card, or into a dedicated "Drawing Tools" section. This also reduces Appearance scroll depth by ~200px.

### 1.3 Right Sidebar — Sticky Search Overlaps Content (P2, Small)

**Problem:** The `.inspector-search-shell` is `position: sticky; top: 0` with a gradient background. When the right sidebar scrolls, the first `<details>` section can be partially obscured behind the sticky search block because `padding-bottom: 14px` with `margin-bottom: -2px` leaves a thin gap. On shorter viewports (< 800px), the sticky search + 4 accordion headers consume significant vertical space.

**Recommendation:**
- Add `scroll-padding-top: 80px` to `.sidebar-right` so anchor scrolling doesn't hide content under the sticky header.
- Consider making the search bar collapsible or auto-hiding when no input is focused.

### 1.4 Bottom Dock — Wrapping Behavior on Medium Screens (P2, Medium)

**Problem:** The bottom dock uses `flex-wrap: wrap` for `.bottom-dock-primary`. Between 768px and 1024px (tablet-ish screens), the 4 dock groups (Tools, History, Colors, Auto-Fill) wrap into 2 rows, but the wrapping break point is unpredictable. Auto-Fill group (`flex: 1 1 280px; min-width: 260px`) can force a full-width second row while Tools + History + Colors stay cramped on the first row.

**Recommendation:**
- Set explicit breakpoints in the dock's flex behavior. At `< 900px` width, switch to a 2×2 grid:
  ```
  Row 1: [Tools] [History] [Colors]
  Row 2: [Auto-Fill — full width]
  ```
- Or use CSS `@container` queries if targeting modern browsers.

### 1.5 Zoom Controls Overlap with Panel Toggle (P2, Trivial)

**Problem:** Zoom controls are positioned `top: 22px; right: 24px`. The right panel toggle button is `top: 24px; right: 24px`. On screens < 1280px where the panel toggle becomes visible, both controls overlap in the top-right corner.

**Recommendation:** Offset zoom controls further left (`right: 140px`) or stack them vertically below the panel toggle button when the toggle is visible:
```css
@media (max-width: 1279px) {
  .zoom-controls { top: 74px; }
}
```

---

## 2. Interaction Issues

### 2.1 No Drag-to-Paint (P1, Medium)

**Problem:** Painting is click-only. Each feature requires a discrete click event (`interactionRect.on("click", handleClick)`). For large-scale painting (e.g., filling 50+ provinces), users must click each individual feature. This is tedious.

**Recommendation:** Add a "brush drag" mode:
- On `mousedown` on the map, begin painting session.
- On `mousemove` while mouse button held, identify feature under cursor and paint it (if not already painted with current color).
- On `mouseup`, end painting session and push one undo entry for the entire drag batch.
- Debounce with `requestAnimationFrame` to avoid excessive repaints.
- Only active when Fill tool is selected (not Eraser/Eyedropper or during Special Zone drawing).

### 2.2 No Visual Feedback for Current Tool on Map Cursor (P1, Small)

**Problem:** When switching between Fill/Eraser/Eyedropper tools, the map cursor stays as the default browser cursor. Users have no visual indication of which tool is active when hovering the map.

**Recommendation:** Change cursor style based on active tool:
```css
#mapContainer.tool-fill { cursor: crosshair; }
#mapContainer.tool-eraser { cursor: cell; }  /* or a custom eraser cursor */
#mapContainer.tool-eyedropper { cursor: copy; }
```
Update the class in `updateToolUI()`.

### 2.3 No Confirmation for Destructive Actions (P1, Small)

**Problem:** "Clear Map" button (`presetClear`) immediately clears all paint state with no confirmation dialog. This can destroy significant manual work. Similarly, "Reset Country Colors" in the inspector has no guard.

**Recommendation:** Add a lightweight confirmation step:
- Option A: Two-click pattern — first click changes button to "Confirm Clear?" (red background), auto-resets after 3s.
- Option B: Use a toast-based confirm: show warning toast with "Undo" action button (keep the clear in undo stack so it's reversible).
- The undo stack already captures this, but users may not know they can undo. A brief toast "Map cleared — press Ctrl+Z to undo" would help.

### 2.4 Keyboard Shortcut Discoverability (P2, Small)

**Problem:** Keyboard shortcuts exist but are completely undiscoverable. No UI element shows available shortcuts. The tooltip/title attributes on tool buttons show "Fill tool" but not "Fill tool (F)".

**Recommendation:**
- Append shortcut keys to button `title` attributes: `title="Fill tool (F)"`, `title="Undo (Ctrl+Z)"`, etc.
- Add a "Keyboard Shortcuts" section in the tip card or a `?` button that shows a shortcut cheat sheet overlay.

### 2.5 Color Picker Workflow — No Recent Colors Reset (P2, Trivial)

**Problem:** The recent colors strip in the bottom dock grows as users pick colors but has no way to clear it. Over a long session, the recent colors list can become cluttered with abandoned color experiments.

**Recommendation:** Add a small "×" clear button at the end of the recent colors strip, or limit to 8 most recent and auto-cycle.

### 2.6 Country Inspector — Selection Not Synced with Map Click (P2, Medium)

**Problem:** When a user clicks a feature on the map to paint it, the Country Inspector in the right sidebar does not auto-scroll to or highlight the corresponding country. The inspector and the map operate as separate workflows.

**Recommendation:** When a map feature is clicked:
1. Resolve its `cntr_code`.
2. Set `state.selectedInspectorCountryCode` to that code.
3. Trigger `renderCountryListFn()` to highlight the row.
4. Auto-scroll the country list to the highlighted row.
This creates a connected map ↔ inspector experience.

### 2.7 Palette Library Panel — No Close Affordance (P2, Trivial)

**Problem:** The palette library panel in the left sidebar opens via "Browse All Colors" button toggle. Once open, the button text doesn't change (still says "Browse All Colors"), giving no indication it can be re-clicked to close.

**Recommendation:** Toggle button text between "Browse All Colors" / "Close Library" when the panel is open.

---

## 3. Visual Detail Issues

### 3.1 Inconsistent Card Padding (P2, Small)

**Problem:** Cards use different padding values:
- `.card`: `padding: 20px`
- `.card-flat`: `padding: 20px`
- `.card-compact`: `padding: 16px`
- `.inspector-section`: `padding: 18px`
- `.sidebar-tool-card`: `padding: 18px`

While subtle, these 2px differences create inconsistent vertical rhythm. The right sidebar sections (18px) look slightly tighter than left sidebar cards (20px).

**Recommendation:** Normalize to two tiers:
- Standard: `padding: 20px` (all cards, all sections)
- Compact: `padding: 14px` (utility cards, tips)

### 3.2 Range Slider Label Alignment (P2, Trivial)

**Problem:** Range slider rows (`<div class="range-row">`) show label on the left and value on the right, then the slider below. This is functionally fine, but some rows have the label + value at 0.75rem while the slider's native track height varies by browser, creating inconsistent vertical density.

**Recommendation:** Add a fixed `min-height: 24px` to `.range-row` and ensure consistent row height. Consider adding a subtle background strip to visually group label + slider as a unit.

### 3.3 Disabled Ocean Controls — No Visual Grouping (P2, Small)

**Problem:** Ocean advanced styles (Bathymetry, Wave Hachure) are now opt-in experimental controls. When the experiment toggle is off, the disabled `<option>` elements in the select and the disabled sliders (Opacity, Scale, Contour Strength) below are individually grayed out, but there's no visual indication that these form a disabled group.

**Recommendation:**
- Wrap the disabled ocean controls in a `.control-group-disabled` div with `opacity: 0.5` and a dashed border.
- Or hide them entirely if they're not available: `display: none` with a "More styles coming soon" placeholder.
- Current approach of disabling individual controls is confusing — users wonder if it's a bug.

### 3.4 Toast Positioning Conflicts with Zoom Controls (P2, Trivial)

**Problem:** Toast viewport is positioned at `top: 76px; right: 24px`. Zoom controls are at `top: 22px; right: 24px` with height ~50px (reaching ~72px). Toasts appear just 4px below the zoom controls, creating visual crowding.

**Recommendation:** Move toast viewport down to `top: 96px` or make it calculate offset from the zoom controls dynamically.

### 3.5 No Empty State for Preset Tree (P2, Trivial)

**Problem:** When no hierarchy data is loaded or available, the "All Presets & Hierarchy" accordion opens to an empty `<div id="presetTree">`. There's no placeholder text guiding the user.

**Recommendation:** Add an empty-state message similar to the legend editor's pattern:
```
"No presets available. Presets are loaded from the hierarchy data."
```

### 3.6 Bottom Dock — Swatch Grid Always Shows 6 Columns (P3, Trivial)

**Problem:** `.dock-inline-swatches.color-grid` uses `grid-template-columns: repeat(6, 1fr)`. If the palette has fewer than 6 colors, the grid has empty cells that waste horizontal space. If the palette has more than 6, excess colors are hidden.

**Recommendation:** Use `grid-template-columns: repeat(auto-fill, minmax(1.45rem, 1fr))` for the dock swatches to auto-adapt to available space.

### 3.7 Color Input Size Inconsistency (P3, Trivial)

**Problem:** Color inputs have different sizes depending on context:
- Left sidebar: `56px × 36px` (`.color-input`)
- Dock: `36px × 36px` (`.dock-custom-color`)
- Inspector detail: `42px × 42px` (`.inspector-detail-color-field .color-input`)

While intentional for different contexts, the sidebar's 56px wide color input feels oversized compared to other controls.

**Recommendation:** Reduce sidebar color inputs to `48px × 36px` for a tighter, more balanced layout.

---

## 4. Accessibility Issues

### 4.1 No Skip Navigation Link (P1, Small)

**Problem:** The page has 60+ interactive controls in the left sidebar before the map canvas. Keyboard-only users must tab through every control to reach the map. No skip link exists.

**Recommendation:** Add as first child of `<body>`:
```html
<a href="#mapContainer" class="skip-link">Skip to map</a>
```
```css
.skip-link {
  position: absolute;
  top: -100%;
  left: 16px;
  z-index: 100;
  padding: 8px 16px;
  background: var(--color-accent);
  color: #fff;
  border-radius: var(--radius-btn);
  text-decoration: none;
  font-weight: 600;
}
.skip-link:focus {
  top: 16px;
}
```

### 4.2 ARIA Coverage Gaps in Dynamic Content (P2, Medium)

**Problem:** Static HTML has good ARIA coverage (29 attributes in index.html + 15 in JS). However, dynamically generated content is missing ARIA attributes:
- Country list buttons: no `aria-label` with country name
- Preset tree accordion buttons: no `aria-expanded`
- Legend editor rows: no `role="listitem"`
- Debug mode select: no `aria-describedby` linking to the hint text
- Color swatches in dock: have `aria-label` but no `role="option"` or `role="radio"` for selection semantics

**Recommendation:** Prioritize adding `aria-expanded` to all dynamically created accordion/toggle buttons, and `aria-label` to all buttons that only show an icon or color swatch.

### 4.3 Right Sidebar Accordion — No keyboard-only expand/collapse (P2, Small)

**Problem:** The right sidebar uses `<details>/<summary>` which is natively keyboard accessible. However, the country explorer groups use custom `<button>` elements as accordion triggers that toggle a sibling `<div>`. These custom accordions don't set `aria-expanded` and don't have `aria-controls` pointing to the expandable content.

**Recommendation:** On each accordion button:
```js
button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
button.setAttribute("aria-controls", contentDivId);
```

### 4.4 Color Contrast — Small Label Text (P2, Trivial)

**Problem:** Several label classes use `0.72rem`–`0.75rem` (roughly 11.5px–12px) with `color: var(--text-secondary)` (#636E72). At this size, WCAG 2.1 AA requires 4.5:1 contrast ratio for normal text. `#636E72` on `#FFFFFF` achieves ~4.6:1 — barely passing. But on `.bg-input` (#F0F2F5), contrast drops to ~3.9:1.

**Recommendation:**
- Darken `--text-secondary` slightly to `#525A5E` (5.2:1 on white, 4.5:1 on bg-input).
- Or increase minimum font size for secondary text to `0.8rem` (12.8px).

---

## 5. Code Quality & Maintainability

### 5.1 toolbar.js Size (P2, Background)

**Problem:** `toolbar.js` is ~85 KB / ~1,800 lines, containing a single `initToolbar()` function that does everything: DOM references, event binding, state initialization, render callbacks. This makes it hard to maintain and test.

**Recommendation:** (Background task, not blocking) Consider splitting into:
- `toolbar-init.js` — DOM references and event binding
- `toolbar-render.js` — UI update functions (`updateSwatchUI`, `updateToolUI`, etc.)
- `toolbar-ocean.js` — Ocean-specific initialization and normalization
- `toolbar-special-zones.js` — Special zone editor logic

### 5.2 sidebar.js Dynamic DOM Creation (P3, Background)

**Problem:** `sidebar.js` creates DOM elements imperatively (createElement → className → textContent → appendChild). This is functional but verbose. The Project Management section alone is 60 lines of DOM creation.

**Recommendation:** (Future consideration) Introduce a lightweight template helper:
```js
function el(tag, attrs, ...children) { ... }
```
This would reduce verbosity by ~40% while keeping zero-dependency architecture.

---

## 6. Missing Micro-interactions (Polish)

### 6.1 No Transition on Accordion Open/Close Content (P3, Trivial)

**Problem:** `<details>` elements snap open/close instantly. The summary arrow has a `transition: transform 0.2s` but the content has no height animation.

**Note:** Native `<details>` animation is tricky without JS. Consider using the `::details-content` pseudo-element (Chrome 131+) or accept the snap behavior for now.

### 6.2 No Loading State for Auto-Fill (P2, Small)

**Problem:** "Auto-Fill Countries" triggers `autoFillMap()` which can take 200–500ms for large topologies. During this time, the button shows no loading indicator. Users may click it multiple times.

**Recommendation:**
- Set `presetPolitical.disabled = true` during fill operation.
- Show a brief spinner or "Filling..." text on the button.
- Re-enable after completion.

### 6.3 No Hover Preview for Color Swatches (P3, Trivial)

**Problem:** Color swatches in the dock and palette library scale up on hover (`transform: scale(1.1)`) but don't show a tooltip with the hex value. Users must click a swatch to see what color it is.

**Recommendation:** Each swatch already has a `title` attribute with the hex value. Verify all dynamically created swatches also set `title`.

### 6.4 No "Unsaved Changes" Indicator (P2, Small)

**Problem:** After painting, there's no visual indicator that the project has unsaved changes. Users can close the browser and lose work without warning.

**Recommendation:**
- Track dirty state: set `state.isDirty = true` after any paint/undo/style change.
- Show a dot or asterisk next to the app title when dirty.
- Add a `beforeunload` listener when dirty:
  ```js
  window.addEventListener("beforeunload", (e) => {
    if (state.isDirty) { e.preventDefault(); }
  });
  ```

### 6.5 Map Container — No Onboarding Hint (P3, Small)

**Problem:** When the app loads with an empty/unpainted map, the dark map container shows no guidance. First-time users may not know how to start.

**Recommendation:** Show a centered, semi-transparent onboarding overlay on the map container when no features are painted:
```
"Click a region to start painting, or use Auto-Fill to color all countries"
```
Dismiss on first interaction.

---

## Priority Matrix

| # | Issue | Priority | Effort | Category |
|---|-------|----------|--------|----------|
| 1.1 | Left sidebar monolithic scroll | P1 | Medium | Layout |
| 1.2 | Special Zone Editor misplaced | P1 | Small | Layout |
| 2.1 | No drag-to-paint | P1 | Medium | Interaction |
| 2.2 | No cursor feedback for active tool | P1 | Small | Interaction |
| 2.3 | No destructive action confirmation | P1 | Small | Interaction |
| 4.1 | No skip navigation link | P1 | Small | A11y |
| 2.4 | Shortcut discoverability | P2 | Small | Interaction |
| 2.6 | Inspector not synced with map click | P2 | Medium | Interaction |
| 4.2 | ARIA gaps in dynamic content | P2 | Medium | A11y |
| 4.4 | Color contrast at small sizes | P2 | Trivial | A11y |
| 6.2 | No loading state for auto-fill | P2 | Small | Polish |
| 6.4 | No unsaved changes indicator | P2 | Small | Polish |
| 1.3 | Sticky search overlap | P2 | Small | Layout |
| 1.4 | Bottom dock medium-screen wrapping | P2 | Medium | Layout |
| 1.5 | Zoom/panel toggle overlap | P2 | Trivial | Layout |
| 3.1 | Inconsistent card padding | P2 | Small | Visual |
| 3.3 | Disabled ocean controls confusing | P2 | Small | Visual |
| 3.4 | Toast/zoom position conflict | P2 | Trivial | Visual |
| 3.5 | No empty state for preset tree | P2 | Trivial | Visual |
| 2.5 | Recent colors no clear | P2 | Trivial | Interaction |
| 2.7 | Palette library no close label | P2 | Trivial | Interaction |
| 4.3 | Custom accordion ARIA | P2 | Small | A11y |
| 3.2 | Range slider alignment | P2 | Trivial | Visual |
| 3.6 | Swatch grid fixed columns | P3 | Trivial | Visual |
| 3.7 | Color input size inconsistency | P3 | Trivial | Visual |
| 5.1 | toolbar.js monolith | P2 | Large | Code |
| 5.2 | sidebar.js DOM verbosity | P3 | Large | Code |
| 6.1 | No accordion animation | P3 | Trivial | Polish |
| 6.3 | No hover preview for swatches | P3 | Trivial | Polish |
| 6.5 | No onboarding hint | P3 | Small | Polish |

---

## Recommended Implementation Phases

### Phase 1 — Quick Wins (1-2 hours)
High-impact, low-effort fixes that immediately improve user experience:

1. **Tool cursor feedback** (2.2) — Add 3 CSS rules + 1 line in `updateToolUI()`
2. **Skip navigation link** (4.1) — 5 lines HTML + 10 lines CSS
3. **Shortcut hints in tooltips** (2.4) — Update `title` attributes on tool/undo/redo buttons
4. **Clear Map confirmation toast** (2.3) — Add toast "Map cleared — Ctrl+Z to undo"
5. **Zoom/toggle overlap fix** (1.5) — 3 lines CSS media query
6. **Toast position adjustment** (3.4) — Change `top: 76px` → `top: 96px`
7. **Palette library toggle text** (2.7) — Toggle button text on click
8. **Empty state for preset tree** (3.5) — 5 lines in sidebar.js

### Phase 2 — Layout Restructure (2-4 hours)
Address the left sidebar organization:

1. **Break up Appearance section** (1.1) — Convert sub-sections to nested `<details>`
2. **Extract Special Zone Editor** (1.2) — Move to own top-level card
3. **Hide disabled ocean controls** (3.3) — Replace with "Coming soon" placeholder
4. **Normalize card padding** (3.1) — Unify to 20px / 14px tiers

### Phase 3 — Interaction Enhancements (4-6 hours)
Add significant usability improvements:

1. **Drag-to-paint** (2.1) — mousedown/mousemove/mouseup handler + batch undo
2. **Inspector ↔ map click sync** (2.6) — Auto-select country on feature click
3. **Auto-fill loading state** (6.2) — Disable button + "Filling..." text during operation
4. **Unsaved changes guard** (6.4) — Dirty tracking + `beforeunload` listener

### Phase 4 — Accessibility & Polish (2-3 hours)
1. **ARIA attributes on dynamic content** (4.2) — `aria-expanded`, `aria-label`
2. **Text contrast improvement** (4.4) — Darken `--text-secondary`
3. **Onboarding hint** (6.5) — Empty-state overlay on map
4. **Bottom dock responsive fix** (1.4) — Grid layout at medium screens

### Phase 5 — Background (when convenient)
1. Split `toolbar.js` into modules (5.1)
2. DOM creation helper (5.2)

---

## Verification Method

Each phase should be verified by:
1. Visual check at 1920×1080 (desktop), 1280×800 (small laptop), 768×1024 (tablet portrait)
2. Keyboard-only navigation test (Tab through all controls)
3. Screen reader spot-check (NVDA or VoiceOver on key workflows)
4. Cross-browser check (Chrome, Firefox, Edge)

---

**Auditor:** Claude Code (QA-043)
**Status:** Report complete — awaiting implementation priority from project owner
