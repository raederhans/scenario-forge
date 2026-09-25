# P3B: paint-derived interior contours

Initial base: main `330ad7c6`, including P3A and the ocean/paint-latency repairs in PR #165.
Continuation integrates `27888645` and retains PR #166 city-label corrections.

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
