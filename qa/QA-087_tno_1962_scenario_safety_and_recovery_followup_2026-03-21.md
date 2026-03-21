# QA-087 TNO 1962 Scenario Safety And Recovery Follow-up

**Date**: 2026-03-21  
**Status**: Implemented and validated  
**Scope**: `tno_1962` scenario safety, rollback recovery, project schema symmetry, publish/checkpoint strict gating  
**Constraints**: Do not rewrite `data/scenarios/tno_1962`; do not touch renderer perf hot paths in `js/core/map_renderer.js` or `js/core/state.js`

---

## 0) Executive Summary

This follow-up is not a renderer performance report.
It closes a different class of defects exposed during the recent `tno_1962`
workflow:

- project roundtrip could silently lose scenario controller overrides
- baseline mismatch acceptance was not persisted
- scenario apply rollback was only best-effort and could leave the runtime in a
  half-restored state
- publish safety relied on weak assumptions and did not enforce strict bundle
  contracts before copying checkpoint data into a scenario directory

The implemented repair splits the problem by layer:

1. **project schema symmetry**
   - export/import now preserves `scenarioControllersByFeatureId`
   - mismatch acceptance is persisted as `scenario.importAudit`
2. **runtime recovery hardening**
   - scenario apply now validates runtime consistency after apply
   - rollback restore is followed by another consistency check
   - fatal recovery now locks further scenario operations until reload
3. **publish safety relocation**
   - strict bundle validation now gates checkpoint/publish paths
   - current checked-in authoring data is no longer forced through strict repo
     validation

This work intentionally did **not**:

- rebuild or republish `data/scenarios/tno_1962`
- change the restored authoring baseline
- address rollback snapshot memory cost
- address renderer or zoom performance

---

## 1) Positioning And Boundary

### 1.1 What this report is

This is a `tno_1962` scenario correctness and recovery follow-up.
It documents reliability work in the scenario system.

### 1.2 What this report is not

This report does **not** cover:

- zoom interaction
- exact refresh cost
- partial political repaint
- path warmup
- any renderer-side performance tuning

Those topics remain under:

- [QA-086_tno_1962_runtime_performance_progress_archive_2026-03-20.md](/C:/Users/raede/Desktop/dev/mapcreator/qa/QA-086_tno_1962_runtime_performance_progress_archive_2026-03-20.md)

---

## 2) Trigger And Context

### 2.1 Trigger event

The immediate trigger was a failed scenario-data publish workflow that
overwrote local `tno_1962` authoring data.

That incident exposed two different reliability gaps:

- **publish safety gap**
  - checkpoint/publish flow did not hard-stop on strict bundle mismatch
- **runtime recovery gap**
  - scenario rollback handling assumed restore would succeed and left the UI
    operable even when state integrity could no longer be trusted

### 2.2 Authoring baseline policy for this round

This round explicitly treated the restored `data/scenarios/tno_1962` directory
as read-only authoring state.

No scenario data files were rebuilt or republished.

Confirmed untouched paths for this repair:

- `data/scenarios/tno_1962/*`
- `js/core/map_renderer.js`
- `js/core/state.js`

---

## 3) Implemented Changes

### 3.1 Project schema symmetry

Implemented in:

- `js/core/file_manager.js`
- `js/ui/sidebar.js`

Changes:

- added top-level `scenarioControllersByFeatureId` to exported project files
- normalized imported `scenarioControllersByFeatureId` as:
  - cloned object when present
  - `null` when absent, to distinguish legacy project files from an explicit
    empty map
- added `scenario.importAudit` normalization and export support
- when importing a legacy project without
  `scenarioControllersByFeatureId`, the loader now keeps the baseline
  controllers established by `applyScenarioById()` instead of replacing them
  with an empty object

Impact:

- controller overrides now survive save/load roundtrip
- legacy scenario project files no longer silently flatten frontline state

### 3.2 Baseline mismatch audit persistence

Implemented in:

- `js/ui/sidebar.js`
- `js/core/file_manager.js`
- `js/core/scenario_manager.js`

Changes:

- when a project import hits `baseline_mismatch` and the user chooses to
  continue, the following audit object is recorded:
  - `scenarioId`
  - `savedVersion`
  - `currentVersion`
  - `savedBaselineHash`
  - `currentBaselineHash`
  - `acceptedAt`
- that audit is written back on export as `scenario.importAudit`
- normal scenario apply and clear paths reset `scenarioImportAudit` to avoid
  stale mismatch metadata leaking into unrelated sessions

Impact:

- mismatch acceptance is no longer ephemeral UI state
- exported project files preserve evidence that the user chose to load against
  a non-matching scenario baseline

### 3.3 Scenario apply / rollback hardening

Implemented in:

- `js/core/scenario_manager.js`
- `js/ui/sidebar.js`

Changes:

- added runtime consistency validation after apply and after rollback
- added explicit fatal recovery state and `SCENARIO_FATAL_RECOVERY` error code
- when rollback restore throws, the system:
  - records fatal recovery
  - surfaces an error toast
  - locks scenario interactions until reload
- when rollback restore succeeds but consistency validation fails, the system
  does the same fatal lock instead of pretending recovery succeeded
- fatal lock now blocks:
  - apply scenario
  - reset scenario
  - clear scenario
  - scenario view mode toggle
  - sidebar owner/controller editing paths

Impact:

- a failed rollback is no longer treated as a recoverable nuisance
- once the scenario state becomes untrustworthy, the user is prevented from
  compounding corruption through more actions

### 3.4 Strict contract moved to publish/checkpoint boundary

Implemented in:

- `tools/check_scenario_contracts.py`
- `tools/patch_tno_1962_bundle.py`

Changes:

- `check_scenario_contracts.py` now has two modes:
  - default authoring-safe mode
  - `--strict` publish-ready bundle validation
- strict mode checks:
  - owners/controllers/cores keyset equality
  - `manifest.summary.feature_count == len(owners)`
  - every `cores` value is an array
  - runtime political topology may only exceed the feature maps with allowed
    runtime-only shell fallback IDs
- `write_bundle_stage()` now calls strict checkpoint validation before
  publishing `scenario_data` or `all`
- strict validation failure now aborts publish before any scenario data copy
  occurs

Impact:

- strict gating now protects the place where destructive publish can happen
- the current restored authoring directory is no longer incorrectly treated as
  a repo-wide strict-validation blocker

---

## 4) Why The Old Fallback Failed

### 4.1 Root cause 1: rollback was best-effort, not a controlled state machine

The earlier `applyScenarioBundle()` error path attempted rollback inside a
`catch`, but rollback restore failure was only logged:

- restore failure went to `console.error`
- the original apply error was rethrown
- no higher-level state transition marked the runtime as unsafe

That meant the system had no authoritative answer to the question:

- is the scenario state still usable after rollback failure?

In practice, the UI behaved as if the answer were "probably yes", which was
wrong.

### 4.2 Root cause 2: no post-apply or post-rollback integrity check

The old path assumed:

- if apply finished, the scenario state was coherent
- if rollback restore returned, the old state was coherent

Neither assumption was verified.

This allowed silent corruption modes such as:

- active scenario id out of sync with manifest
- missing or empty baseline hash under an active scenario
- owner/controller state maps present but no longer meaningful
- feature lookup functions returning unusable ownership/controller results

### 4.3 Root cause 3: no fatal lock boundary

Even after recovery uncertainty, the system still allowed:

- new scenario applies
- scenario exit/reset
- view mode switching
- project import with active scenario context
- frontline / ownership edits

That turned one recovery failure into a state-amplification hazard.

### 4.4 Root cause 4: schema asymmetry disguised state loss as runtime failure

Before this round, controller overrides were not part of the stable project
roundtrip contract.

That created a misleading failure mode:

- the user could save a project in a split-frontline scenario
- re-import it
- see lost controller state
- and reasonably conclude scenario recovery was broken

Part of the “recovery problem” was therefore not rollback at all, but missing
schema symmetry.

### 4.5 Root cause 5: publish safety was enforced at the wrong layer

Before this round, strict scenario correctness was not used as a hard gate on
the publish checkpoint boundary.

That allowed the most dangerous class of operation:

- copying incomplete or mismatched bundle state into authoring directories

This is not a runtime fallback problem.
It must be stopped before the publish copy occurs.

---

## 5) Evidence And Validation

### 5.1 Commands executed

Python validation:

- `python -m unittest tests.test_scenario_contracts`
- `python -m unittest tests.test_tno_bundle_builder`

Browser validation:

- `node node_modules/@playwright/test/cli.js test tests/e2e/project_save_load_roundtrip.spec.js --reporter=list --workers=1`
- `node node_modules/@playwright/test/cli.js test tests/e2e/scenario_apply_resilience.spec.js --reporter=list --workers=1`

Result:

- all listed commands passed

### 5.2 Covered scenarios

Completed coverage in the automated suite:

- controller override export/import roundtrip
- legacy project import without `scenarioControllersByFeatureId`
- persisted `scenario.importAudit` after accepted baseline mismatch
- rollback restore failure enters fatal recovery
- rollback consistency failure enters fatal recovery
- strict bundle validation failure blocks publish before scenario data copy

### 5.3 Runtime artifacts

Relevant screenshots:

- [scenario_apply_resilience.png](/C:/Users/raede/Desktop/dev/mapcreator/.runtime/browser/mcp-artifacts/screenshots/scenario_apply_resilience.png)
- [scenario_apply_fatal_restore_failure.png](/C:/Users/raede/Desktop/dev/mapcreator/.runtime/browser/mcp-artifacts/screenshots/scenario_apply_fatal_restore_failure.png)
- [scenario_apply_fatal_consistency_failure.png](/C:/Users/raede/Desktop/dev/mapcreator/.runtime/browser/mcp-artifacts/screenshots/scenario_apply_fatal_consistency_failure.png)

### 5.4 Representative implementation touch points

Core symbols introduced or materially changed:

- `normalizeScenarioImportAudit(...)`
- `validateScenarioRuntimeConsistency(...)`
- `enterScenarioFatalRecovery(...)`
- `SCENARIO_FATAL_RECOVERY`
- `validate_publish_bundle_dir(...)`

Relevant paths:

- `js/core/file_manager.js`
- `js/core/scenario_manager.js`
- `js/ui/sidebar.js`
- `tools/check_scenario_contracts.py`
- `tools/patch_tno_1962_bundle.py`

---

## 6) Risks And What Was Deliberately Left Out

This repair did **not** address:

- rollback snapshot memory and clone cost
- renderer or zoom performance
- automatic cleanup of current `tno_1962` authoring inconsistencies such as:
  - controller-only features
  - core-only features

Strict gating now protects publish checkpoints, but it does not rewrite the
authoring directory to make those mismatches disappear.

That separation is intentional.

---

## 7) Recommended Next Hardening Slice

### 7.1 Promote recovery to an explicit state machine

Instead of a loose combination of booleans and exceptions, introduce a small
recovery lifecycle:

- `healthy`
- `apply_in_flight`
- `rollback_in_flight`
- `fatal_locked`

This would make control flow and UI behavior easier to reason about and test.

### 7.2 Expand fatal recovery diagnostics

Current fatal recovery stores useful information, but the next step should make
the object explicitly diagnostic-first:

- phase
- scenario id
- root error
- rollback error
- consistency failures
- recorded timestamp

### 7.3 Add recovery telemetry output

Recommended additions:

- structured console logging
- in-memory last-failure snapshot for debugging
- optional export to a machine-readable QA/debug artifact under `.runtime/`

### 7.4 Add publish dry-run entrypoint

The next safety improvement on the builder side should be:

- validate checkpoint strictly
- emit report
- do not copy anything into `data/scenarios/...`

This is useful both for manual release checks and CI.

### 7.5 Surface mismatch-import state in UI

Persisting `scenario.importAudit` into project files solves traceability, but
the user can still miss that they are operating on a mismatch-accepted import.

The next follow-up should add a stable UI signal in scenario status or audit
hint so that mismatch-import state remains visible during the active session.

---

## 8) Bottom Line

The old fallback failed because it mixed together:

- best-effort rollback
- no integrity verification
- no fatal lock
- schema asymmetry
- and weak publish boundary checks

This round repaired the failure at the right layers:

- runtime state now validates and locks hard when recovery is not trustworthy
- project schema now roundtrips controller state and mismatch acceptance
- publish now has a strict gate before destructive copy

The scenario system is therefore materially safer than before, even though
performance work and rollback memory optimization remain separate follow-up
tracks.
