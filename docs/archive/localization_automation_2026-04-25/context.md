# Localization Automation Context

## 2026-04-25
- Created recurring-task workspace for localization automation.
- Initial focus: `tools/i18n_audit.py`, `tools/translate_manager.py`, and `js/core/scenario_localization_state.js`.
- Prior recurring runs were clean after audit-first flow; full locale rebuild is only needed when fresh evidence exposes a gap.
- Current repo is dirty in unrelated performance files; localization work must avoid those edits.
- Fresh run results:
  - `python tools/i18n_audit.py` => `ui_missing=0`, `ui_english_fallback=0`, `uncovered_visible_ui=0`, `a11y_literals=0`, `dynamic_ui=0`, `scenario_geo_missing=0`, `scenario_metadata_missing=0`.
  - `python tools/build_tno_1962_geo_locale_patch.py --output .runtime/tmp/geo_locale_patch.check.json` => `11344` feature locales, `11260` safe copies, `84` manual overrides, `937` reviewed exceptions, `0` cross-base collisions, `0` omitted, `927` excluded.
  - `python -m unittest tests.test_i18n_audit tests.test_tno_geo_locale_patch -v` => `17/17` passed.
- This run has not needed `tools/translate_manager.py` or `data/locales.json` regeneration so far because fresh audit stayed clean.
- Subagent review findings:
  - Runtime local-state override order is safe because explicit `scenarioGeoPatch` wins both in sync-patch generation and in final merge order.
  - A small extractor drift existed: `tools/translate_manager.py` missed `data-i18n-alt` even though `tools/i18n_audit.py` already counted it.
- Fix applied:
  - Extended `DECLARATIVE_UI_ATTR_RE` in `tools/translate_manager.py` to include `data-i18n-alt`.
  - Extended `tests/test_translate_manager.py` so `collect_ui_keys()` must retain `data-i18n-alt` copy.
- Post-fix verification:
  - `python -m unittest tests.test_translate_manager tests.test_i18n_audit tests.test_tno_geo_locale_patch -v` => `28/28` passed.
  - `data/locales.json` timestamp stayed unchanged in this run, so the extractor fix did not require a fresh locale payload rewrite for current repo contents.
