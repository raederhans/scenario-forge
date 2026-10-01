# Context

Root is sole Git integration, canonical data build and browser server owner. Workdir C:/Users/raede/.codex/worktrees/scenario-geometry-repair/mapcreator. Primary C:/Users/raede/Desktop/dev/mapcreator has unrelated country-label/UI WIP; do not reset, stash or mix it.

canada_fix owns tools/scenario_chunk_assets.py and related tests, no data writes. geometry_fix owns new tools/repair_scenario_geography.py and its tests, no canonical data writes. Other files belong to root. All one-off outputs under .runtime/.

Evidence: GF_PRIMARY absent TNO/blank topology and owners but present shared runtime and HOI1936/39. Sanaag/Sool partial in TNO/blank and complete in shared runtime/HOI1936/39. Kashmir India ADM2 record IN_ADM2_76128533B2782141712775 overlaps PAK-1111 by 63764 km2 and PAK-1109 by11672 km2 across blank/HOI/TNO. Corrected diagnosis: the referenced CAN detail and full runtime also lacked shared NWT60N nodes; joint endpoint normalization is required in full, detail and coarse geometry to avoid spherical D3 path divergence.

Initial git fetch failed with connection reset; origin/main cached bfedc6b8. Retry based on network evidence before integration. Do not claim current remote until verified.

Existing materialization helper tools/materialize_polar_scenarios.py:refresh_scenario handles assignments, snapshots, chunks, bootstrap; reuse after bounded geometry changes. tools/rebuild_polar_assets.py offers exact geometry transplant, refresh_neighbors, and refresh_base_manifest. Build owner root; logs will live .runtime/tmp/scenario-geography-repair/. Record commands before long runs.

Root canonical build: python -B -u tools/rebuild_scenario_geography.py --geometry-only. Workdir this checkout; exclusive outputs shared runtime topology and five scenarios; log .runtime/tmp/scenario-geography-repair/geometry.log. Exit0 plus reports for all targets required before materialization; any error stops promotion sequence. GF assignment GY follows recorded source3583339918 states310/687. Remote main verified through gh API equals bfedc6b8 despite git fetch transport failure.

Geometry build exit0 across runtime+five scenarios. Root materialization command: python -B -u tools/rebuild_scenario_geography.py --materialize-only; exclusive scenario outputs and base manifest; log .runtime/tmp/scenario-geography-repair/materialize.log. Success all five completion markers+exit0, failure stops before publication.

Root QA server owner: MAPCREATOR_OPEN_BROWSER=0 python -B -u tools/dev_server.py --port 8008; workdir isolated checkout, bind127.0.0.1:8008. Log .runtime/tmp/scenario-geography-repair/server.log. Browser opens only after scenario materialization; stop owned process after QA. No other process/port touched.

Materialization completed five scenarios exit0. Root strict check: python -B -u tools/check_scenario_contracts.py --strict --report-path .runtime/reports/generated/scenario-geography-repair/contracts.json; log strict.log. Root separately owns hero/sample baseline refresh, catalog and Pages build after strict geometry inputs are stable. Git fetch succeeded using the already-enabled Windows system proxy as a per-command override; no Git/system settings changed.

All six strict scenario contracts passed. Hero/sample source refresh exit0; blank/TNO sample baselines refreshed without feature overrides. Root publication commands: python -B tools/build_data_catalog.py then python -B tools/build_pages_dist.py; output data catalog and isolated tracked dist, logs catalog.log/pages.log. Focused browser QA on root-owned8008 in parallel reads stable source data only.

Final local evidence: geometry/gap suites 10 passed; Canada/LOD/chunk suites 35 passed; ownership suite 10 passed; sample-project suite 20 passed. All six strict scenario contracts passed. Real-data maximum residual Kashmir overlap 2.102479761904582e-15 square degrees; Canada normalization idempotent. D3 mixed-LOD combinations covered by regression tests. Reviewer found no source blockers.

Pages/catalog suite ran83 tests with two failures within one sample-copy test due solely to CRLF in two source sample files. Normalized those source files to LF; affected test then passed. Data health passed with existing report-only large-file warnings. Pages output818.97 MiB. Browser screenshots canada/guiana/somalia/kashmir and strict-hit receipts retained under .runtime/browser/scenario-geography-repair. Owned browser tab closed and server PID28088 stopped after verification. Merge/push pending at commit time; PR receipt is authoritative.
