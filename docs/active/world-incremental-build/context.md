# Context

## Current truth
Working on main with previous France implementation WIP, preserved. France is locally promoted. User now explicitly authorizes the DE/BE/NL TNO replacement pilot (485 same IDs), using visually insignificant error tolerance. `.playwright-mcp/` is unrelated untracked WIP.

DE/BE/NL rollout completed; evidence and full pre-trial TNO backup: `.runtime/tmp/de-benelux/`. Source is official GISCO NUTS 2021 01M, EPSG:3035 converted to 4326; combined coverage valid. All agents and builds finished. Antigravity task e3b6d20a48924bb185df62d3fc172972 completed on attempt 2. First candidate failure was fixed by collecting polygon boundaries from mixed overlay GeometryCollections. Official runtime/chunks match the accepted candidate, strict and startup checks pass. Fresh browser context confirms 485 upgraded geometries, all three countries' fill/undo, and visual checks. Old-page reload did not navigate; exclude after.png/after-perf.json and use after-verified artifacts. See latest task.md entry for performance and prior-France-browser evidence limitation.

## Decisions and deviations
- Cache delegate owns base_stage, build_dependencies, detail/runtime stage files, signature portion of scenario_rebuild_planner, own new tests.
- Planner delegate owns regional_rebuild_plan, plan_regional_rebuild CLI and own new tests.
- Geometry delegate owns regional_geometry, build_regional_topology CLI and own tests.
- Antigravity registry worker owns only regional_processors and its test module; separate no-tools reviewer supplies adversarial cases.
- Root owns scenario chunk incremental integration and overarching CLI/docs. Baseline and candidate must be distinct; historical scenario inputs are explicit.

## Live process ownership
Root owns CLI processes 47302 (registry implementation) and 84960 (read-only contract review); logs `.runtime/tmp/world-incremental/agy-*.json`. No build/server active at record creation.

## Handoff
Draft cache/planner returned quickly but required follow-ups: output-directory false cache hit, missing actual source dependencies, duplicate ID handling, metadata changes, semantic geometry equality, path checks. Do not accept prior draft summaries without those fixes.

## Next step
France local rollout is complete (see latest task.md entry). Future country replacements should reuse the candidate/incremental pipeline and scenario-specific validation. No automatic worldwide promotion is implied.

Latest 2026-09-13 runtime ownership: root dev server PID 34696, port 8000, verified live HTTP; retained for user preview. France official rollout evidence is under `.runtime/tmp/france-rollout/`; full pre-rollout backup is its `baseline` directory. Earlier process and candidate status notes below are historical. Browser test edits were undone and page reloaded; preview is centered on France. No remote deployment.

France pilot: root owns all candidate/build processes. Command: py -u tools/pilot_tno_france_precision.py --master data/europe_topology.na_v2.json --scenario-dir data/scenarios/tno_1962 --output .runtime/tmp/france-pilot/runtime-candidate.topo.json. Cwd repo root. Output/logs .runtime/tmp/france-pilot. No ports. Success: candidate and protected-object identity checks pass; on any failure stop and inspect. Delegates read-only.

France pilot completed in isolation. prepare exit 0, scenario assets exit 0, 33 target tests passed. 16 mixed LODs and 189 chunk integrity checks passed. Verdict .runtime/tmp/france-pilot/pilot-verdict.json: promotion blocked by 9 cross-country adjacency changes and new TNO water/Atlantropa intersections. All nonpolitical objects retained; Corsica five remain excluded. No production/data/dist changes; no server or browser process. Next work is geometry coordination, not copying candidate into production. All owned runs ended.

2026-09-13 France reconciliation active: root owns pilot integration and candidate builds under .runtime/tmp/france-reconcile. geometry_sources owns regional_boundary_alignment + tests; render_layers owns scenario_surface_constraints + tests; precision_encoding owns temporary independent acceptance script. Antigravity adapter task b1e1c11c51eb46d9ad7473a2ed44db04 resumed after write_to_file ArtifactMetadata=null failure; second read-only task f1669d8d59744d05bf4ab9f4299d5e55 dispatched with newly concurrent adapter. No task success accepted from exit code alone. Plan: high precision interior, explicit baseline-only outer coverage alignment, forbid new protected/foreign overlap. All production data untouched.

France reconciliation implementation complete in isolated candidate: shared planar subdivision in alignment and protected-surface clipping; exact existing-segment/shared-chain TopoJSON encoder avoids reproduced lost-coordinate coverage defect. 49 target tests passed. Full candidate and regional scenario build succeeded. 189 chunks passed integrity, all 16 mixed owner LOD combinations passed, vendor D3 gap probe now hits FR_ARR_45002 in detail/coarse; 5 changed chunks and 184 byte-identical, uniformly gzipped all chunks +10.0723%. Cross-country graph equals baseline after actual recompute (not copied). Six auxiliary objects and non-FR decoded geometry unchanged. Coast numeric investigation: original area test 1.7103e-10 >1e-10 remains false; all residual within 1e-9deg of published shore (0.111mm bound), explicitly accepted as pilot linear numeric tolerance, not mathematical zero. No geometry buffer/visual fallback applied. Candidate release_ready remains false pending startup/bootstrap/bundles, fingerprint/audit and real App browser/performance checks. Antigravity two tasks/five attempts: corrected border diagnosis completed and root reran; review returned partial findings but provider INTERNAL500 twice; all adapter tasks ended.
