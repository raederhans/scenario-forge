# Validation Baseline

## Historical Reference

- Reference commit: `14e763939363c86cfedac289c37f6288533597d9`
- Historical 1939 semantic gold:
  - `owner_count = 115`
  - `controller_count = 117`
  - `synthetic_owner_feature_count = 18`
  - `CHI.feature_count = 1445`
  - featured tags must still include `SOV`, `RAJ`, `YUG`, `MAN`, `SIK`
  - owner rules must include both `data/scenario-rules/hoi4_1936.manual.json` and `data/scenario-rules/hoi4_1939.manual.json`

## Current Accepted Repo Baseline

- After restoring the 1939 builder chain in the current repo:
  - `feature_count = 22502`
  - `owner_count = 115`
  - `controller_count = 117`
  - `synthetic_owner_feature_count = 18`
  - `manual_rule_count = 94`
  - `CHI.feature_count = 1445`
- `manual_rule_count` is intentionally higher than the historical reference because the current shared `hoi4_1936.manual.json` base pack has grown since the reference commit.
- `feature_count = 22502` is the current runtime-topology baseline for this repo and is now the number enforced by `hoi4_1939.expectation.json`.

## Shared Runtime Checks

- Startup worker must run whenever `topologyPrimary`, `locales`, or `geoAliases` is missing.
- `bundleLevel = "full"` must prefer `manifest.runtime_topology_url`.
- Scenario apply must not block the first visible frame on coarse chunk prewarm.
- Active scenario country names must come from the scenario pack only, without silently merging global modern names.

## Light Cross-Scenario Check

- `tno_1962`: strict contract passes.
- `hoi4_1936`: strict contract passes.
- `hoi4_1939`: strict contract and HOI4 domain checker pass.
- `blank_base` and `modern_world`: strict contract still reports missing `runtime_topology.topo.json`, and this was already true in the reference commit, so it is tracked as a pre-existing gap rather than a regression from this fix.
