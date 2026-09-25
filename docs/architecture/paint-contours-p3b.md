# P3B: paint-derived interior contours

Initial base: main `330ad7c6`, including P3A and the ocean/paint-latency repairs in PR #165.
Continuation integrates `27888645` and retains PR #166 city-label corrections.
Final integration retains main `f98c734790233bc31993506bd1761be85cea90c5`, including PR #168 data repairs.

The primary land boundary represents a difference between **persistent base fill
colors**, not country ownership, screen pixels, a heatmap, a hover state, or an
RGB-to-country identity. Exact normalized six-digit RGB equality suppresses a
shared border. No country-color uniqueness policy or legacy save migration is added.

## Geometry and lifecycle

The contour runtime consumes the composed interactive land collection, including
supplementary editable Atlantropa islands. Shell underlays, water, decorative
support features and non-owner display-rule surfaces are excluded. Coastlines,
province/local reference lines and manually enabled parent lines retain their
independent display settings. Small paint contours are not discarded by the
reference-border decluttering threshold. The primary contour stroke uses the
existing empire-border color, opacity and width controls in normal and interaction
passes. HGO's independent vector-preview renderer is not replaced.

A dedicated module worker maintains a geometry-only edge index. Coordinate keys
use a 1e-7 degree identity grid; rendered positions retain the source coordinates.
Ring side and holes determine true shared sides. Unmatched, exactly collinear
intervals are noded so that independently split chunk edges can meet. Date-line
aliases join. Fine/fine identity stays at 1e-7. For coarse sources declaring
four-decimal quantization, only geometries actually on that grid receive a
sidecar precision marker. Fine/coarse unresolved segments may join at the declared
grid when there are exactly two opposite occupied sides. The coarse line is used
for the sub-grid transition. This is a deterministic precision reconciliation,
not a nearest-curve search or a country-color identity rule. Precision-preserved
coarse exceptions remain at 1e-7. Sidecar provenance survives normalization and
never enters saved projects. Ambiguous overlaps are suppressed and counted. Only proven two-sided interior edges become contours. One-sided edges
include legitimate coastlines and are not automatically classified as defects.

Geometry batches are bounded for messaging and incremental feature replacement.
The worker transfers packed typed coordinate, offset and feature-pair buffers.
On the main thread a per-feature incident-arc index limits ordinary paint updates
to affected edges. Palette/full-color refreshes scan colors, not polygon geometry.
Changing colors without changing the active edge set does not invalidate the
border pass. The old reference-border fallback is not used for pending or empty
contours. Coasts/reference lines remain independently drawable during preparation.

Scene replacement terminates the previous worker and discards late replies.
Same-scene promotions coalesce; a stale result cannot publish. Geometry changes
clear old contours before rebuilding. The newest paint is read when a graph is
published. Worker errors expose an explicit diagnostic and never substitute
incorrect old country borders. Environments without Workers use a scheduled,
batched fallback (final graph packing is synchronous in that fallback).

Export entrypoints wait for contour readiness after detail loading. Direct
synchronous border exports reject a pending/failed graph instead of silently
saving incomplete contours. Renderer asynchronous-work status includes contour
preparation. No new mutable field is introduced into application state.

## Acceptance

`npm run test:node:ownership-retirement` covers the pure graph, packed paint view,
scene lifecycle, delegated draw contract and border cache signatures alongside
P1/P2/P3A behavior. `tools/audit_paint_contours.mjs` checks real topology neighbors,
coarse/detail source replacement and measured build/paint cost in separate Node
processes. Browser cases in `ownership_retirement.spec.js` include exact seam
pixel probes through the real worker and draw owner, plus composed Modern World
and TNO paint/erase/undo/redo behavior. Actual run results, limitations and source
SHAs belong in the PR receipt, not an assertion inferred from these test files.

This change does not clear the previously recorded historical state-writer proof
registration/fingerprint debt, relax required checks, remove all legacy internal
field names, or promise full-world pixel coverage. Geometry/behavior verification
must be distinguished from performance measurements and from repository CI.

## Continuation corrections and measured limits

The first real-scene browser failure was a readiness race: an additional geometry
promotion landed between the readiness poll and the measurement task. The test
now awaits `ensurePaintContoursReady` inside that task before any synchronous
paint/history assertions. Same-scene data promotions no longer terminate the
worker as if the whole scene were replaced. Metadata-only publications cannot
invalidate an otherwise current in-flight geometry result.

Exact noding preserves unpaired subintervals for cross-LOD reconciliation instead
of dropping an entire partly matched edge. Malformed open rings are diagnosed;
the graph follows the vendored d3 stream (first n-1 vertices, then closure), so its
boundary matches the actual filled surface without silently changing source data.

The native-arc oracle uses oriented two-sided incidences on eligible interactive
features, not `topojson.neighbors` alone: raw assets include shell underlays and
same-side overlaps. Candidate misses are additionally checked against coordinate
incidences where separate native arc IDs coincide. Both exclusions and missing
native pairs are reported; a proven missing interior fails. Four real scenario
geometries, TNO coarse/detail promotion/demotion and synthetic unequal-segmentation
and half-quantum negative examples are checked separately. These tests are not an
exhaustive all-viewport screenshot comparison or a repair of historical polygon
overlaps.

Large initial graphs are still expensive and remain off the main thread in normal
browsers. Audit reports record build time, heap usage, packed bytes and local paint
refresh cost; no whole-application FPS or low-memory-device acceptance is claimed.
The unsupported-Worker fallback yields per message batch but packing is synchronous.

## Current-main closeout receipt (2026-09-25)

Runtime source `9d6a22bb233c93a723a4787781fe93207384bfdb` was verified after
integrating main `f98c734790233bc31993506bd1761be85cea90c5`.
Run `36151691720` records separate pristine-main, geometry, browser and integration
results. Artifacts were downloaded and their actual logs checked.

- Real topology audit passed for Modern World, HOI4 1936, HOI4 1939 and TNO 1962.
  Proven eligible native interior pairs were 21,428 / 23,523 / 23,523 / 11,480;
  each reported zero unresolved proven interior pairs. The sampled TNO coarse
  plus AFA/AFG detail promotion reported no lost seams. This is not all possible
  chunk combinations or an assertion that source polygons contain no overlaps.
- Five Playwright cases passed: retired editing controls, actual country paint
  and current-format reload, synthetic Worker/draw-owner seam pixels, and actual
  Modern World/TNO uniform paint, erase, undo and redo. Real-scene geometry build
  counts and source versions stayed unchanged during those paint transactions.
- Pages build passed; startup-shell tests ran 65 cases, with 64 passing and one
  existing conditional skip. Published contour modules matched source bytes.
- The selected integration run executed 221 groups: 218 passed and three failed.
  One was stale landing evidence after the concurrent data repair. The other two
  were the borrowed-effect and quick P4 proof groups, which overlap in coverage.
  A clean main run and P3B both had the same 25 failing P4 test names. Main ran
  481 cases; P3B ran 484, with the three additional regression cases passing.
  No new failing name was observed, but that comparison does not prove every
  diagnostic inside a failing case equivalent or clear historical proof debt.

Run `36156577597` then verified only the narrow landing correction and relevant
regressions before committing `1783f9606aab9f80efb6281bdd449e4504ab77ae`:

- Corrected source and checked-in landing HTML markers from their existing JSON:
  HOI4 1939 6,081 to 6,080; TNO 3,236 to 3,247. Scenario data was not changed.
- All 22 existing landing behavior/evidence tests passed without weakening them.
- All 238 ownership-retirement/contour/reference/history/export behavior tests
  passed, with no failures or skips.
- Pages build and byte-for-byte publication checks passed again.

That correction changes only `landing/index.html` and `dist/index.html`; contour
runtime, geometry, tests and scenario data remain identical to the previously
verified runtime source. The subsequent documentation receipt changes no runtime
behavior. The entire 221-group matrix was not rerun after this HTML-only fix.
The two historical proof execution groups remain unresolved, not waived. Normal
required PR checks and their approval state are separate from these scoped
receipts. No main merge, deployment or protection relaxation is part of this PR.
