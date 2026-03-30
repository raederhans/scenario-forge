# QA-037: run_server Default Detail Source and i18n Placeholder Repair

## Summary
- Changed default detail source from `na_v1` to `na_v2`.
- Removed `[TODO] ...` placeholder publishing from `locales.json`.
- Added optional targeted machine translation with network auto-detect.
- Added atomic locale writes to avoid leaving `data/locales.json` half-written.

## Root Causes
1. `run_server.bat` opened `/`, but frontend default detail source still resolved to `na_v1`.
2. `tools/translate_manager.py` published missing geo translations as literal `[TODO] <name>`.
3. The previous batch workflow could leave `data/locales.json` in a broken intermediate state if a long-running write was interrupted.

## Code Changes
- `js/core/data_loader.js`
  - Default detail source now resolves to `na_v2`.
  - Fallback chain is now `requested -> na_v2 -> na_v1 -> legacy_bak`.
- `js/ui/sidebar.js`
  - Province/region buttons now use `t(group.label, "geo") || group.label`.
- `tools/translate_manager.py`
  - Added placeholder stripping and missing-like detection.
  - Missing geo names now fall back to English instead of `[TODO]`.
  - Added `--auto-country-codes visible-missing`.
  - Added `--network-mode off|auto|on`.
  - Locale writes are now atomic: write `*.tmp` then replace target.
- `tools/i18n_audit.py`
  - Audit now reports `geo_missing_like_count` and `geo_todo_marker_count`.
- `init_map_data.py`
  - Default build runs offline translation sync only.
  - Optional machine translation pass is controlled by `MAPCREATOR_BUILD_MT=auto|on`.
- `sync_i18n.bat --machine`
  - Now runs targeted machine translation with `--network-mode auto --auto-country-codes visible-missing`.

## Verification

### Browser
- URL: `/`
- Console confirmed:
  - `Loaded detail(na_v2) topology data/europe_topology.na_v2.json (11120 features).`
  - `Topology bundle mode: composite. primary=199, detail=11120`
  - `Composite coverage: countries detail=172, primaryFallback=26, total=197`
- Only remaining console error:
  - blocked Google Fonts request (`ERR_BLOCKED_BY_CLIENT`)

### Build
- `python init_map_data.py`
  - exit code: `0`

### Locale file
- `data/locales.json`
  - valid JSON
  - literal `[TODO]` markers: `0`

### Audit
- `python tools/i18n_audit.py`
  - `geo_missing_like=16487`
  - `todo_markers=0`

## Current Behavior
- Default page load shows latest detail bundle `na_v2`.
- User-facing untranslated geo names now display English fallback instead of `[TODO]`.
- Targeted machine translation can reduce visible missing coverage without making build depend on network by default.

## Remaining Gaps
1. `geo_missing_like` is still high because the locale file had to be rebuilt from current topology/seeds and not all legacy geo names were repopulated.
2. The targeted machine translation selection is currently broader than ideal after the locale rebuild, because many countries now qualify as “visible missing”.
3. Some well-known country names such as `Poland` and `Germany` currently fall back to English because they are absent from the rebuilt `locales.geo`.

## Recommended Next Follow-up
1. Restore baseline geo translations for canonical country names and major admin1 labels from seeds or a preserved locale snapshot.
2. Narrow `visible-missing` country detection so it does not expand to nearly global scope after a sparse locale rebuild.
