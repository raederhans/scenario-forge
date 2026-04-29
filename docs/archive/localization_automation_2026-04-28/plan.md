# Localization Automation Plan

## Goal
- Run the current localization checks for unlocalized content.
- Focus on visible UI coverage and runtime local-state override safety.
- Rebuild translation payloads only if fresh evidence shows a real gap.

## Steps
- [completed] Re-read automation memory, project lessons, and current localization entrypoints.
- [completed] Audit UI and local-state localization surfaces with `tools/i18n_audit.py`.
- [completed] Rebuild the TNO geo locale patch for override-safety verification.
- [completed] Attempt a fresh `tools/translate_manager.py --network-mode off` sync run.
- [completed] Re-run targeted unit coverage and archive the result.

## Guardrails
- Keep the run read-mostly unless fresh evidence requires a localization fix.
- Treat `js/core/scenario_localization_state.js` merge order as the source of truth for override safety.
- Keep all runtime artifacts under `.runtime/tmp/`.
