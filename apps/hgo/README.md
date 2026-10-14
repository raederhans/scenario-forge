# HGO Native Atlas

[中文说明](README.zh-CN.md)

HGO is an independent Scenario Forge editor for the mod's native pixel map. It opens its own HTML page, keeps its own document and history, and does not load the main app's renderer or global state. Land and water states use the same editing tools. Source entities remain read-only; projects can edit current state ownership and country base colors.

## Run locally

Node.js 20+ runs the checks. Python 3.11+ packages the app with the standard library. The browser app has no npm dependencies, CDN assets or external fonts. WebGL 2 is required; the GPU must support a texture at least as large as the native map (currently 5120 × 2560). Serve over localhost or HTTPS for integrity checks and gzip decoding.

From the repository root:

```sh
cd apps/hgo
npm test
npm run check
python -m http.server 8000 --directory ../..
```

Open `http://localhost:8000/apps/hgo/`. The committed dataset is sufficient to run and package the editor; the source mod is not needed for those operations.

## Edit and save

Click a state to select it, or Shift-click to select several. Use the color control and **Paint selected states**, or switch to Paint and click the map. Water parcels are editable. Search accepts state names, entity tags and state IDs. A single selection supports a custom label; an empty label restores its source name. Undo/redo covers color and label changes. Drag to pan and scroll to zoom.

Save downloads a `.json` project. Open validates the entire project before replacing the current document. PNG exports the complete native map with the enabled border, label and city layers; editing selection highlights are omitted. Project files store stable state colors, custom labels, view and layer settings, together with the exact dataset revision.

Shortcuts: `V` select, `B` paint, `H` pan, `0` fit, `+`/`-` zoom, `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` redo, `Ctrl/⌘+S` save and `Ctrl/⌘+O` open. Chinese and English interface text is available from the header.

HGO native projects use `format: "scenario-forge-hgo"`, schema version 2 and `coordinateSpace: "hgo-pixel"`. Main-editor projects and former HGO preview/vector projects are not interchangeable with this format. This app does not promise geographic projection, province geometry changes or migration of legacy preview documents.

## Build and verify

```sh
# From apps/hgo; pack to repository .runtime/dist/hgo
npm run build

# Custom output and relative return link
python -B tools/build_app.py --output ../../.runtime/dist/hgo-preview --main-url ../../../index.html
node tools/check_boundary.mjs ../../.runtime/dist/hgo-preview

# Python tests and complete dataset validation need the data-tool dependencies below
npm run test:python
npm run validate:data
```

`build_app(source_dir, output_dir, main_url='../../../index.html')` can also be imported by the parent Pages builder, which uses `dist/hgo` and `../app/`. The default return link assumes the repository root is served and the package is at `.runtime/dist/hgo`; set `--main-url` when hosting it elsewhere. The packer verifies declared lengths, transport SHA-256, gzip size, provenance and revision. It publishes only the HTML/CSS/modules and the default manifest's asset closure, including provenance. It rejects output inside the source, output containing the source, undeclared asset traversal and existing outputs containing unowned files. Its build receipt permits subsequent replacement of its own output.

`check_boundary.mjs` checks static browser imports, HTML/CSS resources, declared asset paths and known main-state globals. It is a dependency boundary check, not a JavaScript security sandbox or GPU runtime test. The dedicated workflow runs synthetic data tests, Node behavior tests, data validation and standalone packaging without downloading the mod. Browser/GPU checks remain a separate integration step.

## Rebuild native data

Install the data-tool dependencies only when regenerating the dataset, running its synthetic tests or using the full validator:

```sh
python -m pip install -r requirements.txt
python -B tools/build_dataset.py --source-root /path/to/hgo-mod --output assets/default --palette ../../data/palettes/hgo.palette.json --palette ../../data/palettes/hoi4_vanilla.palette.json
python -B tools/validate_dataset.py assets/default --source-root /path/to/hgo-mod
```

NumPy is used by the builder and full validator; Pillow is used for reading source BMPs and the synthetic source tests. Neither is a browser dependency, and the app packer uses only Python's standard library. Source mod files are read-only inputs and are never included in the app package. Provenance records source and palette fingerprints; a reproducibility claim requires access to matching source inputs and successful validation.

The native map and names derive from Historic Geographical Overhaul (`hgo_mod_2241701657`). The repository [source ledger](../../data/source_ledger.json) records its origin and source-specific terms; the dataset's [provenance](assets/default/provenance.json) records the exact input files and interpretation diagnostics. The project's code license does not relicense this third-party data.

`assets/default/manifest.json` describes `hgo-native-dataset` schema 1, native top-left pixel dimensions, revision and the `ids`, `core` and `places` assets. Each transported asset has a relative URL, encoding, byte length and SHA-256. The ID asset is gzip-compressed, row-major, top-down uint16 little-endian data. Dense code 0 means no data; every other code indexes `core.provinceIds` and `core.provinceStateIds`. Source province ID 0, when defined, has its own nonzero code. Definitions that have no pixels and no state may retain a null state entry; every pixel-present code must resolve to a state.

Core metadata preserves native province IDs, stable state IDs, localized names, reference entities, bounds and member-pixel anchors. Places use source victory-point/capital evidence, never invented modern coordinates. State IDs become string keys in project paint/label objects. Optional places load failures are reported without invalidating core editing.

## Painting controls

Use B for continuous drag painting, I to pick the authoritative stored state color, and H (or Space/middle drag) to pan. A stroke is one undo step; Escape, pointer cancellation or focus loss cancels its uncommitted preview. Paint mode double-click fills the current owner country in one operation. The explicit State/Country scope also controls click, drag and selection fills. Water remains local to the clicked state, never the entire WTR reference.

Selection highlights only boundaries; interior RGB is preserved. Borders and labels still intentionally affect displayed pixels, so use the stored-color picker rather than a screen eyedropper. Country membership uses the project owner override, falling back to historical entityTag. Neither controllerTag, core claims nor matching colors determine current membership. There is no reliable geographic-parent layer in this dataset; no extra geographic tiers are inferred. Painting does not change ownership.

## Map display

Border width is measured in CSS screen pixels (0–2, default 0.7), with adjustable color and opacity. State borders use the chosen width; current-owner country borders are emphasized by 1.25×, capped at 2 pixels. Selection outlines sit outside selected pixels so even a one-pixel state's fill remains exact. Up to 64 visible tiny selections get a small locator ring. These rings indicate location; the native raster cannot reveal additional geographic detail when enlarged, and subpixel regions can still fall between screen samples.

Cities, state names and country names share Low/Medium/High budgets of 96/180/300 items. Each city's point and text reserve collision space together. Custom state labels and explicitly recorded capitals have priority; the supplied dataset currently marks no capitals. A spatial metadata index, staggered scale thresholds and bounded retention of the preceding layout reduce work and threshold flicker. There is no asynchronous layout job to apply a stale zoom result.

Display settings are saved with the project. Existing schema-1 projects load with their paint retained and original ownership, using defaults for missing display settings. Older app versions reject schema 2 rather than silently lose ownership. ID decoding reuses its owned 25 MiB decoded buffer. PNG export uses two large canvases instead of three and releases the temporary WebGL resources before encoding. The isolated export renderer is retained; canvas and encoder storage still make native-size export more demanding than ordinary editing.

## Countries and core territories

Open **Countries & core territories** in the inspector. Search by country name or tag; each row shows current state count, base color and explicit paint overrides. “Set base color; keep paint overrides” changes the inherited color. The separate unify action removes paint overrides only from that country's current states. Identical colors do not merge ownership. Brush strokes and country-scope painting still only paint, including after a territory transfer.

Choose a parent country and a core candidate to preview the exact intersection of the target's source core claims and the parent's **current** states. The preview shows transferred states, remaining parent states, existing target states, paint overrides and proposed color. This is a map editing operation, not a claim that the game permits releasing the country. Water and malformed core tags are excluded; source assets are never rewritten. Overlapping claims are recomputed after each operation, and stale previews must be refreshed. Only one parent/target pair is applied per atomic undo step.

A new core-only country defaults to its tag as its name and a controlled variation of the parent's base color. The name and color can be edited before creation. Existing active targets retain their own base color; change that separately through the country list. Replacing transferred states' paint overrides is explicit and can be turned off. Color suggestions use fixed-hue HSL variants and a small Lab-distance screen; a conflict is reported when the finite choices are too similar, not presented as a visibility guarantee. Source core-only tags do not necessarily have reliable localized names.

Projects store sparse `owners`, `palette` and `createdCountries` maps alongside `paint` and `labels`. All enter undo/redo and atomic file validation. New saves use schema 2; schema 1 loads preserve existing paint with original ownership. **Open schema-2 files directly in this independent HGO page**: the unchanged main-editor handoff currently accepts only schema 1. PNG exports the visible current ownership, labels and colors; JSON is the lossless editable format. A PNG alone cannot restore country ownership.
