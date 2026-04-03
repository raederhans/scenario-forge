# Shared Editing Closure Implementation 2026-04-03

## Goal
- Close the remaining shared-editing gaps without changing the current one-click save UX.
- Make `scenario_mutations.json` the canonical editing input, including `district_groups`.
- Move TNO bundle work onto a formal build-session root with persisted state metadata.

## Steps
- [x] Step 1: Refactor save routes into `write mutation -> materialize -> publish` orchestration.
- [x] Step 1.1: Add `district_groups` to canonical mutation schema and materialize it from mutations.
- [x] Step 2: Introduce build-session helpers under `.runtime/build/scenario/<scenario_id>/<snapshot_hash>/`.
- [x] Step 2.1: Persist `scenario_build.lock.json` state with snapshot and stage/publish metadata.
- [x] Step 3: Route non-TNO `geo-locale` builders through checkpoint/session outputs instead of save-path direct writes.
- [x] Step 3.1: Migrate checked-in `tno_1962` canonical partial inputs.
- [x] Step 4: Update regression tests and run targeted unittest coverage.

## Notes
- `publish` remains explicit in save wrappers; it is no longer hidden inside materialization services.
- TNO `geo-locale` materialization still prepares startup checkpoint artifacts so the save wrapper can explicitly publish `startup-assets` without changing the current UI workflow.

## Verification
- `python -m py_compile` passed for all touched runtime, tool, and test files.
- Targeted `unittest` coverage passed for:
  - `tests.test_materialize_scenario_mutations`
  - `tests.test_scenario_materialization_service`
  - `tests.test_scenario_contracts`
  - `tests.test_migrate_tno_shared_editing_inputs`
  - `tests.test_publish_scenario_outputs`
  - `tests.test_publish_scenario_build`
  - `tests.test_dev_server`
  - `tests.test_scenario_build_session`
