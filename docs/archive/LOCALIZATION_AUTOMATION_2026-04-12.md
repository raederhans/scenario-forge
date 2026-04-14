## Localization Automation 2026-04-12

### Plan
- Inspect localization pipeline and audit coverage with focus on UI and local state related paths.
- Run the localization scripts and capture current audit plus override-safety results.
- Apply the smallest safe fix only if a real unlocalized string or incorrect override is found.
- Re-run validation, then archive this note when the run is complete.

### Progress
- Confirmed the local-state localization path is runtime code, not a standalone folder: `js/core/scenario_localization_state.js` merges scenario city overrides plus `geo_locale_patch` into `state.locales.geo`.
- Ran `python tools/geo_key_normalizer.py`.
- Ran `python tools/i18n_audit.py`; result is clean for the requested focus areas: `ui_missing=0`, `uncovered_visible_ui=0`, `a11y_literals=0`, `dynamic_ui=0`, `scenario_geo_missing=0`, `scenario_metadata_missing=0`.
- Ran `python tools/build_tno_1962_geo_locale_patch.py --output .runtime/tmp/geo_locale_patch.check.json`; override safety stayed clean: `11260` safe copies, `84` manual overrides, `0` cross-base collisions, `0` omitted, `914` excluded.
- Ran `python -m unittest tests.test_i18n_audit tests.test_tno_geo_locale_patch -v`; all 12 tests passed.
- No code or locale fix was needed this run because no real unlocalized UI/local-state content or incorrect override surfaced.
- `python tools/translate_manager.py --network-mode off` was started but aborted after proving unusually slow on full `data/scenarios/**/*.json` scanning; it did not produce a repo update and the audit remained clean without it.
