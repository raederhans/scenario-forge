# Roadmap

## Vision
Evolve Map Creator from a stable Europe/Eurasia hybrid renderer into a scalable global map platform with predictable performance, maintainable architecture, and clean project governance.

## Current Status

### Stable foundations
- Hybrid renderer is operational: Canvas for bulk polygon draw + SVG for interaction overlays.
- Political topology and feature IDs are stabilized.
- Embedded neighbor graph is present in topology and used by political auto-fill.
- Artifact culling guard is in place in renderer (skip giant >80% canvas-covering geometry).

### Data pipeline health
- Build pipeline (`init_map_data.py`) reliably produces:
  - `data/europe_topology.json`
  - `data/hierarchy.json`
  - `data/locales.json`
- Country-specific replacement processors are modularized under `map_builder/processors/`.

## Next Milestone (v2.0): Global Data Integration

### Goals
- Replace region-specific build assumptions with global-capable data assembly.
- Move from single topology payload to manifest + chunked topology loading.
- Maintain interactive editing quality at larger scales.

### Deliverables
1. Global-ready pipeline configuration (no hardcoded Europe crop assumptions).
2. Chunked topology outputs (coarse world + country detail packs).
3. Frontend incremental loader and cache eviction strategy.
4. Projection strategy upgrade with world-appropriate default.
5. Performance acceptance checks (startup, memory, zoom/pan smoothness).

### Exit criteria
- Global startup remains responsive on representative hardware.
- No critical regressions in fill/edit/export workflows.
- Auto-fill remains deterministic and stable with chunked layers.

## Future Features

### UI and UX polish
- Projection selector (Equal Earth / Mercator).
- Better layer panel with visible loaded-layer diagnostics.
- In-app performance/debug overlay for data and render metrics.

### Export and project tooling
- Multi-format export presets (PNG/JPG + metadata bundle).
- Stronger project file schema/versioning and validation.
- Optional diff/export of only changed regions.

### Layer and data management
- Per-layer quality toggles (coarse/fine detail).
- Lazy loading controls and pinned-country detail mode.
- Optional context packs (rivers/urban/physical) loaded separately.

## Known Issues and Tech Debt

### Architecture coupling
- UI modules mutate shared state directly and call global render hooks.
- Core state object is broad and mixes rendering, UI, data, and presets.

### Renderer/data debt
- `loadMapData()` assumes one topology URL by default.
- Some UI toggles remain tied to layers that are not consistently rendered in current canvas path.
- Render mode constant (`RENDER_MODE`) is file-level, not runtime-configurable.

### Pipeline debt
- Multiple Europe/Eurasia-specific clipping rules still exist in utility and processor layers.
- Country-specific processor logic embeds geographic assumptions that do not generalize.

### Project hygiene debt
- README structure is partially outdated versus current module layout.
- QA plans exist across many standalone files; roadmap governance is still fragmented.

## Governance Model (Lightweight)
- Keep RFCs in `docs/` for architecture-level decisions.
- Keep milestone plans and execution checklists in this roadmap.
- Require acceptance criteria for each major refactor (performance + correctness + UX).
