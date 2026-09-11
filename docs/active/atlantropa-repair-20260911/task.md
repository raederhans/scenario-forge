# Task

## Current status
Spain/Cyprus continuation is complete locally. Final candidate-v2 restores independently aligned Balearics islands and Cyprus reclamation, including the omitted source land province14138. Canonical and dist synchronized with concurrent names/WIP preserved. Geometry, strict contracts, 15 targeted Python tests, final 14-operation perf probe and actual dist E2E passed. Existing UK water probes and landing copy test failures remain explicitly disclosed. See spain-cyprus-result.md for final evidence. No commit/push/deployment.

## Checklist
- [x] Round 1 coastline implementation and focused tests
- [x] Round 2 land connection implementation and focused tests
- [x] Round 3 conflict normalization and focused tests
- [x] Round 4 precision improvement and evidence
- [x] Generate TNO assets and validate relevant contracts
- [x] Focused localhost visual/runtime verification
- [x] Review scope and synchronize affected dist artifacts

## Final evidence
Candidate-v2 (generation log atlantropa-stage-v3.log) passed geometry/source-LOD/nonATL-invariance, strict staged scenario contracts, and all existing water geometry gates.26 scenario files adopted only after verifying canonical files still matched the original baseline.721 total features:172land/69shoal/480sea. Dedicated coastline449rings/2074parts, area delta.0027134, unchanged gates accepted.
43 focused Node tests and58 core Python tests passed; subsequent sea-reference/stage18test rerun passed. Development E2E1passed31.3s; dist E2E1passed18.8s. Catalog/health+18catalog tests passed.29dist files synchronized without unrelated WIP; actual dist manifest regenerated. Temporary tabs and ports8000/8001 stopped.

## Known limits
Original5120x2560donor resolution and affine mapping remain;0.0025degree simplification budget is not absolute coastline accuracy. CRO9largest hole retains an upstream source-vs-output contour difference without sufficient evidence to fill it. Existing water coverage gate retains.0324degreecoastal tolerance, so passing is not a proof of zero microscopic shoreline gaps. No arbitrary cross-country overlap policy was applied; strict source/identity reconciliation resolved the generated conflicts without the pending policy choice.

## Refinement continuation checklist
- [x] Verify candidate source footprints and ownership (Europe, Egypt/Levant)
- [x] Capture frozen-app baseline startup/pan/zoom/edit/undo evidence
- [x] Enable proven candidates and rebuild isolated assets
- [x] Validate geometry, coast and scene contracts; evaluate TNO budget changes
- [x] Compare candidate runtime burden; adopt validated data and scoped dist

## Spain/Cyprus continuation checklist
- [x] Recover omitted island sources and independent original-core alignment
- [x] Trace Cyprus holes to raw province14138 and add regression probes
- [x] Rebuild final topology, coast, sea, chunks and startup assets
- [x] Validate contracts, non-ATL invariance and scoped water coverage
- [x] Measure final startup, native pan/zoom and edit/undo behavior
- [x] Preserve concurrent names, adopt guarded canonical/dist and test actual dist
- [x] Update catalog, record inherited failures and final report
