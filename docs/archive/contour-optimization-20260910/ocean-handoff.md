# P1 ocean geometry handoff

Implemented in `js/core/renderer/bathymetry_geometry.js`; focused tests in `tests/bathymetry_geometry_behavior.test.mjs`.

Integrated: map_renderer imports `normalizeBathymetryFeatureCollection` into map_renderer and calls it on the decoded bands in `normalizeBathymetryTopologyEntry`, once per topology load:

```js
const normalized = normalizeBathymetryFeatureCollection(bands, globalThis.d3);
// entry fields:
bands: normalized.collection,
geometryDiagnostics: normalized.diagnostics,
```

Contours are lines and must remain unchanged. The ocean render owner also reuses projected paths and rejects offscreen bands/contours before building paths. The normalizer uses injected D3 geoArea and geoBounds, like the existing political owner uses D3 area and immutable ring rewinding, but decides orientation per spherical ring rather than planar shoelace. This also supports antimeridian crossings and independently wound holes/MultiPolygon components. Local bands are explicitly assumed smaller than a hemisphere; this is not a general-purpose land/world polygon rewinder.

Input collection/feature/geometry metadata are retained and inputs are never mutated. Reversed ring arrays are copied; unchanged coordinate arrays can remain shared. Malformed/unclosed/out-of-range rings, degenerate exteriors, hemispherical ambiguity and invalid resulting polygon scope are excluded with diagnostics. A zero-area interior hole is removed independently, preserving the valid exterior. This was required by actual assets, not a speculative compatibility branch.

Fresh verification: `node --test tests/bathymetry_geometry_behavior.test.mjs` passed 8/8 on 2026-09-10. Covers exterior/hole containment, immutability, idempotence, MultiPolygon, antimeridian, malformed components, collapsed holes, invalid spherical scope, projected world-fill regression, and both real TopoJSON assets using project vendor D3/TopoJSON.

- Global: 1534 features / 1565 polygons; original complementary-fill features 46; 76 rings rewound; one zero-area hole removed; no polygons rejected; all features retained; all resulting feature and component areas local and finite bounds.
- TNO in this worktree: 90 features / 993 polygons; original complementary-fill features 2; 573 rings rewound; one zero-area hole removed; no polygons rejected; all features retained. This differs from the earlier original-worktree 94-feature snapshot and is reported separately.
- Global collapsed hole: feature index 105, polygon 0, ring 1. TNO: feature index 78, polygon 1, ring 1.
- Node emitted the repository's MODULE_TYPELESS_PACKAGE_JSON warning; tests passed. No package change made.

No data, asset generation, dist, registry, browser/server, build or unrelated source edits made. Runtime wiring is integrated; final import graph/dist and browser outcomes are recorded in task.md. The projected test proves the complementary-fill fix but does not establish that every visual seam or ocean clipping issue is gone. Existing applyBathymetryCoverageExclusionMask uses evenodd sphere exclusion; no independent evidence established a second clipping bug within this subtask.
