# Atlantropa four-stage repair

## Goal
Complete the four repairs authorized on 2026-09-11: coastline correctness, intended land connectivity, duplicate/land-water conflicts, and geometry precision. Preserve scenario ownership and designed islands/shallows.

## Scope and sources of truth
TNO Atlantropa builder, generated scenario assets, coastline runtime, and focused regression tests. Prior investigation in this conversation supplies hypotheses; current source and executable probes are authoritative.

## Stages and acceptance
1. Coastline: chunked TNO must not retain the old coast through reclaimed land; new external coast, visibility and invalidation work without weakening global safety gates.
2. Connectivity: explicitly joinable donor land connects to baseline land without closing intended straits or replacing designated islands/shallows.
3. Conflicts: deterministic final land overlap/sea exclusion rules, stable feature identities, preserved islands, and visible ownership ambiguity/component diagnostics.
4. Precision: evidence-based improvement of donor fitting/simplification, measured against existing geometry and control residuals; no blind global affine replacement or invention of scenario geography.
5. Integration: rebuild affected TNO assets through the existing builder; run relevant geometry/contracts and focused localhost rendering checks; synchronize affected dist assets without incorporating unrelated WIP.

## Non-goals and constraints
No production publish, main push, PR merge, or unrelated city-lights changes. No removal of ambiguous remote islands based solely on size/distance. Generated assets and shared builds have one owner (root). Preserve existing WIP.

## User-authorized refinement continuation
First implement the two proposed follow-ups: source-supported candidate restoration, and measured TNO complexity budget adjustment. Europe coasts are the priority; southern/eastern additions are limited to Egypt and Levant. Algeria/Oran/Constantine and general Libya expansion are out of this batch. Keep regional chunk redesign and true geometry LOD as later decisions.

Use actual raw pixel/affine/overlap evidence before enabling a state; do not equate a new state name with missing geography. Preserve stable IDs/ownership and all non-ATL data. Rebuild into an isolated candidate and validate geometry, sea coverage, dedicated coast selection and scenario contracts. Compare baseline and candidate on the same frozen application, with actual ready/pan/zoom/edit/undo evidence. Existing ring/ratio limits may be increased for TNO if valid structure and measured runtime burden support it; preserve world-wrap, invalid-geometry and land/water conflict checks. Do not raise limits merely to make a failing artifact pass.
