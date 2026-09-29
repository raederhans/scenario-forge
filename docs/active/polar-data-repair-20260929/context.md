# Context

Workspace: C:/Users/raede/.codex/worktrees/polar-data-repair/mapcreator
Branch: codex/polar-data-repair
Baseline: 20bc0f6a (origin/main at creation)
Primary checkout is dirty main@28310add; no changes there belong to this task.

Evidence: original RU ADM2 Taymyr shapeID 50074027B66849950652275 reaches 81.27464N; na_v2/runtime/TNO same feature reaches 72.997N. Five rayons share this cutoff. Historical latitude crop introduced by 9b79a850 and removed by 3539a706. Old .bak/highres administrative geometry remains cropped, northern shell fallbacks draw but are noninteractive. Current source/highres RU shell intersection reaches81.2731N, so current intersection alone is not a proven ongoing cause. NO islands absent from shared runtime/HOI/TNO but restored in modern_world.

Root is the sole owner for canonical data generation, promotion, scenario materialization and browser server. Logs under .runtime/tmp/polar-data-repair/. Commands/resources will be recorded before execution. Water worker may run isolated target tests and owns only water compiler/tests; no canonical data writes. polar_build agent remains read-only.

## Root canonical geometry build
Owner: root. Workdir: this isolated worktree.
Command: py -3 -B tools/rebuild_polar_assets.py --geometry-only --candidate-dir .runtime/tmp/arctic-recovery-worker
Output: canonical political topology in detail/runtime and five scenarios; no water objects touched except lossless arc reindexing. Worker water outputs will be composed by object afterward.
Log: .runtime/tmp/polar-data-repair/geometry-build.log
Success: exit 0, seven report files. Failure: nonzero stops further materialization, fix recorded cause first.

Geometry build finished all seven targets; reports in .runtime/reports/generated/polar-repair/. Arctic worker real na_v2/runtime/TNO candidates all idempotent; root ownerless additions subtract both old coverage and earlier new additions.

## Root scenario materialization
Owner: root. Command: py -3 -B tools/rebuild_polar_assets.py --materialize-only
Workdir: isolated worktree. Resources: five canonical scenario directories and data/manifest.json. No concurrent canonical writers.
Log: .runtime/tmp/polar-data-repair/materialize.log
Success: exit 0 and all five scenario completion markers; failure stops, investigate exact first exception. Water worker precision-only stage remains isolated, TNO water graft must finish before TNO materialization starts.

## Root focused browser server
Owner root. Command: MAPCREATOR_OPEN_BROWSER=0 py -3 -B -u tools/dev_server.py --port 8008
Workdir isolated worktree; bind127.0.0.1:8008; log .runtime/tmp/polar-data-repair/server.log.
Purpose focused polar QA, at most5 screenshots; use in-app browser. Stop owned server after QA, no other server touched.

Ownership handoff: water_repair was pending_init and has been interrupted. Root verified no live rebuild_water_geometry Python process. Root now owns precision-only staging and promotion.
Command: py -3 -B -u -m tools.rebuild_water_geometry --stage-root .runtime/tmp/water-repair-worker/precision-only --repair-precision-only
Log: .runtime/tmp/water-repair-worker/precision-only.log. Inputs are stable canonical geometry; outputs isolated. Success exit0 with outputs.json and unchanged other165 water features; no broader refine-marine output will be promoted.

Water precision-only stage completed and verified: only Bosporus geometry changed, other165 water features identical. Root promoted two files after verifying input SHA identity; original political geometry retained by worker decoder proof. Full materialize exit0. Final metadata sync command below uses rebuild_chunk_assets=False except TNO, whose water chunks require rebuild after precision repair.
Command: py -3 -B -u .runtime/tmp/polar-data-repair/finalize.py
Log: .runtime/tmp/polar-data-repair/finalize.log. Owner root, canonical writes serial. Finish when all5 scenarios complete; no repeated geometry builds.

Final acceptance: all six strict scenario contracts pass; data catalog 19/19, water runtime 11/11, renderer policy/owners 58/58, real polar geography contract pass. Blank Antarctica needed a frontend visibility-policy repair; fresh browser canvas click hit AQ_AAT_WEST (strict, no snap), GL hit GL, TNO Taymyr and Svalbard passed. Browser warnings/errors empty. See result.md. QA server and tabs are task-owned and will be closed after acceptance.
