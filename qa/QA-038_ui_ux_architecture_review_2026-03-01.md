# QA-038: UI/UX Architecture Review (2026-03-01)

## Summary

- Comprehensive review of Map Creator's visual design, structural layout, interaction patterns, and accessibility posture
- Identifies a **P0 critical issue**: ~50 Tailwind CSS classes used in `js/ui/sidebar.js` have no matching definitions — the entire right sidebar is unstyled
- Catalogues structural problems (left sidebar overload, duplicate headers, inconsistent card wrappers) and missing interaction affordances (no undo/redo, no keyboard shortcuts, no drag-to-paint)
- Provides a prioritized roadmap (P0 / P1 / P2) with implementation sequence

---

## 1  Current State — What Works Well

| Area | Evidence |
|------|----------|
| **Design tokens** | `css/style.css` lines 4–19 define a coherent set of 14 custom properties (`--bg-app`, `--color-accent`, `--radius-card`, `--shadow-soft`, etc.) that give the app a consistent visual baseline |
| **Card hierarchy** | Three card tiers (`card`, `card-flat`, `card-compact`) create clear visual grouping in the left sidebar |
| **Typography** | Primary/secondary text colour tokens (`--text-primary: #2D3436`, `--text-secondary: #636E72`) plus the accent blue (`--color-accent: #002FA7`) provide a readable, professional palette |
| **Canvas atmosphere** | The map canvas uses D3 zoom with configurable scale extents, hover tooltips, and multi-layer rendering (colour, lines, texture overlay) — the core experience is solid |
| **i18n** | `t()` translation calls are used throughout JS; locale files support multiple languages |
| **Collapsible sections** | The advanced "Map Style" card uses `<details open>` for progressive disclosure (`index.html` line 166) |

**Overall**: The left sidebar and map canvas present a polished, token-driven design. The problems lie almost entirely in the dynamically generated right sidebar and in missing interaction affordances.

---

## 2  Critical Finding: Phantom Tailwind Classes (P0)

### 2.1 Problem

`js/ui/sidebar.js` generates DOM elements using **~50 Tailwind CSS utility classes**. **None of these classes are defined anywhere in the project.** There is no Tailwind installation, no `@tailwind` directives, no PostCSS configuration, and no matching rules in `css/style.css`.

The only Tailwind-like utilities that *do* exist in `style.css` (lines 411–432) are basic layout helpers:

```
flex  flex-1  flex-col  items-center  items-start  justify-between
gap-2  gap-3  mt-2  mt-3  mt-4  ml-5  w-full  relative  hidden
flex-wrap  space-y-2  space-y-3  space-y-4
```

Everything else — typography, colours, padding, borders, rounded corners, hover states — is missing.

### 2.2 Affected Classes (complete inventory)

| Category | Missing Classes | Count |
|----------|----------------|-------|
| **Typography** | `text-[10px]`, `text-[11px]`, `text-xs`, `text-sm`, `font-medium`, `font-semibold`, `uppercase`, `tracking-wide`, `text-left`, `list-none` | 10 |
| **Colours (text)** | `text-slate-400`, `text-slate-500`, `text-slate-600`, `text-slate-700` | 4 |
| **Colours (bg)** | `bg-white`, `bg-slate-50`, `bg-slate-100`, `bg-slate-200` | 4 |
| **Colours (border)** | `border-slate-200`, `border-slate-300` | 2 |
| **Spacing** | `px-2`, `px-3`, `py-1`, `py-2`, `p-2`, `p-3`, `pb-2`, `ml-2`, `ml-3`, `ml-6`, `mt-1`, `gap-1`, `space-y-1` | 13 |
| **Borders / Radius** | `border`, `rounded`, `rounded-md` | 3 |
| **Sizing** | `w-10`, `w-4`, `h-8`, `h-4`, `flex-1` (exists) | 4 |
| **Interactive** | `hover:bg-slate-50`, `hover:bg-slate-100`, `hover:bg-slate-200`, `hover:text-slate-700`, `cursor-pointer` | 5 |
| **Advanced** | `group`, `group-open:rotate-90`, `transition-transform`, `shadow-sm` | 4 |

**Total missing**: ~45 classes (excluding the ~8 that already exist in `style.css`).

### 2.3 Affected UI Regions

Every section rendered by `sidebar.js` is impacted:

| UI Region | Key Lines | Visual Impact |
|-----------|-----------|---------------|
| Hierarchy group headers | 600, 621 | No uppercase, no tracking, no slate-400 colour — labels look identical to body text |
| Hierarchy / preset buttons | 607, 628 | No rounded borders, no padding, no hover highlight — raw unstyled buttons |
| Country rows | 643–655 | No bg-slate-50 container, no border, no rounded-md — flat unstyled divs |
| Active / toggle buttons | 655, 670 | No border, no padding, no hover state — barely clickable targets |
| Colour pickers | 687 | No border-radius, no border colour — unstyled native input |
| Continent toggles | 821–836 | No bg-slate-100 background, no hover — invisible grouping |
| Subregion toggles | 859–870 | Same issues as continent toggles |
| Preset tree (details/summary) | 933–991 | No cursor-pointer, no list-none on summary, no group-open rotation on chevron |
| Legend editor | 1052–1061 | No colour swatch border, no rounded input — raw inputs |

### 2.4 Recommended Fixes

**Option A — Define missing classes in `css/style.css`** (fast, minimal disruption)

Add a new `/* Tailwind-compat utilities */` block after the existing utilities section (line 432). Define each missing class to match Tailwind v3 defaults. Approximate addition: ~90 rules / ~180 lines of CSS.

*Pros*: No JS changes, immediate visual fix.
*Cons*: Creates a maintenance burden — a bespoke subset of Tailwind that must be kept in sync manually.

**Option B — Refactor `sidebar.js` to use existing design-system classes** (thorough, sustainable)

Replace Tailwind classes with the project's own token-based styles (`card`, `card-flat`, `section-header`, `btn`, custom properties). Approximately 34 DOM-creation sites in `sidebar.js` would need updating.

*Pros*: Single source of truth; all UI matches the left sidebar's visual language.
*Cons*: Larger change surface; requires design decisions for each element.

**Recommendation**: Start with **Option A** for an immediate visual fix, then migrate to **Option B** incrementally.

---

## 3  Structural Issues

### 3.1 Left Sidebar Information Overload

`index.html` contains **10 distinct sections** in the left sidebar (320 px wide):

| # | Section | Lines | Approx Controls |
|---|---------|-------|-----------------|
| 1 | App Title / Intro | 13–21 | 0 |
| 2 | Current Tool | 23–31 | 3 buttons |
| 3 | Recent Colours | 33–36 | dynamic swatches |
| 4 | Colour Palette | 38–51 | theme selector + grid + custom picker |
| 5 | Export Map | 53–70 | format select + button |
| 6 | Tip Card | 72–74 | read-only text |
| 7 | Texture | 76–94 | 4 controls |
| 8 | Map Style (Basic) | 96–164 | ~15 controls (mode selectors, ocean settings, sovereign toggle, auto-fill/clear) |
| 9 | Map Style (Advanced) | 166–486 | ~40 controls (borders × 4, context layers × 4, special zone editor) |
| 10 | Reference Image | 488–521 | 6 controls |

`js/ui/toolbar.js` (1,404 lines) wires up event listeners for all of these. The resulting scroll depth is estimated at **~3,500 px** — roughly 5× the visible viewport.

**Recommendation**: Group sections into collapsible `<details>` accordions. Sections 7–9 (Texture, Map Style Basic, Map Style Advanced) could be combined under a single "Appearance" accordion. The "Map Style (Advanced)" section already uses `<details>` — extend the pattern.

### 3.2 Duplicate "Map Style" Headers

Two separate sections share the identical visible label "Map Style":

| Location | Element | `id` | Type |
|----------|---------|------|------|
| Line 97 | `<div class="section-header">` | `lblMapStyle` | Non-collapsible card |
| Line 167 | `<summary class="section-header">` | `labelMapStyle` | Collapsible `<details>` |

Users cannot distinguish them. **Recommendation**: Rename them — e.g. "Paint Settings" (line 97) and "Map Style" (line 167), or merge them into one card.

### 3.3 Inconsistent Card Wrappers

| Wrapping | Sections |
|----------|----------|
| `card` | Export, Texture, Map Style ×2, Reference Image |
| `card-flat` | Current Tool, Historical Presets |
| `card-compact` | Tip Card |
| **No wrapper** | App Title, Recent Colours, Colour Palette, right sidebar Country Colours, right sidebar Search |

The unwrapped sections break the visual rhythm. **Recommendation**: Wrap all sidebar sections in an appropriate card tier, even if it's just `card-flat`.

### 3.4 Right Sidebar Unbounded Growth

`sidebar.js` appends country rows, hierarchy groups, preset trees, and legend entries via `appendChild()` / `insertAdjacentHTML()`. There is no virtualization, scrolling constraint, or max-height. For maps with 200+ countries, the right sidebar can exceed 10,000 px.

**Recommendation**: Add `max-height` + `overflow-y: auto` to the country-list container, or implement virtual scrolling.

---

## 4  UI Style Improvements

### 4.1 Missing Design Tokens

The existing token set covers backgrounds, text, accent, border, shadow, radius, and spacing — but is missing several states commonly needed by interactive applications:

| Missing Token | Suggested Value | Use Case |
|---------------|-----------------|----------|
| `--color-danger` | `#E74C3C` | Delete buttons, error states |
| `--color-warning` | `#F39C12` | Unsaved-changes indicators |
| `--color-success` | `#27AE60` | Save confirmations, active states |
| `--color-disabled` | `#BDC3C7` | Disabled buttons / inputs |
| `--text-disabled` | `#A0A4A8` | Disabled text |
| `--transition-fast` | `150ms ease` | Button hovers, toggles |
| `--transition-medium` | `300ms ease` | Panel open/close |

### 4.2 No Disabled Button Styling

Buttons that should be disabled (e.g. "Clear Map" when the map is empty) have no CSS for the `:disabled` / `[disabled]` state. They remain visually identical to enabled buttons.

**Recommendation**: Add a `.btn:disabled` rule using the proposed `--color-disabled` and `--text-disabled` tokens.

### 4.3 Minimal Icon System

The entire app uses only **3 inline SVGs** (`index.html` lines 57, 80, 157), all info-circle icons. Every other control relies on text labels alone.

**Recommendation**: Introduce a small icon set (16×16) for common actions: download, upload, undo, redo, zoom-in, zoom-out, expand, collapse, delete, copy. This improves scannability, especially in the dense left sidebar.

---

## 5  Interaction Flow Improvements

### 5.1 No Undo/Redo for Paint Operations

The only undo capability is `undoSpecialZoneVertex()` (`js/core/map_renderer.js` line 3521), which removes the last vertex during special-zone drawing. There is **no undo/redo** for the primary paint/erase workflow.

**Impact**: A single mis-click can ruin minutes of careful colouring work. Users must manually repaint or reload a saved project.

**Recommendation**: Implement a command-stack (array of `{ featureId, oldColor, newColor }` objects) with Ctrl+Z / Ctrl+Shift+Z bindings. Keep the last 50–100 operations.

### 5.2 No Keyboard Shortcuts

There are **zero `keydown` / `keyup` event listeners** in the entire codebase. No shortcuts exist for any operation.

**Recommended initial shortcut set**:

| Key | Action |
|-----|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `F` | Fill tool |
| `E` | Eraser tool |
| `I` | Eyedropper tool |
| `Ctrl+S` | Save project |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom |

### 5.3 No Visible Zoom Controls

Zoom is implemented via D3 scroll-wheel behaviour (`js/core/map_renderer.js` lines 3896–3926) and works well, but is **completely invisible**. There are no on-screen zoom buttons, no zoom level indicator, and no reset-zoom affordance.

**Recommendation**: Add a small floating control cluster (bottom-right of map) with `+`, `−`, and zoom-percentage display.

### 5.4 No Toast/Notification System

Error feedback uses native `alert()` (found in `js/core/file_manager.js` lines 139, 145). Success feedback (e.g. after saving a project or exporting a map) is **silent** — users receive no confirmation.

**Recommendation**: Implement a lightweight toast system (auto-dismiss after 3 s, stacked in bottom-right corner) for success, warning, and error messages.

### 5.5 Click-to-Paint Only

Painting requires individual clicks on each feature. There is no drag-to-paint — `mousemove` in `map_renderer.js` (line 3930) is used only for hover/tooltip display, not for continuous painting.

**Impact**: Colouring large maps with hundreds of features is tedious.

**Recommendation**: Add a "drag paint" mode activated by holding the mouse button while moving. Apply the current colour to each feature entered during the drag.

### 5.6 No Minimap

When zoomed in, users lose spatial context. There is no minimap, overview panel, or viewport-position indicator.

**Recommendation**: Render a small (150×100 px) minimap in the bottom-left corner showing the full map with a viewport rectangle. Update it on every zoom/pan event.

---

## 6  Accessibility Gaps

### 6.1 ARIA Attributes

The only ARIA usage is `aria-hidden="true"` on three decorative SVG icons (`index.html` lines 57, 80, 157). No other ARIA attributes exist.

| Missing | Where |
|---------|-------|
| `aria-label` | Tool buttons, colour swatches, sidebar toggles, export button |
| `aria-pressed` | Tool selection buttons (Fill, Eraser, Eyedropper) |
| `aria-expanded` | Collapsible `<details>` sections, continent/subregion toggles in right sidebar |
| `role="toolbar"` | Current Tool section |
| `role="listbox"` / `role="option"` | Colour palette grid |
| `aria-describedby` | Tooltips on map features |

### 6.2 Keyboard Focus Styles

No `:focus-visible` styles exist for buttons, inputs, swatches, or other interactive elements. Keyboard-only users cannot see which element is focused.

**Recommendation**: Add a global `:focus-visible` outline using the accent colour:

```css
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

### 6.3 Skip Navigation

The left sidebar contains 65+ interactive controls before the map canvas. There is no skip-navigation link.

**Recommendation**: Add `<a href="#mapContainer" class="sr-only focus:not-sr-only">Skip to map</a>` as the first child of `<body>`.

### 6.4 Reduced Motion

No `prefers-reduced-motion` media query is used. The D3 zoom transitions, any future CSS transitions, and the `group-open:rotate-90` chevron animation will play regardless of user preference.

**Recommendation**: Wrap animations in `@media (prefers-reduced-motion: no-preference) { ... }`.

### 6.5 Text Contrast at Small Sizes

The phantom classes `text-[10px]` and `text-[11px]` in `sidebar.js` set extremely small font sizes. Even if these classes were functional, text at 10–11 px against a light background risks failing WCAG 2.1 AA contrast requirements (minimum 4.5:1 for normal text).

**Recommendation**: Set a floor of 12 px for all UI text. Use the existing `--text-secondary` colour (#636E72) only at 14 px+ where its 5.3:1 contrast ratio is sufficient.

---

## 7  Priority Matrix

### P0 — Must Fix (Broken Functionality)

| # | Issue | Section | Effort |
|---|-------|---------|--------|
| 1 | Phantom Tailwind classes — right sidebar unstyled | §2 | Medium (Option A) or Large (Option B) |

### P1 — Should Fix (Significant UX Impact)

| # | Issue | Section | Effort |
|---|-------|---------|--------|
| 2 | Undo/redo for paint operations | §5.1 | Medium |
| 3 | Keyboard shortcuts | §5.2 | Small |
| 4 | Visible zoom controls | §5.3 | Small |
| 5 | Duplicate "Map Style" headers | §3.2 | Trivial |
| 6 | Keyboard focus styles | §6.2 | Trivial |
| 7 | Toast/notification system | §5.4 | Small |

### P2 — Nice to Have (Polish / Completeness)

| # | Issue | Section | Effort |
|---|-------|---------|--------|
| 8 | Left sidebar collapse / accordion grouping | §3.1 | Medium |
| 9 | Consistent card wrappers | §3.3 | Small |
| 10 | Right sidebar scroll containment | §3.4 | Small |
| 11 | Missing design tokens (danger, warning, success) | §4.1 | Trivial |
| 12 | Disabled button styling | §4.2 | Trivial |
| 13 | Icon system | §4.3 | Medium |
| 14 | Drag-to-paint | §5.5 | Medium |
| 15 | Minimap | §5.6 | Large |
| 16 | ARIA attributes | §6.1 | Medium |
| 17 | Skip navigation | §6.3 | Trivial |
| 18 | Reduced motion support | §6.4 | Trivial |
| 19 | Minimum text size floor | §6.5 | Trivial |

### Recommended Implementation Sequence

```
Phase 1 (immediate):  #1 Phantom Tailwind fix (Option A)
                       #5 Rename duplicate header
                       #6 Focus-visible styles
Phase 2 (next sprint): #2 Undo/redo
                       #3 Keyboard shortcuts
                       #4 Zoom controls
                       #7 Toast system
Phase 3 (backlog):     #8–#19 in priority order
```

---

*Report generated 2026-03-01. No source code was modified.*
