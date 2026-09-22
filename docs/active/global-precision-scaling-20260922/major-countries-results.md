# Major-country precision candidates

## Modern US v4: neighboring boundaries and version-bound project migration

Current complete Modern World candidate: `.runtime/reports/generated/us-county-national-v4/modern_world`. The earlier v3 sections below are historical evidence. Canonical data is unchanged.

`prepare_us_county_seams.py` applies an explicit display precedence policy: existing non-target neighbor polygons are fixed masks; only new US county overlap is removed. It does not determine sovereign or historical boundary authority and does not fill gaps. The source and unchanged-neighbor topology are both hash-bound. Original Census/CB measurements are retained under `upstream_source_report`, separate from updated display metrics.

- 41 neighboring features affected, 60 counties clipped, all 3,144 county IDs retained; joint US coverage valid.
- Removed union area: 0.044762809868779105 degree squared. Of the 41 neighbor features, 12 already overlapped the valid portion of the old US baseline; old-surface comparison remains incomplete because US_CNTY_09120 is invalid.
- The clipped source union has zero foreign overlap. Re-encoded runtime has 10 individual numeric residuals, largest 3.571666609925436e-15 degree squared. The disclosed numerical bound is 1e-12 degree squared; no buffering, snapping, or sliver deletion is used to meet it.
- Independent preservation check: all 10,804 non-US features have identical decoded geometry, properties, owners and cores; India remains 718. City/capital sidecars are byte-identical.
- Build: 94.531 seconds, peak working set 1,463,455,744 bytes. US detail gzip 9,950,470 bytes. These are local build measurements, not a browser performance claim.
- Strict scenario contracts PASS. Source/detail identity, valid coverage and arbitrary whole-shard mixed LOD gate PASS for 20 US shards.

Project migration now has an opt-in manifest contract with exact source and target baseline hashes. Staging fixes the previously stale baseline hash using the existing owner-map hash convention. Only 481 stable county identities are approved in Modern World. Eight removed aggregate zones and the invalid US_CNTY_09120 remain explicit review cases; positive area intersection alone never enables import migration. A project editing these unresolved IDs is rejected before current scene, colors, or history are modified.

The pure planner supports one-to-many paint/ownership transfer, requires all many-to-one contributors to supply the same explicit value, and rejects edited/default contributor conflicts. Special-zone and preset member sets can expand, while unit anchors and story focus require one unambiguous target. Special-zone fingerprints and subsequent exports bind to the new baseline. Historical v2/v3 preview files which used new IDs with the old hash are not silently assumed to be either baseline.

Validation: migration/roundtrip/transaction Node suites 68/68. The transaction suite reused the already-installed matching acorn8.17.0 from main through a `.runtime` loader; no dependency install or package changes. A real v4 manifest check confirmed 481 stable entries and rejection of all 9 unresolved IDs. Local browser smoke applied Modern World, painted/undid Twin Falls County at100% and Graham County at144%, loaded US detail shards with HTTP200, and restored Undo-disabled state. Owned preview log had no404/500. Evidence under `.runtime/browser/us-county-seams-v4/`; tab and server closed.

Relevant reports: `.runtime/tmp/us-county-upgrade/source-seams-v1/seam-report.json`, `.runtime/reports/generated/us-county-v4-preservation.json`, `us-county-contracts-v4.json`, `us-county-lod-v4.json`.

## Historical domain and sidecar adaptation v4

All six registered scenarios have candidate overlays under `.runtime/reports/generated/us-county-scenario-adaptation-v4/`. Modern counties are a subdivision grid, not historical boundary/name authority. Existing scenario domain, attributes, ownership, cores and explicit controller presence are preserved. Joint boundary noding/polygonization retains residual faces. Point-on-boundary ambiguities use complete-face area evidence, never largest-overlap/nearest assignment. Strictly repeated-point zero-extent old parts are audited separately; invalid polygons are not repaired.

| Scenario | Old US targets partitioned / inspected | New candidate pieces | Old targets retained unresolved |
| --- | ---: | ---: | ---: |
| Blank Map | 489 / 490 | 2,903 | 1 |
| HGO 1936 | 748 / 748 | 6,732 | 0 |
| HOI4 1936 | 911 / 914 | 10,051 | 3 |
| HOI4 1939 | 911 / 914 | 10,051 | 3 |
| Modern World, historical-domain alternative | 489 / 490 | 2,903 | 1 |
| TNO 1962 | 948 / 950 | 10,129 | 2 |

These piece counts are not counts of real-world counties. They include county intersections and retained historical residuals. Modern World's complete national-v4 bundle uses its separate 3,144-county source and is not replaced by the domain-preserving alternative above.

Every emitted piece is valid and has a unique ID. Parent audit independently confirmed exact inheritance of each explicit owner/core/controller value (and absence) for all six outputs. Largest measured per-old-domain symmetric difference is 1.566091711673176e-14 degree squared and Hausdorff distance 2.842170943040401e-14 degrees; disclosed acceptance bounds are 1e-12 area and 1e-10 distance. The bounds do not remove or alter geometry. TNO Wayne/Erie children and all included historical cuts preserve their original domains. HGO domains are exactly equal with zero measured difference.

Remaining old-geometry exceptions are explicit:

- Blank/Modern domain alternative: US_CNTY_09120 ring self-intersection.
- HOI4: US_ZN_26_014__R topology side-location conflict, plus the two Iowa/Illinois IDs below.
- HOI4 and TNO: US_ZN_19_007__R / US_ZN_17_004__R share a thin-face problem, approximately7.1155e-11 degree squared and0.00077505-degree Hausdorff drift. Iowa loses a thin part; Illinois gains one. Adding Iowa's complete missing surface restores measured area but not the distance gate, so this experiment was not retained. These old IDs remain untouched.

Known sidecar plans are in `.runtime/reports/generated/us-county-scenario-sidecars-v1/`. All six pass their supported-reference checks with zero unresolved references. Crosswalks include every retained old ID as identity and partitioned old IDs as their explicit children. Output is restricted to new `.runtime` directories and bound to the actual source, baseline, overlay and adaptation report. Unsupported or ambiguous references suppress the entire affected file.

- HOI4 bucket_by_feature memberships expand; buckets, metrics and resource_points remain identical. Each year remaps40 victory-point host IDs using unique coordinate coverage. Counts remain1500/1501; every other victory-point field is identical.
- City/capital host references use existing coordinates and unique child coverage; no guessed hosts.
- TNO96 old US geo_locale entries inherit the same historical en/zh labels. Total labels4421→5025, verified against the crosswalk. No modern county names are substituted.
- Parent evidence: `us-county-adaptation-v4-assignment-audit.json`, `us-county-sidecar-preservation.json`, and the sidecar summary/report files.

Final targeted checks across these tools:46 Python tests +4 subtests,68 Node migration/roundtrip/transaction tests, real modern strict contracts and20-shard LOD gate, plus focused modern browser fill/undo. Historical outputs remain patches and sidecar plans: full runtime topology, hierarchy, adjacency, metadata, chunks, final baseline hashes and integrated historical import/save/export/browser gates are still required. All release_ready fields remain false; no canonical/remote publication.

## Modern US national candidate: shard-safe LOD continuation

The current Modern World candidate is `.runtime/reports/generated/us-county-national-v3/modern_world`, superseding national-v2 for further data acceptance. It preserves all 3,144 US counties and India's existing 718 features. It remains separate from historical TNO/HOI4 candidates below and `release_ready:false`.

A new exact shard-domain gate reproduced a real issue in v2: all 20 US detail shards had different coarse/detail unions (individual differences 0.0023–0.0283 degree squared), even though the whole coarse and detail coverages were valid. Preserving owner borders alone is insufficient when separate shards of one owner can load independently.

The builder now computes the actual detail partition once before coarse generation, preserves each shard's outer boundary during shared precision simplification, and reuses that exact partition for detail output. Reusable chunk membership is checked per shard, not only across an entire owner. Simplification remains enabled on internal edges within each shard; full detail geometry is unchanged.

Validation is reproducible with:

```powershell
python tools/validate_us_county_lod.py --candidate-dir .runtime/reports/generated/us-county-national-v3/modern_world --county-source .runtime/tmp/us-county-upgrade/source-national-verified/counties.geojson --output .runtime/reports/generated/us-county-lod-after.json
```

The result is PASS for 20/20 shards with exactly zero domain difference, complete source/coarse/detail county membership, valid coverage and source/detail geometric equality. These invariants prove arbitrary combinations of whole shards preserve the county footprint and introduce no area overlap; this is not a claim that every combination was individually rendered, nor a guarantee for arbitrary single-feature replacements. Foreign boundaries remain outside this gate.

Strict scenario contracts also pass. `.runtime/reports/generated/us-county-v3-preservation.json` confirms byte-identical runtime/bootstrap topology, owner/core maps, city/capital sidecars, and every detail chunk versus v2. All non-US coarse features including India are identical. Only the political coarse chunk changed: gzip 9,251,657 -> 9,429,485 bytes (+1.9%). Build elapsed 112.328 seconds, peak working set 1,458,216,960 bytes.

Final targeted Python verification: 32 tests plus 539 subtests for the builder, partition/display/explicit precision paths; 6 additional validator tests. Regressions demonstrate old whole-owner union checks miss a changed shard edge, verify safe intra-shard simplification, and reject reordered reused shard membership, incomplete IDs, altered source/detail domains, overlap and stale chunk bytes. The earlier CLI claim that the fix was implemented was rejected after direct diff inspection; parent completed the actual builder and tests.

Remaining gates: 41 foreign-overlap findings, unresolved legacy `US_CNTY_09120` geometry/crosswalk, saved-project split/merge migration, historical cuts and wider device/visual testing. No canonical data or remote state has been published.

## Continuation results (supersedes the all-blocked CN/IN/US inventory below)

The accepted combined artifact is `.runtime/reports/generated/precision-combined-v3/`: 367 selected IDs (JP 47, CN 254, IN 13, US 53), 9,387 -> 33,450 selected coordinates, zero selected surface/owner-domain drift and all 42 mixed-LOD checks passed. All 208 chunks retain complete global ID membership; gzip chunk bytes rise by 898,324 B. Status remains `invariants_pass_visual_review_required`, with no canonical replacement. Full build elapsed 204.281 s; peak working set 2,399,203,328 B.

The v9 per-country geometry evidence remains valid, but its country-wide precision metadata was superseded. v2 combined staging exposed `owner union mismatch for BRM`; the shared assembler now records explicit selected `political_precision_feature_ids`, preserving baseline country flags instead of expanding them. v3 corrects only this metadata on the coordinate-verified composition before rebuilding all assets. The final 22 regional/major-country/explicit-LOD tests passed. Fresh partial candidates generated by the command below use the corrected metadata.

Corrected browser routing explicitly served `/app/data/scenarios/tno_1962/` from v3. After fixing a startup layout/first-frame race, the app reached ready with an accepted first frame and empty boot error. A temporary family using the real staged Japan payload transitioned from regional to committed detail: 47 JPN IDs, 12,428 coordinates, no pending promotion. Earlier continuation browser runs used canonical assets because the preview route omitted `/app/`; they do not prove staged data acceptance. This later run supersedes those claims.

The continuation generated explicit, bounded partial candidates in `.runtime/reports/generated/major-country-precision-v9/`. Existing ambiguous/overlapping features remain geometrically unchanged. The inventory is a partial upgrade, not a whole-country coverage PASS.

| Country | Selected targets / actual geometric changes | Selected coordinates before -> after | Estimated compact selected detail bytes | Geographic targets preserved |
| --- | ---: | ---: | ---: | ---: |
| China | 254 / 252 | 5,587 -> 13,399 | 560,468 | 2,137 |
| India | 13 / 12 | 270 -> 1,802 | 57,191 | 705 |
| USA | 53 / 53 | 1,329 -> 5,821 | 230,330 | 897 |

Each candidate includes `<country>.target-ids.json`; use this exact list with `validate_tno_precision_expansion.py --target-feature-ids`, rather than selecting by mutable allegiance or the full geographic inventory. `fresh-verification.json` verifies all 12,022 properties unchanged, every non-target geometry `equals_exact(..., 0)`, and zero selected-union/owner-domain surface differences. The 17 major-country/regional target tests passed. India source bytes were found in the main checkout and matched both ledger and provenance SHA256; the explicit `--source IN=...` option neither downloads nor copies data. Its ledger still says `pending_upgrade_review` and has an empty license field; no approval was fabricated.

China's cross-owner/foreign overlaps are frozen. A failed owner partition may freeze that owner's overlapping participants and attempt its clean remainder once; source-nearest overlap allocation is rejected. US partial mode admits only exact county IDs and freezes missing zone/split lineage. These outputs preserve the broad goals' unresolved portions rather than guessing allocations.

Japan remains the 47-ID pilot. A full repeat stage with the memory optimization produced identical JSON assets and passed the strengthened validator, while measured build peak memory fell from 17.40 GB to 2.39 GB. Combined four-country staging is owned by the parent and recorded in `context.md`.

Reproduce partial candidates with a fresh output path:

```powershell
python -X utf8 tools/prepare_tno_major_country_precision.py --countries CN IN US --preserve-baseline-overlaps --preserve-unresolved-lineage --source IN=C:/Users/raede/Desktop/dev/mapcreator/data/geoBoundaries-IND-ADM2.geojson --output-root .runtime/reports/generated/major-country-precision-next
```

The new offline tool is `tools/prepare_tno_major_country_precision.py`. It writes only to a new explicit output root and never changes canonical scenario assets. No new cached source or runtime entry point is introduced, so no data catalog regeneration is needed for this lane.

## Contracts

- Geographic target membership is derived from stable source/ID families as well as current scenario allegiance, so reassigned TNO features are not dropped merely because mutable `cntr_code` changed. Source country, stable IDs and explicit lineage are checked before geometry work. Missing input never triggers a download or a fallback to a lower-resolution dataset.
- Existing Russia `constrained_partition` freezes each scenario-owner domain; `coverage_simplify(..., simplify_boundary=False)` changes only its internal boundaries. Existing regional assembly preserves authoritative metadata, auxiliary surfaces and untouched adjacency.
- Surface conservation is checked separately from `coverage_is_valid`: a valid coverage may still have holes. The accepted aggregate difference is at most `1e-10` square degrees, and owner-domain constraints are also checked.
- Controller/core/manual-override sidecars are not rewritten. Baseline IDs and properties, including split-child metadata, remain authoritative. Reuse of a source member across multiple children fails closed until reviewed cut geometry is supplied through a separately reviewed migration.
- The report estimates actual owner-bucket feature partitioning with the existing 2 MiB / 100,000 path-cost chunk limits. Oversized indivisible features fail the candidate budget.
- The candidate is always `release_ready: false`; a full absolute topology file is a review artifact and its size is not the detail-transfer cost.

## Fresh real-data results

Command (final inventory/report version):

```powershell
python -X utf8 tools/prepare_tno_major_country_precision.py --countries JP CN IN US --output-root .runtime/reports/generated/major-country-precision-v4
```

| Country | Result | Evidence / next gate |
| --- | --- | --- |
| Japan | Candidate generated | 47 IDs; 2,201 baseline coordinates to 12,428 candidate coordinates; 488,855 estimated compact detail bytes, one JAP chunk; exact zero surface difference; no cross-boundary adjacency changes. |
| China | Blocked by existing owner-domain overlap | 2,391 stable `CN_CITY_` targets, including 50 currently reassigned away from mutable `cntr_code`; 2,391 cached source features. Frozen domains overlap between `CN_CITY_17275852B10208475755367` and `CN_CITY_17275852B54632216874023`, area `0.00034245336162656766` square degrees, bounds `[120.19980199802, 37.112112924129235, 120.23580235802359, 37.14509385293853]`. Requires explicit reviewed allocation repair before replacement. |
| India | Blocked by missing cached source | 718 stable `IN_ADM2_` targets, including 26 reassigned records; `data/geoBoundaries-IND-ADM2.geojson` is absent in this worktree. Supply the governed source and provenance, then rerun; the tool does not fetch implicitly. |
| USA | Blocked by unresolved lineage | 950 stable `US_` targets, including 5 reassigned records. 470 target source IDs cannot map directly to Census county IDs, including `US_ZN_*`, `__R` and `__tno1962_*` children. Zone membership and historical split cuts must be reconstructed from authoritative build lineage, not guessed by proximity. |

Japan's coastline remains the accepted baseline coastline. This pilot upgrades internal prefecture edges; it does not claim new coast precision. China similarly requires preserving political owner allocation before any geometry upgrade.

The first diagnostic attempt using regional alignment alone changed the JP/CN surface by 0.3314/2.4231 square degrees and was rejected. Reusing the Russia frozen-domain partition resolves this for Japan without widening the surface tolerance. A later independent review found that the first candidate pass selected targets only by mutable `cntr_code`; the v1-v3 multi-country inventories are superseded. The corrected v4 selector includes reassigned stable geographic IDs. Japan's corrected v4 candidate is byte-identical to the reviewed v3 Japan candidate (`SHA256 4BE26BB90A406B4258F1D1A0F70124FA920C04B86CCD144A14DA6F6246A297C7`), so the completed Japan stage remains valid; China's corrected target set exposes the overlap reported above instead of silently reassigning it.

## Japan staged integration evidence

The isolated full-stage build completed with 208 chunks and no stderr. Chunk JSON grew from 354,652,111 to 356,138,325 bytes; gzip chunk total grew by 354,023 bytes. Peak builder working set was about 17.4 GB, so this is an offline build result rather than evidence of acceptable client memory. `tools/validate_tno_precision_expansion.py` returned `invariants_pass_visual_review_required`: all 47 stable IDs were present, coordinate count rose from 2,201 to 12,428, the changed chunks were `political.coarse.r0c0` and `political.detail.country.jap`, and all four mixed-LOD checks passed.

A quick-mode localhost browser smoke routed TNO requests to the staged output without touching canonical assets. `political.detail.country.jap.json` returned HTTP 200; runtime state loaded 109 owner-bucket features including all 47 unique `JPN-*` target IDs. The page recorded zero console errors, zero warnings and no failed request. This proves staged manifest/chunk/runtime loading and rendering, but it is not a target-device FPS or heap benchmark.

## Verification

`python -X utf8 -m unittest tests.test_tno_major_country_precision` passes ten targeted tests. The final suite covers stable mapping/order, reassigned CN/MAN, IN/PAK and US/JAP membership, foreign-country leakage, missing/duplicate/split lineage, gap and overlap gates, byte/coordinate budgets, missing-source fail-closed, output path protection, metadata preservation, and frozen owner allocation (some assertions share a test). Combined with the East-Europe audit suite, 19 tests pass.

Generated candidate review, browser integration and canonical data regeneration belong to the integrating owner. Outputs are restricted to a fresh path under repository `.runtime`. The tool intentionally reports blockers with exit status 2 when any selected country is blocked; consumers must not interpret an existing report as a releasable candidate.
