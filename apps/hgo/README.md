# HGO Native Atlas

[中文说明](README.zh-CN.md)

HGO is an independent Scenario Forge editor for the mod's native pixel map. It opens its own HTML page, keeps its own document and history, and does not load the main app's renderer or global state. Land and water states use the same editing tools. Reference entities remain read-only.

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

HGO native projects use `format: "scenario-forge-hgo"`, schema version 1 and `coordinateSpace: "hgo-pixel"`. Main-editor projects and former HGO preview/vector projects are not interchangeable with this format. This app does not promise geographic projection, editable ownership, province geometry changes or migration of legacy preview documents.

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
