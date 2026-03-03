# 006 Russia & Central Asia Expansion Plan

## 1. Diagnosis (Current Cutoff)

- **Hard clip at 70°E**: `EUROPE_BOUNDS = (-25.0, 34.0, 70.0, 72.0)` in `init_map_data.py:71`. This feeds `clip_to_europe_bounds()` (`init_map_data.py:383-407`), which is applied to NUTS, borders, admin1, ocean, land, rivers, urban, and physical layers (`init_map_data.py:787, 794, 797, 800, 807, 814, 822, 507, 569`). The max longitude of **70** truncates anything east of the Urals.
- **Explicit Ural truncation for Russia**: `build_extension_admin1()` clips RU with `ural_bbox = box(-180, -90, 60, 90)` (`init_map_data.py:530-535`). This forces Russia to stop at **60°E** even if broader bounds change.
- **Country inclusion list omits Central Asia**: `EXTENSION_COUNTRIES = {"RU", "UA", "BY", "MD"}` (`init_map_data.py:69`). Admin‑1 filtering uses this list (`init_map_data.py:517-520`), so KZ/UZ/TM/KG/TJ are excluded.
- **NUTS filter is Europe-only but not an east cutoff**: `filter_countries()` uses representative points with `reps.y >= 30` and `reps.x >= -30` (`init_map_data.py:160-163`). This does **not** cap eastward extent, so it is not the primary culprit.

## 2. Data Strategy

- **Admin‑1 source already appropriate**: `ne_10m_admin_1_states_provinces` is a global admin‑1 dataset; the code already pulls it (`ADMIN1_URL`). The missing eastern regions are the result of filtering, not data absence.
- **Add ISO codes** to the admin‑1 inclusion list: **RU, KZ, UZ, TM, KG, TJ**. Keep existing RU/UA/BY/MD.
- **Fallback name filters**: If ISO fields are inconsistent, add names for the new countries in the `name_col` inclusion set (e.g., "Kazakhstan", "Uzbekistan", "Turkmenistan", "Kyrgyzstan", "Tajikistan").

## 3. Geometry Strategy (Simplification)

- **Recommended tolerance for eastern Admin‑1**: `0.04` degrees (WGS84). This keeps oblast shapes but dramatically reduces Arctic coastline vertex counts.
- Apply this tolerance only to the extension admin‑1 subset (RU + Central Asia) or create a new constant (e.g., `SIMPLIFY_ADMIN1_EAST = 0.04`) so EU Admin‑1 (if any) and NUTS‑3 aren’t degraded.
- Optional: slightly increase background/ocean simplification for the expanded bounds (e.g., `SIMPLIFY_BACKGROUND` → `0.05`) if render time regresses.

## 4. Step‑by‑Step Execution Plan (Python)

1. **Expand the region bounds constant**: Replace `EUROPE_BOUNDS` with a wider extent that includes the Pacific. Example target: `(-25.0, 30.0, 180.0, 83.0)` to capture full Russia + Central Asia.
2. **Rename and reuse the bounds helper**: Consider renaming `clip_to_europe_bounds()` to `clip_to_region_bounds()` for clarity, then update all call sites.
3. **Remove the Ural truncation**: In `build_extension_admin1()`, delete the RU‑only `ural_bbox` clipping block (`init_map_data.py:530-535`). This is the direct 60°E cutoff.
4. **Expand `EXTENSION_COUNTRIES`**: Add **KZ, UZ, TM, KG, TJ** to the set. Update the `name_col` inclusion list for redundancy if ISO fields are missing in some rows.
5. **Adjust simplification for eastward admin‑1**: Apply `SIMPLIFY_ADMIN1_EAST = 0.04` to the admin‑1 extension output (preferably only to RU/Central Asia). Keep `SIMPLIFY_NUTS3` unchanged.
6. **Regenerate data outputs**: Re‑run `init_map_data.py` to rebuild `data/*.geojson` and `data/europe_topology.json` with the expanded bounds.
7. **Projection / canvas update (JS)**: The current `projection.fitSize([width, height], landData)` in `js/app.js` will shrink the map once bounds expand. Plan for a manual override if the UI becomes too wide:
   - Conceptual center: **[80°E, 58°N]**
   - Conceptual scale: **~0.45× current** (longitude span grows from ~95° to ~205°)
   - Option: switch to `projection.fitExtent([[pad, pad], [width-pad, height-pad]], landData)` with horizontal padding to keep labels legible.
8. **Quick visual QA**: Confirm that the coastline is intact around Chukotka and that Central Asian borders are present at Admin‑1 granularity.
