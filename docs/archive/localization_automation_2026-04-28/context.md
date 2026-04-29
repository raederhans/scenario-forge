# Localization Automation Context

## 2026-04-28
- Reconfirmed the runtime local-state path: [`C:\Users\raede\Desktop\dev\mapcreator\js\core\scenario_localization_state.js`](C:\Users\raede\Desktop\dev\mapcreator\js\core\scenario_localization_state.js) merges `baseGeoLocales`, synchronized city-name patches, and explicit `scenarioGeoPatch` into `state.locales.geo`, with explicit patch entries applied last.
- Fresh `python tools/i18n_audit.py --json-out .runtime/tmp/i18n_audit_2026-04-28.json --markdown-out .runtime/tmp/i18n_audit_2026-04-28.md` stayed clean:
  - `ui_missing=0`
  - `ui_english_fallback=0`
  - `uncovered_visible_ui=0`
  - `a11y_literals=0`
  - `dynamic_ui=0`
  - `scenario_geo_missing=0`
  - `scenario_metadata_missing=0`
- Fresh `python tools/build_tno_1962_geo_locale_patch.py --output .runtime/tmp/geo_locale_patch.check.json` stayed clean:
  - `11344` feature locales
  - `11260` safe copies
  - `84` manual overrides
  - `937` reviewed exceptions
  - `0` cross-base collisions
  - `31` split-clone safe copies
  - `0` omitted
  - `927` excluded
- A full `python tools/translate_manager.py --network-mode off` sync was started with audit/report outputs, then manually stopped after extended no-output full-scan behavior. This matches the older pattern where the audit stays clean while full sync remains expensive.
- Targeted verification passed:
  - `python -m unittest tests.test_translate_manager tests.test_i18n_audit tests.test_tno_geo_locale_patch -v`
  - `28/28` tests passed
- No repo code or locale payload change was required in this run.

## Notes
- The repo is still dirty in unrelated performance work. This automation run stayed scoped and did not touch those files.
- The useful artifacts from this run are:
  - `.runtime/tmp/i18n_audit_2026-04-28.json`
  - `.runtime/tmp/i18n_audit_2026-04-28.md`
  - `.runtime/tmp/geo_locale_patch.check.json`
