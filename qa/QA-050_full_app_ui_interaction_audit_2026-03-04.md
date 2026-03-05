# QA-050: Full Application UI Interaction & Layout Audit (Post-Scenario Integration)

**Date:** 2026-03-04
**Scope:** Complete UI review — layout, interaction flow, information hierarchy, component responsibilities, user operation logic
**Focus:** UI/UX only (not data pipeline correctness)

---

## Executive Summary

After scenario support was added, the app's UI has grown organically to ~860 lines of HTML and ~2400+ lines each in toolbar.js/sidebar.js. While individual features work, the overall interaction model has accumulated structural debt: information is fragmented across panels with no clear flow, the left sidebar mixes configuration levels, the bottom dock is overloaded, and scenario mode introduces a parallel interaction paradigm that conflicts with the base editing model. This audit identifies 14 findings across 5 categories.

---

## 1. Layout Architecture

### Current Structure

```
┌──────────────────────────────────────────────────────────────┐
│ LEFT SIDEBAR          │  MAP CANVAS          │ RIGHT SIDEBAR │
│ (config panel)        │                      │ (inspector)   │
│                       │                      │               │
│ - App Title/Lang      │                      │ - Search      │
│ - Color Library       │                      │ - Country Ins │
│ - Scenario            │                      │ - Terr/Preset │
│ - Editing Rules       │                      │ - Proj/Legend  │
│ - Special Zone Editor │                      │ - Diagnostics │
│ - Appearance (huge)   │                      │               │
│ - Tip                 │  ┌──────────────┐    │               │
│                       │  │ BOTTOM DOCK  │    │               │
│                       │  │Tools│Hist│Clr│    │               │
│                       │  │AutoFill│Util │    │               │
│                       │  │ Swatches     │    │               │
│                       │  └──────────────┘    │               │
└──────────────────────────────────────────────────────────────┘
```

### F-1: Left Sidebar Mixes Abstraction Levels (Severity: High)

**Problem:** The left sidebar contains items at wildly different abstraction levels:
1. **Session-level** — Scenario selection (sets up the entire data context)
2. **Workflow-level** — Editing Rules (paint mode, granularity, sovereignty)
3. **Tool-level** — Special Zone Editor (a specific drawing tool)
4. **Style-level** — Appearance (ocean, borders, layers, texture — 4 nested `<details>` deep)
5. **Reference** — Color Library (lookup tool, not configuration)

The user must scroll past scenario setup, editing rules, AND the special zone editor just to reach appearance settings — the most commonly adjusted controls during map styling.

**Impact:** Users lose context of what level they're operating at. Frequently-used appearance controls are buried deep. The panel reads like an unsorted settings dump rather than a workflow.

**Recommendation:**
- **Group by workflow phase:** Setup (scenario, palette source) → Edit (tools, rules) → Style (appearance)
- Move Special Zone Editor into a collapsible tool panel on the right or as a modal/popover triggered from the bottom dock (it's a specific drawing tool, not a config category)
- Move Color Library to the right sidebar (it's an inspector/lookup tool, not a configuration panel)

---

### F-2: Bottom Dock Overload — 6 Groups Competing for Horizontal Space (Severity: High)

**Problem:** The bottom dock packs 6 groups into one horizontal strip:
1. Tools (4 buttons)
2. History (2 buttons)
3. Quick Colors (preview + picker + palette select)
4. Auto-Fill (mode select + fill button + clear button)
5. Utilities (reference + export, each with popovers)
6. Swatches (palette grid + recent colors)

On typical screens (1366-1920px), this strip forces items to compress, overflow, or become too small to comfortably target. The palette select dropdown in the "Quick Colors" group is especially cramped.

**Impact:** Primary painting tools (fill, eraser, eyedropper, brush) compete visually with secondary actions (export, reference, auto-fill). No clear primary vs. secondary distinction.

**Recommendation:**
- **Primary row:** Tools + History + selected color preview + swatches (the painting workflow)
- **Secondary row or popover:** Auto-Fill, palette source, export, reference
- Consider a compact "mode bar" above the dock showing current paint mode + active sovereign when in scenario mode

---

### F-3: Right Sidebar Section Order Changes Between Modes (Severity: Medium)

**Problem:** In `updateScenarioInspectorLayout()` (sidebar.js:802-810), when scenario mode activates, the code physically reorders DOM elements:
```js
if (isScenarioMode) {
  sidebarSections.insertBefore(selectedCountryActionsSection, countryInspectorSection);
} else {
  sidebarSections.insertBefore(countryInspectorSection, selectedCountryActionsSection);
}
```

In **normal mode**: Country Inspector → Territories & Presets
In **scenario mode**: Territories & Presets (renamed "Scenario Actions") → Country Inspector

**Impact:** Users who switch between scenario and non-scenario modes find the panel order flip-flopping. The mental model of "inspector is on top, actions are below" gets reversed. This is disorienting.

**Recommendation:** Keep a consistent order. The inspector (selection) should always come first, actions second. In scenario mode, rename "Territories & Presets" to "Scenario Actions" but keep it below the inspector. Alternatively, make the Scenario Actions panel a persistent top-level context bar rather than a reorderable section.

---

## 2. Interaction Flow Issues

### F-4: Scenario Activation Is a 3-Step Process Hidden Across 2 Panels (Severity: High)

**Problem:** To use a scenario, the user must:
1. **Left sidebar → Scenario card:** Select scenario from dropdown → click "Apply" → wait for load
2. **Left sidebar → Editing Rules card:** Change Paint Mode to "Sovereignty" (optional but essential for meaningful scenario work)
3. **Right sidebar → Country Inspector:** Select a country → click "Set Active"

These 3 steps span 2 different sidebars and 3 different cards. There is no guided flow, no wizard, no visual indicator connecting these steps. A new user applying their first scenario has no idea they need to also switch paint mode and set an active sovereign.

**Impact:** Scenario mode is the app's most powerful feature but has the worst discoverability. Users apply a scenario, see colored countries, and think they're done — never realizing they can interact with sovereignty or releasables.

**Recommendation:**
- After scenario application, show a brief guided prompt or toast: "Scenario loaded. Switch to Sovereignty paint mode to reassign territories."
- Consider auto-opening the right sidebar and scrolling to the Scenario Actions section after applying a scenario
- Add a "Scenario Quick Start" panel in the right sidebar that surfaces Paint Mode + Active Sovereign when a scenario is active

---

### F-5: Paint Mode and Active Sovereign Are Split Between Left Sidebar and Right Sidebar (Severity: High)

**Problem:**
- **Paint Mode selection** (Visual/Sovereignty): Left sidebar → "Editing Rules" card
- **Paint Granularity** (Subdivision/Country): Left sidebar → "Editing Rules" card
- **Active Sovereign display**: Left sidebar → "Editing Rules" card (read-only label)
- **Active Sovereign selection**: Right sidebar → Country Inspector → select country → "Set Active" button
- **Scenario Action Status** showing current mode + active: Right sidebar → Scenario Actions panel

The toolbar.js `renderScenarioActionStatus()` (sidebar.js:1866-1898) duplicates the mode/active info that already exists in the left sidebar's Editing Rules card. The user sees paint mode info in two places but can only change it from one.

**Impact:** The user must look left to understand their mode, look right to change their active country, then look left again to verify. This ping-pong between panels is the #1 source of confusion in scenario workflows.

**Recommendation:**
- Move Paint Mode and Active Sovereign controls to the **right sidebar** when a scenario is active (or to a floating context bar)
- Make the Scenario Actions status strip interactive — clicking the mode chip should toggle it, clicking the active chip should scroll to the inspector
- Remove the duplicated read-only display from the left sidebar when scenario is active

---

### F-6: "Set Active" Button Has Dual Behavior Without Visual Distinction (Severity: Medium)

**Problem:** The `countryInspectorSetActive` button (sidebar.js:1755-1782) toggles between "Set Active" and "Set Inactive" with only a text label change. When active, it adds `is-active` class. But:
- There's no color differentiation (both use `btn-secondary`)
- The toast only shows for releasable countries, not regular ones
- "Set Active" and "Set Inactive" are not clearly opposite actions — users may think "Set Active" makes the country do something, not that it sets the sovereignty painting target

**Impact:** Users don't understand what "active" means in this context. The term "Active Sovereign" is jargon from HOI4 modding, not intuitive UI language.

**Recommendation:**
- Rename to "Paint as [Country Name]" / "Stop Painting as [Country Name]"
- Use a distinct visual state (accent color when active, like a toggle button)
- Always show a brief confirmation toast explaining what changed

---

### F-7: Releasable Country Interaction Flow Is Not Self-Documenting (Severity: Medium)

**Problem:** For releasable countries (e.g., releasing Finland from Soviet Union), the flow is:
1. Find Soviet Union in Country Inspector
2. Expand the releasable children list (click ">" toggle)
3. Click Finland in the children list (this selects it in the inspector)
4. Now "Scenario Actions" panel shows Finland's core territory preset
5. Click "Apply Core Territory"

But the "Apply Core Territory" button behavior depends on the current paint mode:
- In **Visual mode**: fills features with the country's resolved color
- In **Sovereignty mode**: assigns sovereignty AND sets the active sovereign first

This modal behavior is documented only in the scenario action hint text at the top of the actions panel, which users typically skip.

**Impact:** Users expecting to reassign sovereignty may accidentally only paint visual colors (or vice versa). The dual-behavior design requires understanding the paint mode system first.

**Recommendation:**
- In scenario mode, always show both options explicitly: "Paint Color" and "Assign Sovereignty" as separate buttons
- Or: auto-set paint mode to sovereignty when applying a releasable core territory (with a toast notification)

---

## 3. Information Hierarchy Issues

### F-8: Right Sidebar Has 4 Collapsible Sections with No Visual Hierarchy (Severity: Medium)

**Problem:** The right sidebar contains:
1. Country Inspector (always open in scenario mode)
2. Territories & Presets / Scenario Actions (forced open in scenario mode)
3. Project & Legend
4. Diagnostics

All 4 use the same `<details class="card inspector-section">` pattern with identical visual weight. There's no indication of which sections are primary (Inspector, Actions) vs. secondary (Project, Diagnostics).

**Impact:** Users must mentally prioritize sections themselves. In scenario mode, the two bottom sections (Project/Legend, Diagnostics) are rarely needed but consume equal visual weight.

**Recommendation:**
- Use visual differentiation: primary sections (Inspector, Actions) get full card treatment; secondary sections (Project, Legend, Diagnostics) get a more compact, muted style
- In scenario mode, consider auto-collapsing Project & Legend and Diagnostics sections

---

### F-9: Appearance Panel Is 4 Levels Deep with ~40 Individual Controls (Severity: Medium)

**Problem:** The Appearance section nesting is:
```
Appearance (details)
  ├─ Ocean (details)
  │    └─ 4 controls
  ├─ Borders (details)
  │    ├─ Internal Borders (details) → 3 controls
  │    ├─ Empire Borders (details) → 2 controls
  │    ├─ Coastlines (details) → 2 controls
  │    └─ Parent Unit Borders (details) → 3 controls + country list
  ├─ Context Layers (details)
  │    ├─ Physical Regions (details) → 8 controls
  │    ├─ Urban Areas (details) → 4 controls
  │    ├─ Rivers (details) → 6 controls
  │    └─ Special Zones Style (details) → 8 controls
  └─ Texture (details) → 10+ controls (mode-dependent)
```

That's `<details>` inside `<details>` inside `<details>` inside `<details>` — 4 levels. The user must click through 3-4 expand actions to reach a specific control like "Contour Spacing" for physical regions.

**Impact:** Appearance tuning requires excessive clicks. Users who want quick adjustments (e.g., border width) must navigate a deep tree every time.

**Recommendation:**
- Flatten the hierarchy to 2 levels maximum: category → controls
- Consider a tab-based or segmented control approach for the major categories (Ocean, Borders, Layers, Texture) instead of nested accordions
- Provide a "quick style" presets row at the top (e.g., "Default", "Print", "Vintage", "Clean") that set multiple appearance values at once

---

### F-10: Scenario Card Provides Minimal Feedback During and After Load (Severity: Low-Medium)

**Problem:** The scenario card in the left sidebar (index.html:38-52) has:
- A select dropdown
- An "Apply" button
- A "Reset Changes To Baseline" button (hidden until scenario is active)
- An "Exit Scenario" button (hidden until active)
- A status text: "No scenario active"
- An audit hint: "Coverage report unavailable"

After applying a scenario, the status updates to show the scenario name, but there's no summary of what was loaded (how many countries, feature count, quality indicators). The audit hint remains generic.

**Impact:** Users don't know if the scenario loaded correctly or what coverage to expect. The manifest.summary data (which includes feature_count, owner_count, blocker_count, etc.) is available but not surfaced here.

**Recommendation:**
- After scenario load, show a compact summary: "HOI4 1936 — 96 countries, 11,192 features, 0 blockers"
- Link to the Diagnostics → Scenario Audit section for full details
- Show a quality indicator (green/yellow/red badge based on blocker_count)

---

## 4. Functional Overlap and Redundancy

### F-11: Color Library (Left) vs. Palette Swatches (Dock) vs. Palette Select (Dock) (Severity: Medium)

**Problem:** Color-related controls are scattered across 3 locations:
1. **Left sidebar → Color Library card:** Full palette browser with search, all colors listed with metadata, expandable
2. **Bottom dock → Quick Colors group:** Selected color preview, custom color picker, palette source dropdown
3. **Bottom dock → Swatches row:** 6 quick palette swatches + 10 recent colors

The Color Library is a full browsing experience, but it's in the left sidebar (a config panel), while the palette source selector is in the bottom dock. If a user changes the palette source in the dock, the Color Library in the left sidebar updates — but there's no visual connection between these two locations.

**Impact:** Users may not realize the Color Library and dock swatches share the same palette source. The left sidebar Color Library panel is likely overlooked because users expect color tools near the painting area (bottom dock).

**Recommendation:**
- Move the Color Library to the right sidebar under Project & Legend (it's an inspector tool)
- Or: make it a popover triggered from the dock's Quick Colors section
- Ensure the palette source selector appears in one canonical location only

---

### F-12: "Editing Rules" Card Should Not Exist as a Standalone Section (Severity: Medium)

**Problem:** The "Editing Rules" card (index.html:54-70) contains:
1. Paint Granularity (Subdivision / Country)
2. Paint Meaning (Visual / Sovereignty)
3. Active Sovereign (read-only label)
4. Recalculate Borders button
5. Dynamic Border Status

These are painting workflow controls, not "rules." Items 1-3 are direct painting modifiers that should be near the painting tools. Items 4-5 are border maintenance that belongs with border appearance settings.

**Impact:** The "Editing Rules" label doesn't help users understand what these controls do. Painting modifiers are separated from the painting tools (which are in the bottom dock).

**Recommendation:**
- Merge Paint Granularity and Paint Mode into the bottom dock's Tools group (as a compact mode selector)
- Move Active Sovereign to the right sidebar's inspector context
- Move Recalculate Borders / Border Status to the Appearance → Borders section
- Eliminate the "Editing Rules" card entirely

---

### F-13: Special Zone Editor Is a Full Panel for an Occasional Tool (Severity: Low-Medium)

**Problem:** The Special Zone Editor (index.html:72-104) occupies a full card in the left sidebar with:
- Type selector (3 options)
- Label input
- Start Draw / Undo Vertex buttons
- Finish / Cancel buttons
- Manual Zones list
- Delete Selected button
- Hint text

This is a drawing tool that's used infrequently compared to basic painting. Yet it occupies permanent sidebar real estate equal to the Scenario card.

**Impact:** Sidebar scroll length increases. The editor is always visible (as a collapsed `<details>`) even when not in use, adding visual noise.

**Recommendation:**
- Move to a floating panel or popover triggered from a bottom dock icon (similar to Reference and Export)
- Or: move to the right sidebar under Diagnostics as a tool section
- Show it only when the special zone tool is selected from the dock

---

## 5. Scenario-Specific Issues

### F-14: No Visual Distinction Between Scenario Mode and Free-Paint Mode (Severity: High)

**Problem:** When a scenario is active, the app looks nearly identical to free-paint mode. The only indicators are:
- Left sidebar: scenario status text changes from "No scenario active" to the scenario name
- Right sidebar: "Selected Country Actions" title changes to "Scenario Actions"
- Right sidebar: ordering hint is hidden; country list shows scenario-specific entries

There is no global visual indicator (banner, border, background tint, or persistent chip) that tells the user "you are in scenario mode."

**Impact:** Users can accidentally paint over scenario data without realizing they're in a constrained mode. There's no "safety net" visual cue.

**Recommendation:**
- Add a persistent scenario mode indicator — either:
  - A thin colored bar at the top of the map area: "Scenario: HOI4 1936 · Sovereignty Mode · Active: Germany"
  - A colored border or subtle background tint on the sidebars when scenario is active
  - A persistent chip/badge near the zoom controls showing the active scenario
- Consider dimming or disabling controls that conflict with scenario mode (e.g., "By Country" paint granularity is forced to "subdivision" in sovereignty mode — show it as disabled)

---

## Summary Table

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| F-1 | Left sidebar mixes abstraction levels | High | Layout |
| F-2 | Bottom dock overload (6 groups) | High | Layout |
| F-3 | Right sidebar section order flips between modes | Medium | Layout |
| F-4 | Scenario activation is 3-step across 2 panels | High | Flow |
| F-5 | Paint mode split between left and right sidebars | High | Flow |
| F-6 | "Set Active" dual behavior without visual distinction | Medium | Flow |
| F-7 | Releasable flow not self-documenting | Medium | Flow |
| F-8 | Right sidebar sections lack visual hierarchy | Medium | Hierarchy |
| F-9 | Appearance panel 4 levels deep with ~40 controls | Medium | Hierarchy |
| F-10 | Scenario card provides minimal load feedback | Low-Medium | Hierarchy |
| F-11 | Color controls scattered across 3 locations | Medium | Overlap |
| F-12 | "Editing Rules" card is misplaced and mislabeled | Medium | Overlap |
| F-13 | Special Zone Editor is full panel for occasional tool | Low-Medium | Overlap |
| F-14 | No visual distinction between scenario and free-paint mode | High | Scenario |

---

## Recommended Implementation Priority

### Phase 1 — High Impact, Low-Medium Effort
1. **F-14:** Add scenario mode visual indicator (top bar or persistent chip)
2. **F-4:** Add post-scenario-apply guided prompt/toast
3. **F-5:** Surface paint mode + active sovereign in right sidebar context when scenario is active
4. **F-10:** Show scenario summary stats after load

### Phase 2 — Structural Improvements
5. **F-1:** Reorganize left sidebar by workflow phase (Setup → Edit → Style)
6. **F-12:** Eliminate "Editing Rules" card — distribute controls to dock and right sidebar
7. **F-3:** Fix right sidebar section ordering to be consistent

### Phase 3 — Polish and Cleanup
8. **F-2:** Split bottom dock into primary (painting) and secondary (utilities) rows
9. **F-9:** Flatten Appearance to 2-level hierarchy, add quick style presets
10. **F-11:** Consolidate color controls to fewer locations
11. **F-6:** Rename "Set Active" to "Paint as [name]" with visual toggle state
12. **F-7:** Add explicit dual buttons for releasable actions (Paint / Assign)
13. **F-8:** Visual hierarchy for right sidebar sections
14. **F-13:** Move Special Zone Editor to popover or right sidebar tool section

---

## Design Principles for Refactoring

1. **One flow direction:** Setup flows top-down (scenario → palette → mode → paint → export). Controls should follow this order spatially.
2. **Mode awareness:** The UI should clearly communicate what mode the user is in at all times. Modal behaviors must be visible, not hidden behind identical-looking buttons.
3. **Progressive disclosure:** Show frequently-used controls first, advanced options behind one (not three) expand actions.
4. **Spatial consistency:** Controls that affect the same concept should live in the same panel. Don't split paint mode between two sidebars.
5. **Minimal panel switching:** A complete workflow (e.g., "release Finland from the USSR") should be possible without switching between sidebars.
