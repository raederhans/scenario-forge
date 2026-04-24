# Transport Panel Visibility Plan

## Goal
Make Airports, Ports, Rail, and Road visibly render when users enable them from Appearance > Transport.

## Implementation Steps
- Add missing staged metrics for Road and Rail in `drawContextMarkersPass`.
- Add an internal runtime hook named `releaseDeferredContextBasePassFn`.
- Register the hook from `map_renderer.js`; it clears `deferContextBasePass`, invalidates `contextBase/contextMarkers`, clears their reference transforms, and requests an immediate render.
- Call the hook when the transport master is turned back on and when any family toggle is turned on.
- Extend existing static tests for the renderer staged metrics and transport toggle hook wiring.

## Verification
- Run the relevant Python contract tests.
- Run the renderer contract test that covers staged context metrics.
- Perform a runtime check with `runtimeState.renderPerfMetrics` / `globalThis.__renderPerfMetrics`, not `.omx/metrics.json`.
