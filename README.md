<p align="right">
  <a href="./README.md"><img src="https://img.shields.io/badge/English-111111?style=for-the-badge" alt="English"></a>
  <a href="./README.zh-CN.md"><img src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-2563eb?style=for-the-badge" alt="Chinese"></a>
</p>

# Scenario Forge

Create political maps that feel alive.

Scenario Forge is a scenario-first map workbench for alternate history, strategy modding, and geopolitical storytelling. It lets you switch between ready-made world states, repaint control and ownership, build overlays, tune presentation layers, and export a clean snapshot or a reusable project file.

**Live demo:** https://raederhans.github.io/scenario-forge/

## What you can do

- Jump between built-in baselines: **Blank Map**, **Modern World**, **HOI4 1936**, **HOI4 1939**, and **TNO 1962**.
- Work with scenario views such as **ownership**, **controller**, and **frontline** states.
- Save your work as a **project file**, then load it back without losing the core map state.
- Export the visible map as a **PNG** or **JPG** snapshot.
- Use built-in **palette packs** inspired by HOI4 Vanilla, Kaiserreich, The New Order, and Red Flood.
- Turn on extra context layers including **physical regions**, **urban areas**, **city points**, **rivers**, **water regions**, and **special zones**.
- Add map presentation details like **legends**, **operational lines**, **operation graphics**, and **unit-counter style overlays**.
- Switch the interface between **English** and **Chinese**.

## Why it matters

Most map workflows split your work across too many tools: one for painting, one for labels, one for exports, one for scenario state, and another for presentation polish.

Scenario Forge brings those jobs into one workspace. If you are building an alternate timeline, a strategy scenario, a mod concept, or a map-led presentation, you can move from idea to usable visual much faster.

## Who it is for

- Alternate-history creators
- HOI4, TNO, and Kaiserreich modders
- Scenario and campaign designers
- Geopolitical storytellers
- Map-first presenters, writers, and researchers

## Quick start

### Use it online

Open the live build:

- https://raederhans.github.io/scenario-forge/

### Run it locally

1. Build the data and start the local server:

   ```bat
   start_dev.bat
   ```

2. Faster local boot without rebuilding:

   ```bat
   start_dev.bat fast
   ```

3. Clean repro with caches and startup worker disabled:

   ```bat
   start_dev.bat fresh
   ```

## What is still in progress

Some parts of the app are intentionally not presented as finished:

- The **transport workbench** is only **partially complete**.
- The **Japan road preview** is the most developed transport sample right now.
- **Rail** is still in a shell / baseline stage.
- **Airport**, **Port**, **Mineral Resources**, **Energy Facilities**, and **Industrial Zones** are still waiting for deeper development.

If a feature is not fully wired yet, it should be treated as **in progress**, not production-ready.

## Major data sources

This is not a full source ledger. It is the short list of major upstream data families used by the project.

- Natural Earth: https://www.naturalearthdata.com/
- geoBoundaries: https://www.geoboundaries.org/
- GeoNames: https://www.geonames.org/
- NOAA ETOPO 2022: https://www.ncei.noaa.gov/products/etopo-global-relief-model
- NASA Black Marble: https://blackmarble.gsfc.nasa.gov/
- OpenStreetMap: https://www.openstreetmap.org/
- Geofabrik: https://download.geofabrik.de/
- Japanese MLIT road data (N06): https://nlftp.mlit.go.jp/ksj/

For more detailed provenance, see:

- `data/source_ledger.json`
- the `.provenance.json` sidecar files under `data/`

## License

The project code and documentation are available under the **MIT License**.

Third-party datasets and derived assets in the repository are still tied to their original sources and provenance records. This README intentionally keeps the source list short; the detailed trace lives in `data/source_ledger.json`.

## Maintained by

Maintained by **[@raederhans](https://github.com/raederhans)**.

## Bug reports

If something breaks, looks wrong, or feels inconsistent, please open an issue:

- https://github.com/raederhans/scenario-forge/issues

Helpful bug reports usually include:

- the scenario you were using
- your browser and OS
- the exact steps to reproduce the problem
- a screenshot or exported project file when relevant

## For contributors

If you want to work on the project itself, the shortest path is:

```bat
start_dev.bat
```

Useful follow-up commands:

```bat
build_data.bat
run_server.bat
```

Browser and regression tooling:

```bash
npm install
npm run test:e2e
```
