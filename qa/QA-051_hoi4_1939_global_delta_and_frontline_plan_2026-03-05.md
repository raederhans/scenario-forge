# QA-051 HOI4 1939 Global Delta And Frontline Plan (2026-03-05)

## Scope
- Add a new HOI4 1939 bundled scenario anchored at `1939.8.14.12` (`blitzkrieg.txt`).
- Keep full global owner changes (not China-only).
- Add a separate frontline controller layer for China/Japan theater detail.
- Keep default scenario in index as `hoi4_1936`.

## Implemented

### 1) Date replay parser for states
- `scenario_builder/hoi4/parser.py`
  - Added `as_of_date` support to `parse_states(...)` and `parse_state_file(...)`.
  - Added dated block replay for:
    - `owner`
    - `controller`
    - `add_core_of`
    - `remove_core_of`
  - Added brace-aware parsing for HOI4 nested blocks.
- `scenario_builder/hoi4/models.py`
  - `StateRecord` now includes `controller_tag`.

### 2) Scenario compiler: owner/controller split outputs
- `scenario_builder/hoi4/compiler.py`
  - Added controller compilation path (`controllers.by_feature.json` payload).
  - Manifest now emits `controllers_url`.
  - Audit/summary now include:
    - `controller_count`
    - `owner_controller_split_feature_count`
    - `controller_rule_count`
    - `controller_changes`
  - Added scenario-configurable enforcement switches:
    - `enable_region_checks`
    - `enforce_region_checks`
    - `enforce_scenario_extensions`
  - Legacy 1936 critical-region checks can now be disabled for 1939 builds.

### 3) Build pipeline upgrades
- `tools/build_hoi4_scenario.py`
  - Added `--as-of-date`.
  - Added multi-file `--manual-rules` merge.
  - Added `--controller-rules`.
  - Added `state_owner_delta` generation (`1936` baseline vs target date).
  - Added state-delta coverage gate via `state_delta_coverage` metadata.
  - Writes `controllers.by_feature.json`.
  - Preserves scenario index default unless explicitly overridden.

### 4) 1939 rule packs
- Added `data/scenario-rules/hoi4_1939.manual.json`
  - Includes global owner delta rules for:
    - Anschluss
    - Czechoslovakia breakup related ownership
    - Memel
    - Albania
    - Ethiopia war result
    - Hatay
    - Aden enclave handling
  - Includes `state_delta_coverage` gate config.
- Added `data/scenario-rules/hoi4_1939.controller.manual.json`
  - Adds frontline controller overlays for key Sino-Japanese contested features.
  - Includes explicit Hebei-Chahar controller overrides.

### 5) Frontend Ownership / Frontline view
- `js/core/state.js`
  - Added scenario fields:
    - `scenarioViewMode`
    - `scenarioControllersByFeatureId`
    - `scenarioBaselineControllersByFeatureId`
    - `scenarioControllerRevision`
- `js/core/scenario_manager.js`
  - Loads `controllers_url` payload when available.
  - Applies/resets/clears controller baseline alongside owner baseline.
  - Added `setScenarioViewMode(...)`.
  - Added `getScenarioDisplayOwnerByFeatureId(...)`.
  - Added scenario-panel view mode UI wiring.
- `js/core/map_renderer.js`
  - Rendering color owner can switch between ownership and frontline controller.
  - Dynamic border mesh now rebuilds against selected scenario view mode.
- `index.html`
  - Added scenario panel select:
    - `#scenarioViewModeSelect` with `ownership/frontline`.
- `js/ui/toolbar.js`
  - Scenario context bar now shows current view mode label.
- `js/core/file_manager.js`, `js/ui/sidebar.js`
  - Project import/export now preserves scenario `viewMode`.

### 6) Scenario validation tooling
- Replaced hardcoded checker with expectation-driven checker:
  - `tools/check_hoi4_scenario_bundle.py`
  - New expectations:
    - `data/scenarios/expectations/hoi4_1936.expectation.json`
    - `data/scenarios/expectations/hoi4_1939.expectation.json`

## Generated Artifacts
- Added scenario bundle:
  - `data/scenarios/hoi4_1939/manifest.json`
  - `data/scenarios/hoi4_1939/countries.json`
  - `data/scenarios/hoi4_1939/owners.by_feature.json`
  - `data/scenarios/hoi4_1939/controllers.by_feature.json`
  - `data/scenarios/hoi4_1939/cores.by_feature.json`
  - `data/scenarios/hoi4_1939/audit.json`
- Added report:
  - `reports/generated/scenarios/hoi4_1939/state_owner_delta.json`
- Updated index:
  - `data/scenarios/index.json`
  - Added `hoi4_1939`, kept `default_scenario_id = hoi4_1936`.

## Validation Run
- `python tools/build_hoi4_scenario.py --scenario-id hoi4_1939 ...`
  - Built successfully.
  - Date anchor: `1939.8.14.12`
  - `feature_count=11192`
  - `owner_count=91`
  - `controller_count=91`
  - `owner_controller_split_feature_count=24`
  - `blocker_count=0`
  - `state_owner_delta_count=42`
- `python tools/check_hoi4_scenario_bundle.py --scenario-dir data/scenarios/hoi4_1939 --report-dir reports/generated/scenarios/hoi4_1939`
  - `OK`

## Notes / Known Limits (Current Revision)
- 1939 global coverage is implemented as rule-based mapping on current runtime geometry, not one-to-one HOI4 province polygons.
- China frontline controller layer is explicitly enabled and visible via `Ownership / Frontline` switch, but still depends on manual feature targeting (iterative refinement expected).
- Legacy 1936-specific critical region checks are disabled for 1939 by build diagnostics gate settings.
