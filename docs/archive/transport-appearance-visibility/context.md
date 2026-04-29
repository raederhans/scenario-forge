# Transport Appearance Visibility Context

## 2026-04-29

- User-approved plan says the data is mostly present: Japan airport/port point packs exist, Japan road/rail workbench packs exist, and global road/rail catalogs exist for the main map.
- Current root causes to verify in live code:
  - `buildContextFacilityEntries()` reads `canvas?.width` and `canvas?.height` from an undeclared identifier, which breaks airport/port point rendering.
  - `normalizeRequestedContextLayerNames()` filters explicit `roads`, `railways`, and `rail_stations_major` requests before `loadContextLayerPackInternal()` can reach its catalog branches.
- Boundary to preserve: `includeContextLayers === true` should continue returning only rivers plus `CONTEXT_LAYER_PACKS`, keeping global road/rail catalog loading tied to explicit toggles.
- Implemented the narrow code patch:
  - `buildContextFacilityEntries()` now reads `context?.canvas` through `targetCanvas` before viewport clipping.
  - `normalizeRequestedContextLayerNames()` now admits the explicit catalog-backed layer names `roads`, `railways`, and `rail_stations_major`.
  - The eager `includeContextLayers === true` branch still returns only rivers plus `CONTEXT_LAYER_PACKS`.
- Browser validation exposed a third visibility blocker in the same chain: `ports.geojson` is Point data, but all current Japan ports top out at `importance_rank = 2`; the renderer's generic zoom floor required rank 3 at default zoom, so ports loaded but produced `visibleFeatureCount = 0`.
- Adjusted the port zoom reveal floor to start at rank 2, matching the current regional-port data phase while preserving scope and importance threshold filtering.
- Targeted checks passed:
  - `node --check js/core/map_renderer.js`
  - `node --check js/core/data_loader.js`
  - `python -m unittest tests.test_transport_facility_interactions_contract`
  - `python -m unittest tests.test_global_transport_builder_contracts`
- Short browser validation on `/app/` passed after enabling all four toggles:
  - `drawAirportsLayer.visibleFeatureCount = 33`
  - `drawPortsLayer.visibleFeatureCount = 12`
  - `drawRailwaysLayer.visibleFeatureCount = 769`
  - `drawRoadsLayer.visibleFeatureCount = 43946`
  - `drawRailStationsMajorLayer` remains an empty `FeatureCollection` phase state with `reason = "no-data"`.
  - No failed transport requests and no `canvas is not defined` console item.
