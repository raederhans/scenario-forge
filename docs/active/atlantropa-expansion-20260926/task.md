# Status

Integration update: current-main `a5eed904` rebuild and acceptance complete in `codex/atlantropa-expansion-20260926`. 82 scoped unit/regression tests, both browser cases, full water/geometry/assignment/strict contracts and data health pass. 192 current-main political chunks and mesh pack preserve bytes; no current-main locale change. Ready for protected-branch PR checks and merge; original implementation evidence below remains historical. Remote status follows the PR receipt.

- [x] Step 1: source inventory and candidate classification (4,655 region/province rows, 3,002 unique source provinces; eight registered AOIs plus explicit Black Sea non-spatial index).
- [x] Step 2: Turkey/Marmara geometry, water and strict scenario acceptance (turkey-v2, with all original political LOD restored before the next stage).
- [x] Step 3: North Africa/western interfaces inventory and acceptance; Constantine admitted, ambiguous Oran/Benghasi/templates documented and deferred.
- [x] Final checks, guarded adoption and result documentation. Final-v2 is adopted to canonical TNO locally; no commit, push or deployment.

Baseline: canonical 725 ATL features, 163 land / 69 shoal / 493 water. Historical September 11 results are context, not current validation.

Inventory output: `.runtime/tmp/atlantropa-expansion-20260926/inventory/source_inventory.{json,txt}`. `unresolved` is a review queue, not a confirmed missing-land count. Initial admissions: trial Marmara 9038/18349 with named-water clipping; later Constantine 9070/18332 with IAL coastal evidence. Oran spans IBR/ALC and remains unresolved. Original covered/template/seam cases retain their reasons.

Final inventory rerun: `inventory-final/source_inventory.{json,txt}` under the same runtime root. Final ATL: 730 features, 165 land / 70 shoal / 495 water. Source/chunk/baseline geometry, full water, coastline acceptance, old assignment preservation and strict scenario contracts pass. All 192 political chunks remain byte-identical; 78 existing helper identities preserved.

Verification complete: 19 source-inventory/rebuild unit tests; coastline browser test; native hit/fill/undo on both additions; catalog regenerated (666 entries, no content delta); data health PASS with 0 errors and 10 report-only large-file warnings; 19 catalog contract tests PASS. Canonical files match final candidate bytes. Root-owned preview server and test processes are stopped. See [results.md](results.md).
