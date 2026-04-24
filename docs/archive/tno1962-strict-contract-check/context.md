# tno_1962 Strict Contract Check Context

## Findings
- The strict check reproduces locally with the same capital hints and runtime topology id-set errors.
- `runtime_topology.topo.json` and published chunk ids match exactly at 13208 political ids.
- `manifest.summary.feature_count` is 12811, which equals runtime ids minus the allowed 397 `RU_ARCTIC_FB_*` runtime-only ids.
- `owners/controllers/cores` currently have 12802 ids. They contain 55 stale Atlantropa ids missing from runtime and omit 64 current Atlantropa ids present in runtime.
- `.runtime/tmp/tno_ocean_rebuild_from_countries_20260423` contains generated feature maps with 12811 ids and no runtime id mismatch against the checked-in runtime topology.
- `tno_1962` is listed in `SCENARIO_IDS_WITHOUT_PUBLIC_CAPITAL_HINTS`, so checked-in `manifest.capital_hints_url` is stale and should be removed.

## Decision
- Use the matching generated checkpoint only as the assignment source for the 64 current Atlantropa ids missing from feature maps.
- Preserve existing non-stale feature-map assignments; remove the 55 Atlantropa ids that no longer exist in runtime topology.
- Recompute country feature counts only for the affected owner/controller tags: `ATL`, `CRO`, `FRA`, `GRE`, `ITA`, and `TUR`.
- Keep the checked-in runtime topology and chunk assets unchanged because they already match each other.
- Remove `capital_hints_url` from `manifest.json`.

## Verification
- Feature maps now each contain 12811 ids.
- Feature maps have zero ids missing from runtime topology.
- Runtime topology has zero illegal non-`RU_ARCTIC_FB_*` ids absent from feature maps.
- Strict contract check now returns `[scenario-contract] OK tno_1962`.
