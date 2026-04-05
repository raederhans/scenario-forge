# Findings

## Confirmed 1939 Reference

- Reference commit: `14e763939363c86cfedac289c37f6288533597d9`
- Semantic gold signals:
  - `owner_count = 115`
  - `controller_count = 117`
  - `synthetic_owner_feature_count = 18`
  - `CHI.feature_count = 1445`
  - `owner_rule_paths` must include both `hoi4_1936.manual.json` and `hoi4_1939.manual.json`
  - featured tags must still include `SOV`, `RAJ`, `YUG`, `MAN`, `SIK`

## Root Causes Confirmed

- `build_hoi4_scenario.py` had been changed to resolve 1939 owner manual rules from `hoi4_1939.manual.json` alone, which treated a delta override file as a full ownership rule pack.
- `js/core/data_loader.js` only invoked the startup worker when topology was missing, so localization partial-cache misses fell back to the main thread and slowed startup.
- A follow-up review confirmed that preserving partial-cache worker behavior also requires keeping the already cached topology alive when `needTopologyPrimary = false`; otherwise the worker returns `null` and the main thread re-fetches topology anyway.
- A follow-up review confirmed that moving coarse chunk prewarm fully off the scenario-apply path broke the default flush contract for chunked scenarios; the first coarse chunk frame must still be ready before apply returns, while finer chunk refresh can remain asynchronous.
- `js/core/scenario_resources.js` could still prefer startup topology for a full bundle when a chunk manifest existed.
- `js/core/scenario_manager.js` merged global modern `countryNames` into active scenario names, which could hide broken scenario naming data instead of surfacing it.

## Current Outcome

- `hoi4_1939` is rebuilt and back on the correct semantic track:
  - `feature_count = 22502`
  - `owner_count = 115`
  - `controller_count = 117`
  - `synthetic_owner_feature_count = 18`
  - `manual_rule_count = 94`
  - `CHI.feature_count = 1445`
- `tno_1962`, `hoi4_1936`, and `hoi4_1939` pass strict contract checks.
- `blank_base` and `modern_world` still fail strict contract because `runtime_topology.topo.json` is missing, but that gap already existed in the reference commit and is not introduced by this repair.
