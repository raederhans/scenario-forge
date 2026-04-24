# Transport Panel Visibility Context

## Findings
- UI toggles already write `showAirports`, `showPorts`, `showRail`, and `showRoad`, then request context-layer data and render.
- Context-layer collections already write into `airportsData`, `portsData`, `railwaysData`, and `roadsData`.
- `drawContextMarkersPass` is registered in the render pass list.
- `drawContextMarkersPass` skips transport drawing while `deferContextBasePass` is true and currently records staged metrics only for city points, airports, and ports.
- `.omx/metrics.json` is a session/token metrics file. Renderer evidence should come from runtime render metrics.

## Implementation Notes
- Keep the fix inside existing renderer and appearance-controller wiring.
- Do not change transport styles or data loading.
- Do not add a broad fallback path; this is a user-intent release of a staged render delay.
- Static reviewer noted the same hook could help urban/physical/rivers/city points, but this task stays scoped to transport visibility.
- Review follow-up tightened the master toggle path so it releases deferred context only when at least one transport family is already visible.
- Review follow-up also cancels the stale staged context-base timer during explicit release, then keeps the staged hit-canvas warmup path alive when needed.
- Runtime smoke used the live app module graph to verify `releaseDeferredContextBasePassFn` clears `deferContextBasePass`, clears `stagedContextBaseHandle`, and records `releaseDeferredContextBasePass` with `canceledStagedContextBase: true`; full tno transport data visual validation was not run because the first complete scenario script exceeded the useful wait window.
- Targeted checks passed: `node --check` for renderer/controller, `node --test tests/physical_layer_contracts.test.mjs`, and the focused `test_transport_toggles_release_deferred_context_markers` unittest.
- Full `tests/test_global_transport_builder_contracts.py` still has 4 stale static contract failures around older state/renderer string expectations.
