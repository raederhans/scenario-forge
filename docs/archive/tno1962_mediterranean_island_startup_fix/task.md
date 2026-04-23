# TNO1962 Mediterranean / island startup anomaly fix

## Goal
- Make the first ready-time scenario chunk refresh commit successfully.
- Restore ATLISL real-island data contract in checked-in TNO outputs.
- Verify runtime, contracts, and rebuilt artifacts with the smallest stable change set.

## Scope
- `js/main.js`
- `js/core/scenario_post_apply_effects.js`
- `js/core/scenario/chunk_runtime.js`
- `tools/patch_tno_1962_bundle.py`
- existing targeted tests under `tests/`
- checked-in TNO outputs under `data/scenarios/tno_1962/`

## Constraints
- Keep startup shell contract unchanged.
- Use existing tests and existing rebuild pipeline.
- Main thread owns live tests and rebuild verification.