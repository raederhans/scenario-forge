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

The inspector keeps search and a compact selection summary above **Edit | Layers | Countries**. Each page retains its own scroll position and existing input controls. Use Left/Right or Home/End on a tab to switch pages. Edit contains color and naming tools; Layers combines borders, labels and optional visualizations; Countries contains ownership and core-territory tools. Tab changes do not alter the project, enable layers or request map resources. Hidden country controls defer their data queries. Layer parameters appear only when relevant, with additional settings and data notes in disclosure sections.

Save downloads a `.json` project. Open validates the entire project before replacing the current document. PNG exports the complete native map with the enabled border, label and city layers; editing selection highlights are omitted. Project files store stable state colors, custom labels, view and layer settings, together with the exact dataset revision.

Shortcuts: `V` select, `B` paint, `H` pan, `0` fit, `+`/`-` zoom, `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` redo, `Ctrl/⌘+S` save and `Ctrl/⌘+O` open. Chinese and English interface text is available from the header.

HGO native projects use `format: "scenario-forge-hgo"`, schema version 2 and `coordinateSpace: "hgo-pixel"`. Main-editor projects and former HGO preview/vector projects are not interchangeable with this format. Optional geographic references use an independently registered overlay; province geometry and editing remain native pixels. Legacy preview migration is not supported.

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

`build_app(source_dir, output_dir, main_url='../../../index.html')` can also be imported by the parent Pages builder, which uses `dist/hgo` and `../app/`. The default return link assumes the repository root is served and the package is at `.runtime/dist/hgo`; set `--main-url` when hosting it elsewhere. The packer verifies declared lengths, transport SHA-256, gzip size, provenance and revision. It publishes the HTML/CSS/modules, the default manifest's closure, and the optional visualization catalog's declared asset/provenance closure. It rejects output inside the source, output containing the source, undeclared asset traversal and existing outputs containing unowned files. Its build receipt permits subsequent replacement of its own output.

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

The optional visualization panel includes native terrain/modern landform classification, registered rivers, the bundled 2016 modern night-light derivative, geographic day/night shading, and 17 native resource/building metrics at 1936.1.1. Chinese names combine repository bilingual records and explicitly attributed translations, with original-name fallback and custom-name priority. Current translated state/entity/place counts are 4,962/569/695 respectively, including 715 of 924 water states. The 271 unnamed states and 121 unnamed places are explicit display fallbacks, not translations.

The six resource metrics use circles at native state anchors. Circle area is proportional to the native game resource value, not real-world tonnage, density or deposit locations. Each metric keeps a fixed map-wide maximum; a shared, bounded size coefficient grows with zoom without changing value ratios. A cached positive-value index per metric prioritizes tight anchor neighborhoods once, using quantity and state ID as stable tie-breaks. A screen-space grid probes at most 65 deterministic disk candidates per symbol in each canonical-layout or edge-repair pass, trying shorter offsets first. Ordinary pans reuse the current-scale layout without rebuilding the neighborhood order. Positive states are neither aggregated nor discarded. Circles may move at most 30 CSS pixels, with leaders back to their state anchors and padding at viewport edges. Unresolved overlaps remain semi-transparent and the panel reports their count. Recorded zero and missing values both have no circle; state details distinguish them. Symbols reserve collision space for labels and do not participate in native picking: click the state to inspect its value.

Infrastructure uses a fixed sequential 0–10 level palette, including level 10 even though the current recorded maximum is 9. Equal levels have equal colors across countries. The level fill replaces decorative land-layer colors and ignores metric opacity; missing values retain the light base, distinct from recorded level 0. The map and level legend share `infrastructureColor`. Other building metrics retain the existing state-fill display: full-map linear min/max normalization, a middle color for constant values, transparent missing values and recorded zero included. Their legend shows unblended colors; the base, other layers and opacity affect the visible fill.

Building units follow the source mod's `common/buildings/00_buildings.txt`: infrastructure, air bases, anti-air and radar expose native levels; the current naval-base, coastal-fort and land-fort data expose sums of province levels, not counts of facilities. Factories, dockyards and synthetic refineries retain configured counts. Infrastructure reads only the explicit state field. For other buildings, an explicit state value, including zero, takes precedence; otherwise valid province values are summed, without double counting. Native values are unchanged; original manpower is not presented as population.

All 184 previously untranslated named places have been reviewed: 116 received supported Chinese forms and 68 retain their original names. The first state batch covered 146 land states and all 417 previously untranslated water states: 302 accepted and 261 unresolved. A further 429 land states received 323 Chinese forms, with 106 unresolved. The previous regional batch reviewed 446 new states, accepting 371 Chinese forms and retaining 75 originals. Round 5 reviewed 285 new IDs: 87 in the Europe/Russia assignment, 95 in Asia, and 103 across the Americas, Africa and Oceania. It adds 254 Chinese forms and retains 31 original names. Every earlier reviewed ID, including unresolved ones, was excluded. Weihsien, Khotan, Nyasaland, Basutoland and New Hebrides keep historical forms; ambiguous historical names are not replaced by modern successors.

Round 6 reviewed 154 new IDs: 50 in Europe/Russia, 51 in Asia, and 53 across the Americas, Africa and Oceania. It added 89 Chinese forms and retained 65 originals. All 1,723 earlier decisions and all place records are preserved. Historical Ceylon, Hejaz, Voroshilovgrad and Nelspruit keep their source-era forms. At the end of Round 6, the table held 1,877 decisions, with 6,307 named land states unreviewed and 538 reviewed states unresolved.

Round 7 reviewed 111 new IDs, accepting 70 Chinese forms and retaining 41 originals. The Europe/Russia assignment pool contains 34 IDs (25 accepted, 9 unresolved), the Asia pool 42 (25/17), and the other-regions pool 35 (20/15). These are mutually exclusive native-atlas assignment bins, not exact geographic regions: the Asia pool includes 20 Algerian states. All 1,877 earlier review entries were preserved individually and the place-review file was byte-for-byte unchanged. Round 7 ended with 1,988 decisions, 6,196 named land states unreviewed and 579 reviewed states unresolved.

Round 8 reviews 96 new IDs: Europe/Russia 36 (29 accepted, 7 unresolved), Asia 35 (18/17), and the other regional assignment 25 (16/9). It adds 63 Chinese forms and retains 33 originals. All 1,988 earlier decisions, including unresolved entries, remain unchanged; entity/place records and place-review bytes are unchanged. Historical source names and direction qualifiers are preserved, while names with conflicting locations, distant homonyms or insufficient historical evidence remain in the original language. At the end of Round 8, the table held 2,084 decisions, with 6,100 named land states unreviewed and 612 reviewed states unresolved.

Round 9 reviews 87 new IDs: Europe/Russia 26 (18 accepted, 8 unresolved), Asia 26 (14/12), and the other regional assignment 35 (19/16). It adds 51 Chinese forms and retains 36 originals. All 2,084 prior decisions and all entity/place records remain unchanged. Historical and directional qualifiers are retained; uncertain spelling equivalences, geographic identities and modern successors remain unresolved. The table now holds 2,171 decisions, with 6,013 named land states unreviewed and 648 reviewed states unresolved. These are selected batches, not an exhaustive audit. Evidence distinguishes full source reads from authoritative indexed excerpts where retrieval of the full document failed.

Each decision in [place_reviews.json](assets/overlays/localization/place_reviews.json) and [state_reviews.json](assets/overlays/localization/state_reviews.json) binds to its native ID, original name and entity; place decisions also bind to the native state. Place-to-state reuse requires the same state, entity and source name. Existing Chinese source forms and transparent compositions are distinguished from unsupported transliteration; `verified` means a cited Chinese record can be checked, not official standardization. Historical names such as Dnipropetrovsk, Voroshilovgrad, Nova Lisboa, Jehol, Shikuka and Karenko retain their historical Chinese forms. Regional directions, longitude divisions and reclamation stages remain explicit. Ambiguous names stay unresolved. See the [Chinese data and limitations notes](README.zh-CN.md#可选地形夜光与原生指标).

Base map colors default to `baseMapStyle: "political"` (Country colors). The optional `"thematic"` style gives land a light base and reduces same-owner state-border opacity to 0.3 of its configured value. WTR colors, stored paint, stored-color picking and ownership remain unchanged. The style is saved in JSON and rendered in PNG. Resource and infrastructure modes automatically use a neutral light land base without changing the saved `baseMapStyle`; turning the metric off restores the configured base. To edit and inspect actual fill colors, turn metrics off and select Country colors (`political`).

All geographic vector processing happens offline. Balanced quality (default) uses 1280×640 categorical terrain and 2560×1280 rivers; Fine uses 2560×1280 and 5120×2560. Categorical nearest sampling preserves class codes; 2×2 max pooling preserves thin rivers. These two decoded assets total 3.90625 MiB in Balanced versus 15.625 MiB in Fine. Native province water masking clips coarse samples at exact native coast pixels. Whole-map textures use edge clamping and have no tile seams requiring padding. Modern references cover approximately 85.46% of native land, with a broader approximate solar domain covering 97.22%; this is visual registration, not a geodetic projection guarantee. This round leaves the geographic registration unchanged. The fixed 88-control-point set has a forward-error p95 of about 11.51 native pixels; it does not establish alignment for every river.

Landform names use 382 pre-registered metadata points, loaded only in modern/combined terrain modes while their independent switch is enabled. The optional spatial index rebuilds only when the resource changes and is released on disable. Source `minZoom` is an atlas scale, normalized against a 1024px-wide world; rank thresholds and modest stagger/hysteresis progressively reveal names without runtime geographic projection. Chinese is normalized offline with the pinned dictionaries. [Name corrections](assets/overlays/geography/name_reviews.json) bind to exact IDs and original bilingual fields; uncertain Chinese falls back to English. PNG retains an explicit resource snapshot.

River weight uses an offline R8 signed-distance derivative at the existing two resolutions: `(byte - 128) / 16` texture texels, positive inside. The 0.5–3 control adjusts each edge by `(weight - 1) / 2` texels; it is neither CSS pixels nor an exact multiplier for all source widths. Four local samples and a bounded diagonal connection preserve thin branches; native WTR clips the final expanded coverage. Weight 1 preserves source classification at texel centers, with subpixel diagonal gaps filled. The original 128/255 provenance masks remain packaged; both sources now share the opacity control. Slider changes update uniforms without texture uploads or CPU river reconstruction.

Solar shading uses a 512×256 RGBA8 texture: encoded normals are premultiplied by an independent alpha display weight, with a four-cell smoothstep fade at the valid-domain edge. A single LINEAR-filtered texture sample recovers the normal; no additional texture is introduced. The fade does not expand the valid domain. Existing confidence codes remain separate categorical metadata, not statistical probabilities.

`assets/overlays/catalog.json` binds independently to the unchanged base dataset revision. The loader validates hashes and sizes, aborts obsolete requests, and releases disabled raster/metric data. Localization stays available for corrected English and bilingual search until disposal. Optional decoded asset accounting is bounded at 48 MiB; this is not total browser heap usage. Disabled visualizations use the base shader; manual solar time has no animation loop. Export snapshots document/settings/time, waits for required assets, and includes the selected quality. Missing optional translations do not prevent an English base-map export.

Main-repository inputs are pinned under `assets/sources/main/`. `manifest.json` there records each file's hash, the main commit it came from, and the reviewed source archives. Every HGO builder and test reads these snapshots, so changes to the main application's data never alter HGO outputs or break its checks. To adopt newer main data, run `python -B tools/sync_main_sources.py`. It reads committed main files, verifies the reviewed archive hashes and prints a per-file change summary. Then rebuild the affected overlays below and commit the snapshots together with the rebuilt outputs.

Rebuild with `build_geographic_overlays.py --source-root /path/to/hgo-mod`, `build_illumination.py`, `build_native_metrics.py --source-root /path/to/hgo-mod`, `build_localization.py`, then `build_overlay_catalog.py` (all under `tools/`). NumPy/Pillow/SciPy are offline tools only. `build_geographic_overlays.py --balanced-only` regenerates quality derivatives without changing registration; `--river-distance-only` refreshes only the distance fields; `--label-names-only` refreshes reviewed text without moving anchors or rebuilding rasters. The night-light derivative retains its upstream input identity status `not_attested`; this change does not authenticate new satellite inputs. OpenCC dictionaries and license are pinned for offline simplified-Chinese normalization. Real hillshade is deferred because the native heightmap has only two values and no trustworthy registered DEM is supplied.

Border width is measured in CSS screen pixels (0–2, default 0.7), with adjustable color and opacity. State borders use the chosen width; current-owner country borders are emphasized by 1.25×, capped at 2 pixels. Selection outlines sit outside selected pixels so even a one-pixel state's fill remains exact. Up to 64 visible tiny selections get a small locator ring. These rings indicate location; the native raster cannot reveal additional geographic detail when enlarged, and subpixel regions can still fall between screen samples.

Cities, state names, country names and landform names share Low/Medium/High budgets of 96/180/300 items. Landforms additionally have subcaps of 12/24/40 within that total. Each city's point and text reserve collision space together. Custom state labels and explicitly recorded capitals have priority; the supplied dataset currently marks no capitals. A spatial metadata index, staggered scale thresholds and bounded retention of the preceding layout reduce work and threshold flicker. There is no asynchronous layout job to apply a stale zoom result.

Display settings are saved with the project. Existing schema-1 projects load with their paint retained and original ownership, using defaults for missing display settings. Older app versions reject schema 2 rather than silently lose ownership. ID decoding reuses its owned 25 MiB decoded buffer. PNG export uses two large canvases instead of three and releases the temporary WebGL resources before encoding. The isolated export renderer is retained; canvas and encoder storage still make native-size export more demanding than ordinary editing.

## Countries and core territories

Open the **Countries** tab in the inspector. Search by country name or tag; each row shows current state count, base color and explicit paint overrides. “Set base color; keep paint overrides” changes the inherited color. The separate unify action removes paint overrides only from that country's current states. Identical colors do not merge ownership. Brush strokes and country-scope painting still only paint, including after a territory transfer.

Choose a parent country and a core candidate to preview the exact intersection of the target's source core claims and the parent's **current** states. The preview shows transferred states, remaining parent states, existing target states, paint overrides and proposed color. This is a map editing operation, not a claim that the game permits releasing the country. Water and malformed core tags are excluded; source assets are never rewritten. Overlapping claims are recomputed after each operation, and stale previews must be refreshed. Only one parent/target pair is applied per atomic undo step.

A new core-only country defaults to its tag as its name and a controlled variation of the parent's base color. The name and color can be edited before creation. Existing active targets retain their own base color; change that separately through the country list. Replacing transferred states' paint overrides is explicit and can be turned off. Color suggestions use fixed-hue HSL variants and a small Lab-distance screen; a conflict is reported when the finite choices are too similar, not presented as a visibility guarantee. Source core-only tags do not necessarily have reliable localized names.

Projects store sparse `owners`, `palette` and `createdCountries` maps alongside `paint` and `labels`. All enter undo/redo and atomic file validation. New saves use schema 2; schema 1 loads preserve existing paint with original ownership. **Open schema-2 files directly in this independent HGO page**: the unchanged main-editor handoff currently accepts only schema 1. PNG exports the visible current ownership, labels and colors; JSON is the lossless editable format. A PNG alone cannot restore country ownership.
