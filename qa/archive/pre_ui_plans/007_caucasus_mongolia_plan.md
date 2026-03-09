# 007 Caucasus & Mongolia Expansion Plan

## 1. Bounding Box Analysis

- `EUROPE_BOUNDS = (-25.0, 30.0, 180.0, 83.0)` in `init_map_data.py:71` currently clips all layers via `clip_to_europe_bounds()`.
- **Latitude coverage is already sufficient**: Caucasus (~38–43°N) and Mongolia (~41–52°N) are above the 30°N minimum, so no further southward expansion is required.
- Note: `filter_countries()` applies `reps.y >= 30` and `reps.x >= -30` (`init_map_data.py:160-163`) but this is **only for NUTS** and does not affect Admin‑1 extension countries.

## 2. Inclusion List (Admin‑1 Extension)

Add the following ISO A2 codes to `EXTENSION_COUNTRIES` in `init_map_data.py:69`:
- **GE, AM, AZ, MN** (Georgia, Armenia, Azerbaijan, Mongolia)

Recommended full set after update:
`{RU, UA, BY, MD, KZ, UZ, TM, KG, TJ, GE, AM, AZ, MN}`

Also expand the name fallback filter in `build_extension_admin1()` (`init_map_data.py:517-520`) to include:
- `"Georgia", "Armenia", "Azerbaijan", "Mongolia"`

## 3. Interaction Layer (Names + Colors)

**Locales / names**
- `data/locales.json` is generated from `data/europe_topology.json` by `tools/translate_manager.py` (not from a hardcoded country list).
- After regenerating topology, run `python tools/translate_manager.py` to pick up new names.
- Optional: add seed translations for new country/province names in `tools/geo_seeds.py` to avoid `[TODO]` placeholders in the zh locale.

**UI list + default colors**
- The right‑sidebar list and default palette use `countryNames` and `countryPalette` in `js/app.js` (see `js/app.js:167+`).
- Add GE/AM/AZ/MN there to ensure these countries appear in the UI and receive default colors.

## 4. Execution Steps (Python)

1. **Update `EXTENSION_COUNTRIES`** to include GE/AM/AZ/MN (`init_map_data.py:69`).
2. **Update the name fallback set** in `build_extension_admin1()` to include the four country names (`init_map_data.py:517-520`).
3. **Regenerate data** by running `python init_map_data.py` (updates `data/europe_*` and `data/europe_topology.json`).
4. **Refresh locales** by running `python tools/translate_manager.py` so new Admin‑1 names appear in `data/locales.json`.
5. **(Optional Mongolia granularity)** If Mongolia Admin‑1 is unusable:
   - Extract Mongolia from `BORDERS_URL` (Admin‑0) and replace MN features inside `build_extension_admin1()` before concatenation.
   - Keep `cntr_code = "MN"` and ensure `id` and `name` fields exist.

Notes:
- Natural Earth `ne_10m_admin_1_states_provinces` is global; it typically includes GE/AM/AZ/MN, so Admin‑1 should be available.
- No bounds changes required unless later expansions go below 30°N.
