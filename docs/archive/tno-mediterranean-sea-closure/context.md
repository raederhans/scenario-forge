# Context

## Current truth

Branch `codex/tno-mediterranean-sea-closure`, starting from clean main `24169584`. The eight sea-completion bounding boxes leave a 13.68846423 square-degree central Mediterranean gap. Source and chunk IDs agree; source geometry itself is absent. The existing ordinary-water validator passes because it does not check Atlantropa coverage.

## Ownership and decisions

- Main owns generated data, integration, Git, browser and all shared live processes.
- `med_sea_generator` owns the canonical generator and its focused tests.
- `med_sea_validator` owns the water validator and its focused tests.
- Existing server on localhost:8000 (PID 25500) remains running. User preview is preserved; browser checks use a separate page.
- Use a scoped artifact refresh invoking the canonical completion helper, preserving existing feature objects. Avoid the full donor rebuild because it could replace reviewed place names and unrelated geography.

## Live processes

- Main owns `py -3 .runtime/tmp/med_sea_closure_dryrun.py`, log `.runtime/tmp/med_sea_closure_dryrun.log`. Its first attempts found a temporary-script feature-shape error and an invalid baseline polygon; the script now uses the canonical normalization and cached baseline geometry. No source assets changed in these attempts.
- Main owns `py -3 .runtime/tmp/repair_med_sea_assets.py`, log `.runtime/tmp/repair_med_sea_assets.log`; resources are TNO assets and the scenario build session lock. Stop on any failed assertion; success requires all existing feature objects and protected name/owner/water files unchanged.
- Main owns subsequent `py -3 tools/validate_tno_water_geometries.py --report-path .runtime/reports/generated/med-sea-water-validation.json` and strict scenario contracts; logs under `.runtime/tmp/med-sea-*.log`. No agent starts or monitors them.

Parallel place-name work appeared in the checkout after branch creation. Preserve its source, dictionaries and city artifacts. New startup/snapshot artifacts consume the current names without rebuilding or overwriting them.

The legacy med_open_basin extends south of the actual Atlantropa construction envelope into the Red Sea. Scope completion and its coverage check to the explicit envelope derived from existing AOIs (-6.8,27.8,37.1,46.4); retain the whole interior, including the omitted Ionian region.

## Next step

Implementation complete; review local branch changes. No merge/push is part of this repair request. Records can be archived.

## Integration and verification

- Geometry trial succeeded: one feature, 23 polygon parts, 12.7509234882 square degrees after land exclusions; no land/ordinary-water/old-sea overlap. Whole-domain residual interior becomes zero.
- `.runtime/tmp/repair_med_sea_assets.py` appended the sea and refreshed chunks. Published feature properties omit `region_id`, so rebuilding all bathymetry from those properties skipped old bands. `.runtime/tmp/finish_med_sea_assets.py` corrected this by appending only the four new bands and three contours to the preserved original quantized topology; all old geometry objects and arcs were independently compared and are unchanged.
- Strict contracts required the new synthetic sea in owners/cores. `.runtime/tmp/register_med_sea_feature.py` added only that ATL assignment and updated derived counts. Every pre-existing assignment and country identity field is unchanged. No existing political ownership changed.
- `.runtime/tmp/finalize_med_sea_assets.py` uses the human-readable name Mediterranean Sea and refreshes startup, ledger, metadata and snapshot identities.
- Main ran 16 focused regression tests (plus 3 subtests), the full water geometry validator, strict scenario contracts, catalog health and 18 catalog tests successfully. Source, coarse and detail Mediterranean interiors all have zero holes. Exact old runtime objects/arcs, all old bathymetry and 186 non-Atlantropa chunk entries are unchanged.
- Independent localhost tab: drag, 348% and 500% zoom, red fill (#871818), undo to sea color (#203856) passed. Three Ionian probes matched pixels; Black Sea and Red Sea retained ordinary water. No warn/error logs. Test page closed, original tab retained. Evidence: `.runtime/browser/med-sea-closure/`.
- Pages build copied and validated assets but its final manifest write raised Windows OSError 22. File is an ordinary readable file, no builder remains active. Main owns narrow finalization via `tools.build_pages_dist.validate_required_dist_files`, `write_dist_manifest`, `enforce_dist_size`; log `.runtime/tmp/med-sea-pages-finalize.log`, followed by `py -3 -m unittest tests.test_pages_dist_startup_shell -q` log `.runtime/tmp/med-sea-pages-tests.log`. Avoid repeating completed asset copying.
- Narrow distribution finalization completed successfully. 63 startup-shell tests passed in 112.103 seconds. `.runtime/tmp/sync_med_bathymetry_provenance.py` then synchronized the provenance counts and its published copy and finalized the distribution manifest again; direct byte comparison passed. All owned processes have ended; the original preview server remains running.
