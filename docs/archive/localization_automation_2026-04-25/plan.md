# Localization Automation Plan

## Goal
- Run the localization pipeline for current unlocalized content.
- Focus on visible UI coverage and runtime local-state localization flow.
- Verify scenario geo override safety and only patch real regressions.

## Steps
- [completed] Re-read current localization pipeline entrypoints and prior automation memory.
- [completed] Audit UI sources and local-state merge path in parallel.
- [completed] Run targeted localization commands and collect fresh reports.
- [completed] Apply the smallest fix if fresh reports surface a real issue.
- [in_progress] Re-run targeted verification, update records, and close the run.

## Guardrails
- Main thread owns all live commands and tests.
- Keep changes minimal and scoped to localization or override correctness.
- Prefer audit-first; only regenerate `data/locales.json` when required by fresh evidence.
