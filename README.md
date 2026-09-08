<div align="center">
  <img src="docs/readme/logo-mark.webp" alt="Scenario Forge logo" width="96">

  <h1>Scenario Forge</h1>

  Scenario Forge is a scenario-first map creation workbench for alternate history, strategy modding, and geopolitical storytelling.
  Open the public demo to launch the editor, follow the guide, start from TNO 1962, and export a PNG/JPG or editable project snapshot. HGO 1936 is a developer/local preview, and Cloud Saves/community are local backend previews.

  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-111111?style=for-the-badge" alt="MIT License"></a>
    <a href="https://raederhans.github.io/scenario-forge/"><img src="https://img.shields.io/badge/Live%20Demo-Scenario%20Forge-2563eb?style=for-the-badge" alt="Live Demo"></a>
    <a href="https://github.com/raederhans/scenario-forge/actions/workflows/deploy.yml"><img src="https://github.com/raederhans/scenario-forge/actions/workflows/deploy.yml/badge.svg" alt="Deploy Status"></a>
    <a href="https://github.com/raederhans/scenario-forge/issues"><img src="https://img.shields.io/badge/PRs-welcome-0f766e?style=for-the-badge" alt="PRs welcome"></a>
    <a href="./README.md"><img src="https://img.shields.io/badge/English-111111?style=for-the-badge" alt="English"></a>
    <a href="./README.zh-CN.md"><img src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2563eb?style=for-the-badge" alt="Simplified Chinese"></a>
  </p>

  <p>
    <a href="https://raederhans.github.io/scenario-forge/">Live Demo</a>
    ·
    <a href="https://github.com/raederhans/scenario-forge/issues">Report Bug</a>
    ·
    <a href="./README.zh-CN.md">简体中文</a>
  </p>

  <img src="docs/readme/hero-workspace.webp" alt="Scenario Forge workspace showing a political map editor, sidebars, and map controls" width="860">
</div>

## What It Does

Scenario Forge gives creators one place to choose a world state, edit political control, tune the map's visual style, add strategic overlays, inspect transport layers, and export a polished map image or reusable project file.

- **Scenario baselines:** start from Blank Map, Modern World, HOI4 1936, HOI4 1939, or TNO 1962. HGO 1936 ships as a developer/local preview and appears separately from the five public baselines.
- **Political editing:** repaint ownership and controller state, inspect split ownership, and switch between ownership, controller, and frontline views.
- **Map appearance:** tune oceans, borders, parent borders, terrain, urban areas, city points, rivers, textures, day-night shading, and reference images.
- **Strategic markup:** add legends, frontlines, operational lines, operation graphics, labels, and unit-counter style overlays.
- **Transport workbench:** inspect roads and rail as the strongest public transport layers, with airports, ports, mineral resources, energy facilities, industrial land, logistics hubs, and layer order available through overview or workbench previews.
- **Bilingual export workflow:** use English or Simplified Chinese, save editable project files, and export PNG/JPG presentation snapshots at 1x-4x scale.

## Try the Public Demo in 5 Steps

1. Open the [Live Demo](https://raederhans.github.io/scenario-forge/).
2. From the landing page, enter the editor/demo workspace.
3. Open the guided path directly at [`/app/?view=guide`](https://raederhans.github.io/scenario-forge/app/?view=guide).
4. TNO 1962 is the default public scenario path; you can also switch among Blank Map, Modern World, HOI4 1936, HOI4 1939, and TNO 1962.
5. Open Project / Export and download a PNG/JPG snapshot or save an editable project JSON.

## Open or Download Sample Projects

The landing page links checked-in starter projects for the public baselines. Use `/app/?sample=<sample-id>&view=guide` to open one directly in the editor with a sample-aware Guide that names the editable project, lists the five public starter samples, shows the recommended export path, and links export plus the original JSON download. Switching samples inside the Guide reuses the checked-in manifest and asks for confirmation before replacing unsaved work; after a successful switch, the URL updates to the selected `sample`. The Project tab also confirms the sample load, and Export Workbench repeats the loaded sample plus recommended output. The editable project JSON files and recommendation metadata are listed in [`landing/assets/sample-runs.json`](landing/assets/sample-runs.json).

- TNO 1962 Atlantropa briefing: [open in editor](https://raederhans.github.io/scenario-forge/app/?sample=tno-1962-atlantropa-briefing&view=guide) · [`tno-1962-atlantropa-briefing.project.json`](landing/assets/sample-projects/tno-1962-atlantropa-briefing.project.json)
- HOI4 1936 Europe briefing: [open in editor](https://raederhans.github.io/scenario-forge/app/?sample=hoi4-1936-europe-briefing&view=guide) · [`hoi4-1936-europe-briefing.project.json`](landing/assets/sample-projects/hoi4-1936-europe-briefing.project.json)
- HOI4 1939 Europe switch: [open in editor](https://raederhans.github.io/scenario-forge/app/?sample=hoi4-1939-europe-switch&view=guide) · [`hoi4-1939-europe-switch.project.json`](landing/assets/sample-projects/hoi4-1939-europe-switch.project.json)
- Modern World Japan corridor: [open in editor](https://raederhans.github.io/scenario-forge/app/?sample=modern-world-japan-corridor&view=guide) · [`modern-world-japan-corridor.project.json`](landing/assets/sample-projects/modern-world-japan-corridor.project.json)
- Blank Map starter: [open in editor](https://raederhans.github.io/scenario-forge/app/?sample=blank-base-starter&view=guide) · [`blank-base-starter.project.json`](landing/assets/sample-projects/blank-base-starter.project.json)

## Current Public Surface

| Surface | Public demo status | Local/developer boundary |
| --- | --- | --- |
| Public scenario baselines | Online: Blank Map, Modern World, HOI4 1936, HOI4 1939, and TNO 1962. | HGO 1936 remains a developer/local preview and appears separately from the five public baselines. |
| HGO runtime preview | Developer/local only. | Used for HOI4-style country identity, palette, flag, and raster-render validation. |
| Transport workbench | Online overview/workbench: roads and rail are the strongest public paths; airports and ports provide overview context. | Mineral resources, energy, industry, and logistics remain preview/workbench families while coverage grows. |
| Export workbench | Online. | Exports PNG/JPG snapshots at 1x-4x scale and saves editable project JSON. |
| Cloud Saves/community | Local backend preview. | Start `start_backend_preview.bat` to try account sessions, Cloud Saves, posts, downloads, comments, reports, and admin moderation flows. |
| Data provenance | Source-backed and documented. | Detailed records live in `data/source_ledger.json`, `.provenance.json` files under `data/`, transport recipes under `data/transport_layers/`, and generated asset source records. |

## See It In Action

<table>
  <tr>
    <td width="50%">
      <img src="docs/readme/shot-scenario.webp" alt="Political scenario map view" width="100%"><br>
      <strong>Political scenario maps</strong><br>
      Switch baselines, review borders, and keep the map readable while editing.
    </td>
    <td width="50%">
      <img src="docs/readme/shot-transport.webp" alt="Transport workbench with Japan road data" width="100%"><br>
      <strong>Transport workbench</strong><br>
      Inspect source-backed roads, rail, airports, ports, and other planning layers.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/readme/shot-night.webp" alt="Day-night and city-light style controls" width="100%"><br>
      <strong>Presentation-ready styles</strong><br>
      Combine borders, terrain, rivers, city lights, and texture controls into a clean map look.
    </td>
    <td width="50%">
      <img src="docs/readme/shot-export.webp" alt="Export workbench with layer controls" width="100%"><br>
      <strong>Layered export controls</strong><br>
      Adjust image output, choose formats, reorder layers, and prepare final snapshots.
    </td>
  </tr>
</table>

## Who It Is For

- Alternate-history creators who need fast, editable political maps.
- HOI4, TNO, Kaiserreich, and Red Flood modders exploring world-state ideas.
- Scenario and campaign designers preparing map-led concepts.
- Writers, researchers, and presenters who need a clear geopolitical visual.
- Map builders who want saved projects, style control, and clean exports in the same workspace.

## Try It

### Online Demo

Open the live build:

- https://raederhans.github.io/scenario-forge/

The online version is the best starting point for scenario editing, appearance tuning, project files, and exports.
Use the 5-step path above when you want a quick public-demo success run.

### Local Editor

Prerequisites:

- Windows is the supported path for the included `.bat` launchers.
- Python 3 should be available through `py -3` or `python`.
- The runtime assets needed by the selected scenario must already be present in the checkout. The default, `fast`, and `fresh` launch modes skip data rebuilding; they do not create missing assets.

Start the local editor using existing runtime assets:

```bat
start_dev.bat
```

Use the startup worker and cache with readonly startup interaction:

```bat
start_dev.bat fast
```

Use full startup interaction with the startup worker and cache disabled (this still skips data rebuilding):

```bat
start_dev.bat fresh
```

When data rebuilding is required, use the explicit full mode with the data build dependencies and source inputs installed:

```bat
start_dev.bat full
```

Full mode runs `build_data.bat` before starting the server; it is not required for ordinary UI edits when the runtime assets are already available.

For ordinary public-scenario UI or renderer-owner work, an optional sparse source checkout avoids materializing build inputs, large transport payloads, and tracked `dist`. It keeps source files editable and preserves the original runtime metadata. The selection reuses the Pages asset policy and adds direct runtime-registry and public-scenario manifest dependencies, including full topology and audit files that the source metadata still references.

Prepare a plan from a committed source version in a full checkout (PowerShell):

```powershell
$source = git rev-parse HEAD
py -3 tools/editor_checkout_profile.py prepare --source $source --out-root .runtime/editor-checkout/profile
```

Review `profile.json` for the exact commit/tree, selected/excluded files, logical Git bytes and supported scope. `source-presence.json` lists raw-source cache presence, expected checksums, upstream references and existing rebuild commands; presence does not prove checksum validity or that raw data can be regenerated. `prepare` writes these files and literal Git patterns only; it never changes checkout settings.

Apply the reviewed plan **only to a new, unused worktree path**; never run these commands against an existing worktree with work in progress:

```powershell
$target = 'C:\path\to\new-editor-worktree'
git worktree add --detach --no-checkout $target $source
Get-Content -Raw .runtime/editor-checkout/profile/sparse-checkout.txt | git -C $target sparse-checkout set --no-cone --stdin
git -C $target checkout --detach $source
py -3 tools/editor_checkout_profile.py check --source $source --repo $target --out-root .runtime/editor-checkout/profile
```

Stop if any command fails. `check` regenerates the fixed-source plan and verifies that selected files are present and excluded tracked files were not materialized. It reports actual file bytes separately from logical Git bytes; neither is disk allocation or network traffic. Git worktrees share their object database, so this reduces materialized files, not shared history storage or download volume. Create your own branch in the new worktree before editing, then install its Node dependencies with `npm ci` and use `start_dev.bat fast`.

The intended acceptance path is the existing `editing baseline fast` HOI4 1936 / Modern World save-load test. HGO preview, full transport workbench payloads, raw-data rebuilding, Pages release builds and P4 history qualification require a full checkout. Catalog inventories can still list assets outside this profile; their presence in metadata does not make those optional workflows supported. To restore the new worktree to full materialization, first preserve any local edits, then run `git -C $target sparse-checkout disable`. This does not retire tracked `dist` or change another worktree.

Keep formal rebuilding on a fixed full source: `data/manifest.json` records derived outputs and checksums; `data/source_ledger.json` and transport manifests record upstream/cache requirements, recipes and build commands. Some raw inputs are ignored or `frozen_local_only` caches. Use their recorded provenance and existing `tools/check_source_ledger.py` validation when rebuilding data; the lightweight editor profile does not download them or substitute Pages packaging for raw-data regeneration.

### Local Backend Preview

Open the local backend and community preview:

```bat
start_backend_preview.bat
```

This local mode stores preview backend data under `.runtime/backend/` on your machine. It is useful for trying Cloud Saves, public community posts, downloads, comments, reports, and admin moderation flows.

## Typical Workflow

1. Choose a scenario baseline.
2. Edit ownership, controller, or frontline state.
3. Adjust visual layers such as borders, water, terrain, cities, rivers, transport, and reference imagery.
4. Add presentation elements such as legends, operational lines, unit counters, labels, and operation graphics.
5. Save an editable project JSON, then export the final PNG/JPG presentation snapshot.

## Feature Status

The main editor path is ready for normal map creation: scenario switching, political edits, appearance controls, project save/load, strategic annotations, and exports.

Some larger systems are available as previews:

- **Cloud Saves and community:** available through the local backend preview.
- **Transport workbench:** source-backed and cached transport data is available across multiple categories. Roads and rail are the strongest public map paths; airports and ports feed overview context; mineral resources, energy, industry, and logistics remain workbench/preview families while coverage grows.
- **HGO runtime preview:** a developer/local preview for country identity, palette, flag, and raster-render validation.

<details>
<summary><strong>Complete Capability Matrix</strong></summary>

| Area | What you can do |
| --- | --- |
| Scenario maps | Start from Blank Map, Modern World, HOI4 1936, HOI4 1939, or TNO 1962. HGO 1936 appears as a developer/local preview. |
| Political editing | Repaint ownership and controller state, inspect split ownership, and work across ownership, controller, and frontline views. |
| Visual style | Tune oceans, borders, parent borders, physical regions, urban areas, city points, rivers, textures, day-night shading, and reference images. |
| Strategic presentation | Add legends, frontlines, operational lines, operation graphics, labels, and unit-counter style overlays. |
| Transport context | Explore roads and rail as the strongest public layers, plus airports, ports, mineral resources, energy facilities, industrial land, logistics hubs, and layer ordering through overview or workbench previews. |
| Export workflow | Export PNG/JPG presentation snapshots at 1x-4x scale, adjust image brightness/contrast/saturation, and manage layer order. |
| Project files | Save an editable project JSON with scenario, appearance, transport, strategic annotations, reference alignment, and export settings. |
| Community preview | In local backend mode, test account sessions, Cloud Saves, publishing, community downloads, comments, reports, and admin review tools. |
| Modding preview | In developer/local preview mode, use HGO runtime preview and palette tools to validate HOI4-style country identity, flags, colors, and rendering. |
| Localization | Use the interface in English or Simplified Chinese. |

</details>

<details>
<summary><strong>Data Sources and Provenance</strong></summary>

Scenario Forge combines public geographic and reference datasets with project-specific derived assets. The main source families include:

| Source | Used for |
| --- | --- |
| [Natural Earth](https://www.naturalearthdata.com/) | Base geography, countries, coastlines, and small-scale reference layers. |
| [geoBoundaries](https://www.geoboundaries.org/) | Administrative boundary reference data. |
| [GeoNames](https://www.geonames.org/) | Place names and settlement reference data. |
| [NOAA ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) | Global relief, bathymetry, and physical terrain context. |
| [NASA Black Marble](https://blackmarble.gsfc.nasa.gov/) | Night lights and city-light texture context. |
| [OpenStreetMap](https://www.openstreetmap.org/) | Roads, rail, facilities, and other transport/context features. |
| [Geofabrik](https://download.geofabrik.de/) | Regional OpenStreetMap extracts used for transport workbench data. |
| [Japanese MLIT road data (N06)](https://nlftp.mlit.go.jp/ksj/) | Japan road hardening and transport preview reference data. |

Detailed provenance appears in `data/source_ledger.json`, `.provenance.json` files under `data/`, transport source recipes under `data/transport_layers/`, and generated asset source records.

</details>

## Project Info

The project code and documentation are available under the **MIT License**. Third-party datasets and derived assets keep their original source terms and provenance records.

Maintained by **[@raederhans](https://github.com/raederhans)**.

If something breaks, looks wrong, or feels inconsistent, please open an issue:

- https://github.com/raederhans/scenario-forge/issues
