# 008 East Asia Expansion Plan (China, Japan, Korea, Taiwan)

## 1. China Level-2 (Prefecture) Data Source

Primary source: **geoBoundaries (gbOpen, ADM2 for CHN)**
- geoBoundaries provides ADM2 boundaries (second-order admin units) with CC BY 4.0 licensing and API-based download links.
- Use the API endpoint to fetch metadata and download URLs:
  - `https://www.geoboundaries.org/api/current/gbOpen/CHN/ADM2/`
- Prefer `simplifiedGeometryGeoJSON` from the API response for performance; fall back to `gjDownloadURL` if needed.
- Rationale: geoBoundaries is open-licensed and has standardized metadata + simplified versions for web rendering.

Backup source (if API is unavailable):
- geoBoundaries archival file list (CHN/ADM2) or a China-prefecture dataset such as `cn-atlas` (TopJSON/GeoJSON). If used, confirm licensing before adoption.

## 2. Geographic Bounds Update

- Current bounds: `EUROPE_BOUNDS = (-25.0, 30.0, 180.0, 83.0)`
- Required update: **lower ymin to include South China + Taiwan**.
- Recommended new bounds:
  - `EUROPE_BOUNDS = (-25.0, 10.0, 180.0, 83.0)`
- This ensures coverage for Hainan (~18°N), Taiwan (~22°N), and the full South China coastline.

## 3. Simplification Strategy

- China ADM2 is dense; aim for **simplified geometry + additional tolerance**:
  - Use geoBoundaries `simplifiedGeometryGeoJSON` when available.
  - Apply an additional `simplify(tolerance=0.01, preserve_topology=True)` in WGS84 if the dataset is still heavy.
- Keep Admin‑1 simplification unchanged for JP/KR/KP/TW (Natural Earth 10m admin‑1 already simplified).
- Consider a small‑polygon cull for micro‑islands (e.g., area threshold 200–500 km² in a projected CRS) if performance regresses.

## 4. Execution Steps (Python + Data Pipeline)

1. **Bounds**
   - Update `EUROPE_BOUNDS` ymin from `30.0` to `10.0` in `init_map_data.py`.

2. **Extension Countries (Admin‑1)**
   - Add JP, KR, KP, TW to `EXTENSION_COUNTRIES` (do **not** add CN here to avoid duplicate granularity).
   - Extend name fallback filter to include: `"Japan", "South Korea", "North Korea", "Taiwan"`.

3. **China Prefecture Loader**
   - Add a new function (e.g., `build_china_admin2()`):
     - Use requests to call geoBoundaries API endpoint and read `simplifiedGeometryGeoJSON` (or `gjDownloadURL`).
     - Read GeoJSON with geopandas; enforce EPSG:4326.
     - Standardize columns to `id`, `name`, `cntr_code`, `geometry`.
       - Suggested mapping (verify after download):
         - `id`: `shapeID` (or fallback: `shapeISO` + `shapeName`)
         - `name`: `shapeName`
         - `cntr_code`: constant `"CN"`
     - Apply extra simplification if needed.

4. **Hybrid Merge**
   - After `build_extension_admin1()` returns admin‑1 extensions, append China ADM2 features.
   - Ensure CN is not present in Admin‑1 extensions to avoid mixed granularity.

5. **Regenerate Outputs**
   - Run `python init_map_data.py` to rebuild `data/europe_*` + `data/europe_topology.json`.

6. **Locales**
   - Run `python tools/translate_manager.py` to update `data/locales.json` with new names.

7. **Frontend Additions**
   - Update `countryNames` and `countryPalette` in `js/app.js` for CN/JP/KR/KP/TW.

Notes:
- Natural Earth 10m Admin‑1 will cover Japan and both Koreas adequately.
- Taiwan may appear in Natural Earth Admin‑1; ensure it is included in the extension filter and the UI lists.
- geoBoundaries licensing: CC BY 4.0 requires attribution in documentation or UI credits.
