# Task

## Status

- [x] Source gap diagnosed; feature branch created.
- [x] Canonical generator closure and focused regression tests.
- [x] Whole-basin validator coverage and focused tests.
- [x] Scoped data regeneration with existing identity preservation.
- [x] Geometry, scenario contract and catalog checks.
- [x] Browser visual check.
- [x] Distribution checks, final provenance counts and closeout.

## Evidence

- Before: all three Ionian probes failed and the old validator omitted Atlantropa.
- After: 16 targeted tests plus 3 subtests passed; 18 catalog tests passed; data health completed with existing report-only size warnings.
- Full water geometry report passed: standalone, coarse and detail have zero uncovered interior after existing coastal guard; all probes and IDs present, D3 geometry valid. Strict scenario contracts passed after adding the new synthetic feature to required maps and derived counts.
- Existing 897 Atlantropa features, all prior runtime objects/arcs and bathymetry geometries/arcs, and 186 other chunk entries compared unchanged.
- Browser: pan, 348%/500% zoom, fill #871818, undo #203856; all three probes remain covered. No warn/error logs. Evidence in `.runtime/browser/med-sea-closure/`.
- Work remains local on `codex/tno-mediterranean-sea-closure`; no commit, merge, push or deployment. Concurrent place-name edits are preserved and excluded from this sea-fix ownership.
- Distribution: canonical manifest finalization, required-file/URL validation and size gate passed; 9 directly published repaired artifacts matched their source bytes. All 63 Pages startup-shell tests passed. Bathymetry provenance counts and its published copy were then synchronized (94 bands, 77 contours).

No remaining implementation work. Whole-water inspection is geometric validation plus focused browser probes, not an exhaustive visual inspection of every sea or a new performance benchmark.
