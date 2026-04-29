# TNO 1962 Province Voids Plan

## Goal
- Repair confirmed TNO 1962 land/province defects with the shortest root-cause path.

## Work Plan
- [x] Freeze context and current repo state.
- [x] Fix Russia Arctic coverage generation so current runtime Arctic fragments are available for visible political fill.
- [x] Keep Arctic fragments out of normal user interaction unless explicitly promoted later.
- [x] Add/adjust tests so the Arctic regression is caught by data contracts.
- [x] Fix `IN_ADM2_76128533B2782141712775` display naming through the existing geo locale path.
- [x] Treat `KAZ-3197` interior hole as water and add a focused contract if current water styling misses it.
- [x] Use browser inspection and focused geometry probes for Somalia, Suriname, and southern Uganda visual reproduction.
- [x] Run targeted validators/tests and record outcomes.
- [ ] Run final review/self-check and archive the task folder when complete.

## Validation
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962 --strict`
- `python tools/validate_tno_water_geometries.py`
- Focused Python/Node unit tests touched by TNO bundle, chunk assets, and geo locale changes.
- One light browser check for the visible map symptoms.

## Current Decision
- Arctic fragments should be visible for political coverage.
- Arctic fragments should remain non-interactive for now.
- Arctic ownership should come from existing authored TNO source rules or crosswalks.
- `KAZ-3197` hole should remain a hole and be rendered/classified as water.
- Somalia horn, Suriname, and southern Uganda have no confirmed land-minus-political coverage hole in the current data probes.
