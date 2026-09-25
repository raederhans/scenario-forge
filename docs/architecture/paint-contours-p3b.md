# P3B: paint-derived interior contours

Base: main `330ad7c6`, including P3A and the ocean/paint-latency repairs in PR #165.

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
aliases join; nearby but distinct curves and ambiguous overlaps are not silently
welded. Only proven two-sided interior edges become contours. One-sided edges
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
