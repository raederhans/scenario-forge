# Review Findings Fix Context

## 2026-04-29

- Review feedback was verified against live code before editing.
- `flushPending` has prior lessons: ready can seed pending work, and flush itself should keep the meaning of flushing pending work. The fix should allow normal scheduled refreshes to start without making idle settle refresh every time.
- Manifest byte_size is now a runtime selection cost input, so checked-in manifest values must match the checked-in files.
- Perf and benchmark fixes are contract-level changes, so targeted unittest coverage is required.
- Fixed normal scheduled chunk refresh to start after its timer, while idle flush keeps requiring pending work.
- Reconciled checked-in `byte_size` values for `hoi4_1939` and `tno_1962`; added a manifest-to-file-size contract.
- Repeated zoom probes now carry final `activeScenarioId`; metric trust uses actual scenario fields.
- Perf gate now validates current gate scenario summaries before baseline comparison.
- Targeted verification passed: `node --test tests/scenario_chunk_contracts.test.mjs`, `python -m unittest tests.test_scenario_chunk_refresh_contracts -q`, `python -m unittest tests.test_scenario_chunk_assets -q`, `python -m unittest tests.test_perf_gate_contract -q`.
