# QA-094 Sovereignty / Visual UI Simplification Implementation Audit

Date: 2026-03-06
Workspace: `C:\Users\raede\Desktop\dev\mapcreator`
Scope: Implement the sovereignty-first UI simplification plan without changing project or scenario JSON schemas.

## 1. Console Errors and Warnings

- One persistent console error remains during all inspected states:
  - `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT` for `https://fonts.googleapis.com/css2?family=Inter...`
- This is an external font request being blocked by the local browser environment, not a new app regression from this change set.
- No new JavaScript exceptions or warnings were observed while validating:
  - clean free-paint startup
  - HOI4 1936 scenario apply
  - Germany parent-country scenario actions
  - Reichskommissariat Niederlande releasable activation
  - dock-triggered `Visual Adjustments` expansion
- Artifact:
  - `C:\Users\raede\Desktop\dev\mapcreator\.mcp-artifacts\qa056-console.txt`

## 2. Network Failures and 4xx/5xx

- The only observed network failure matches the console error above:
  - blocked Google Fonts `Inter` stylesheet request
- All localhost app and scenario data requests returned `200 OK`, including:
  - `data/locales.json`
  - `data/europe_topology.json`
  - `data/europe_topology.na_v2.json`
  - `data/europe_topology.runtime_political_v1.json`
  - `data/scenarios/index.json`
  - `data/scenarios/hoi4_1936/manifest.json`
  - `data/scenarios/hoi4_1936/countries.json`
  - `data/scenarios/hoi4_1936/owners.by_feature.json`
  - `data/scenarios/hoi4_1936/controllers.by_feature.json`
  - `data/scenarios/hoi4_1936/cores.by_feature.json`
- No 4xx/5xx failures were observed from app-owned localhost endpoints.
- Artifact:
  - `C:\Users\raede\Desktop\dev\mapcreator\.mcp-artifacts\qa056-network.txt`

## 3. Screenshot Paths

- Free-paint default:
  - `C:\Users\raede\Desktop\dev\mapcreator\.mcp-artifacts\qa056-freepaint-default.png`
- Scenario parent-country state (`HOI4 1936`, Germany selected):
  - `C:\Users\raede\Desktop\dev\mapcreator\.mcp-artifacts\qa056-scenario-parent-germany.png`
- Scenario releasable state (`HOI4 1936`, Reichskommissariat Niederlande selected and activated):
  - `C:\Users\raede\Desktop\dev\mapcreator\.mcp-artifacts\qa056-scenario-releasable-rkn.png`

## 4. Reproduction Steps

1. Hard-refresh `http://127.0.0.1:8002/`.
2. Confirm the default no-scenario state shows:
   - scenario context bar `Scenario: None`
   - scenario context bar `Mode: Visual Color`
   - dock summary `Visual Color Brush`
   - dock primary row shows `Political Editing`, but not scenario-only `Visual Adjustments`
3. Select `HOI4 1936` in the Scenario card and click `Apply`.
4. Confirm scenario mode switches to sovereignty-first behavior:
   - scenario context bar `Mode: Political Ownership / View: Ownership / Split: 0`
   - active owner shown in the context bar
   - dock primary row no longer shows the paint-mode selector
   - dock primary row shows `Political Ownership Brush` plus `Visual Adjustments`
5. With Germany selected, confirm `Scenario Actions` now present ownership-first groups only:
   - `Releasable Countries`
   - `Hierarchy Groups`
   - `Regional Presets`
   - collapsed `Visual Adjustments`
6. Click `Reichskommissariat Niederlande (RKN)`.
7. Confirm releasable-country state removes the generic inspector active-owner toggle and instead shows:
   - hint text directing the user to `Activate Releasable` or `Reapply Core Territory`
   - scenario actions for `Return to Germany (GER)`, `Activate Releasable`, `Reapply Core Territory`, and `Notes`
8. Click `Activate Releasable`.
9. Confirm:
   - context bar active owner changes to `Reichskommissariat Niederlande (RKN)`
   - the releasable row gains an `Active` badge
   - toast title `Active owner updated`
   - toast body `Political ownership editing now targets this releasable.`
10. Click the dock `Visual Adjustments` entry.
11. Confirm the side panel expands a visual-only subsection with:
   - explicit note that ownership/controllers/borders stay unchanged
   - `Use Visual Color Brush`
   - releasable visual-only actions for core territory color and override clearing

## 5. Minimal Patch Direction

- `js/ui/toolbar.js`
  - Reworked the dock paint row into a summary-first layout.
  - Kept free-paint visual-first.
  - Moved ownership editing behind a collapsed `Political Editing` section in non-scenario mode.
  - Replaced the scenario-mode primary row selector with passive context plus a secondary `Visual Adjustments` entry.
  - Hid active-owner and border-maintenance controls unless ownership editing is relevant.
- `js/ui/sidebar.js`
  - Split shared preset/group/core-territory helpers into explicit ownership-only vs visual-only flows.
  - Made primary Scenario Actions ownership-only regardless of global `paintMode`.
  - Preserved quick `Activate` for releasables in the explorer.
  - Added a collapsed `Visual Adjustments` subsection for color-only scenario work.
  - Removed duplicate scenario mode and active-owner summaries from the Scenario Actions area.
- `js/core/scenario_manager.js`
  - Preserved sovereignty-first auto-switch on scenario apply.
  - Added UI-local scenario panel state handling without changing exported project data.
- `js/core/state.js`
  - Added `state.ui.politicalEditingExpanded` and `state.ui.scenarioVisualAdjustmentsOpen`.
- `index.html`, `js/ui/i18n.js`, `data/locales.json`, `css/style.css`
  - Renamed user-facing terminology and added supporting layout/styling hooks for the new dock and scenario panel structure.

## Implemented Changes Summary

- User-facing naming was normalized:
  - `Visual` -> `Visual Color`
  - `Sovereignty` -> `Political Ownership`
  - `Set Active` -> `Use as Active Owner`
  - `Active Sovereign` -> `Active Owner`
- Main-app behavior now biases toward the common path:
  - free-paint opens in visual color mode
  - ownership editing is available, but no longer competes for first-screen attention
- Scenario behavior now biases toward the historically meaningful path:
  - scenario actions always operate on political ownership and border state
  - color-only adjustments are available, but moved into an explicitly secondary visual-only section
- Country explorer and inspector are clearer:
  - row click still navigates
  - releasables keep a one-click `Activate`
  - releasables no longer show the generic inspector active-owner toggle
  - normal countries retain one clear active-owner action
- No scenario or project schema changes were introduced.

## Removed or Relabeled Controls

- Removed from the scenario dock primary row:
  - always-visible `paintModeSelect`
- Moved out of the primary no-scenario paint row:
  - active-owner display
  - ownership-only maintenance controls
- Relabeled:
  - `Visual` -> `Visual Color`
  - `Sovereignty` -> `Political Ownership`
  - `Set Active` -> `Use as Active Owner`
  - `Activate` remains on releasable quick actions
  - scenario releasables now surface `Activate Releasable` and `Reapply Core Territory`

## Validation Notes

- Syntax validation passed for:
  - `js/ui/sidebar.js`
  - `js/ui/toolbar.js`
  - `js/ui/i18n.js`
  - `js/core/scenario_manager.js`
- `data/locales.json` parses successfully after the terminology updates.
- The scenario exit path still restores the user's pre-scenario paint/editing state by design. This means a user who entered scenario mode while already in ownership editing will return to that same non-scenario ownership state after exit.

## Residual Risk / Follow-up

- Export/import round-trip was not manually exercised in the browser during this QA pass.
- Risk is low because:
  - no project/scenario schema keys were changed
  - new flags are UI-local under `state.ui`
  - syntax and runtime scenario interactions were revalidated
