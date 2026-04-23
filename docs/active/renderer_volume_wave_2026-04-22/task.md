# renderer volume wave 2026-04-22

## Goal
- Shrink `js/core/map_renderer.js` by moving pure owner-backed facade wrappers into scoped facade modules.
- Thin `spatial_index_runtime_owner.js` with state_ops + derivation seams.
- Thin `border_mesh_owner.js` by moving pure compute helpers into a pure runtime module.

## Scope
- `js/core/map_renderer.js`
- `js/core/map_renderer/*.js`
- `js/core/renderer/spatial_index_runtime_owner.js`
- `js/core/renderer/spatial_index_runtime_state_ops.js`
- `js/core/renderer/spatial_index_runtime_derivation.js`
- `js/core/renderer/border_mesh_owner.js`
- `js/core/renderer/border_mesh_dynamic_runtime.js`
- existing boundary/runtime tests tied to these files

## Constraints
- Keep `public.js` export surface unchanged.
- Keep render/init/setMapData/scenario refresh orchestration unchanged.
- No new runtimeState/state `*Fn` hook writers.
- Freeze unrelated files and keep test execution serialized.