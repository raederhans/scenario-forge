# Visual editing boundary: P1 and P2

Baseline: `a6448876`, 2026-09-24. This is a staged product retirement,
not a geometry/rendering rewrite.

## Product contract

The editor has one player-facing edit mode: visual painting. The independent
political ownership editor is disabled in normal and developer workspaces.
Scenario/geographic reference membership remains available for initial colors,
Auto Fill, inspection, and the existing reference border implementation.

There are no user-authored legacy saves to migrate. This change adds no migration
converter, no backfill, and no old-save reconstruction. Project input cannot
restore ownership edits or the retired mode. Existing project paint persistence
continues using the current schema; serializer/field-name cleanup is a later step.

Exact RGB uniqueness per country and any RGB-to-country identity policy are
explicitly deferred. Two reference groups may still have equal colors. Reference
identity must never be inferred from an RGB value in these phases.

## P1: disable editing, not reference loading

`map_editing_policy.js` defines an immutable product capability, rather than an
importable setting or a hidden developer flag. The normalizer always returns
`visual`. Toolbar, scenario entry/exit, presentation restore and import use it.

Map interaction guards, low-level ownership setters, high-level scenario batch
commands, sidebar mutation commands, history replay, developer quick actions and
Tag Creator no longer apply ownership changes. Commands report
`ownership-editing-disabled` before changing state or scheduling effects.
Scenario loading and reset still publish reference assignments. Those lifecycle
operations are intentionally not treated as player ownership edits.

The ownership controls, activation actions and owner/controller brush switch are
removed from the visible editor. Selection, country browsing, visual presets,
reference-region recoloring, and developer diagnostics remain available.

## P2: reference and paint data boundary

`getMapDataBoundary(state)` exposes two frozen, cached facades, not two new stores:

* `reference` returns detached origin metadata and immutable membership arrays.
  Scenario queries use baseline assignments, never player paint or mutable owner
  mirrors. Complete group membership includes not-yet-hydrated features. Baseline
  publication clones and freezes the assignment map. Replacement on scenario
  switch/rollback invalidates membership naturally; mutable transitional inputs
  are deliberately not cached.
* `paint.resolveFeatureColor` exposes one logical base-palette plus feature-edit
  resolution API. `applyFeaturePaintState` validates a full paint/erase batch
  before writes and keeps current internal mirror fields synchronized. It does
  not write reference metadata, schedule renders, or create history itself.

The main paint transaction, sidebar batch/erase operations, palette feature edits
and ordinary land color resolver use these boundaries. Their existing history,
render scheduling and partial refresh behavior remains at the composition roots.
Special water/Atlantropa/strategic display rules remain separate and are never
baked into persistent paint.

The compact palette and per-feature override representation is not flattened in
P2. The old internal field names remain transition adapters. This avoids adding
a second mutable truth or forcing an all-consumer rewrite in one change.

## Deferred work and acceptance limits

Auto Fill and border generation still read their existing runtime reference
mirrors. This change does not recalculate borders from colors, remove scenario
owner assets, change geography/topology/chunk hydration, or claim an FPS gain.
Further migration should move consumers to the reference/paint API, then remove
unused fields and rename ownership diagnostics. Do not delete modules simply
because their names contain `owner`: many are responsibility owners.

Focused checks:

```sh
npm run test:node:ownership-retirement
npm run test:node:scenario-lifecycle-runtime-behavior
npx playwright test tests/e2e/ownership_retirement.spec.js tests/e2e/ui_rework_mainline_shell_sidebar.spec.js --grep "ownership editing|desktop commands" --workers=1
npm run verify:state-write-allowlist
python -m unittest tests.test_map_renderer_color_resolution_strategy_boundary_contract tests.test_scenario_state_actions_boundary_contract tests.test_sidebar_split_boundary_contract -q
```

A full `check_state_writer_policy.mjs` run is not evidence of a new regression by
itself: the unmodified baseline already fails the borrowed-owner source proof
for `js/core/map_renderer.js`. The retirement must not widen that policy or refresh
unrelated fingerprints merely to turn the historical proof green. Record that
baseline limitation separately from the focused behavior and publication checks.
