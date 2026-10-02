# Handoff and ownership

Checkout: `C:/Users/raede/.codex/worktrees/river-paint-integration/mapcreator`.
Primary checkout and all older evidence worktrees remain untouched.

## Parallel lanes

- `wave5_seams`: generator/joint-noding code and targeted generator tests; `.runtime/rv5-seams`; sole owner of its offline builds and contour checks. No approval-manifest changes.
- `wave5_coverage`: new survey script/tests, wave5 candidate selections and coverage report; `.runtime/rv5-coverage`; sole owner of its survey/build/atlas processes. Capture baseline generator for reproducibility while the seam lane edits.
- `wave5_compact`: compact transport encoder/decoder, loader integration and new tests; `.runtime/rv5-transport`; no canonical data/manifest changes.
- Root: all integration, data admission/registry/catalog, navigation metadata, verification routing, browser processes, Pages builds and Git mutations. `.runtime/rv5`; browser output `.runtime/tests/playwright/rv5-*`. Ports will be checked and recorded before use.

Children do not commit/push. Unique output directories permit parallel independent offline checks; no shared long-running process may have two owners.

## Integration checkpoint

The 384-parent regional candidate failed the full-map gate: one extra neighbor pair, nine internal seam mismatches and 22 new ambiguous segments. Root excluded the eight newly proposed parents named in `.runtime/rv5/joint-held.json`, retaining all original 302. `wave5-reviewed.json` is the final 376-parent / 1,164-cell / 111-support selection. Full-map verdict PASS across 24,201 neighbor pairs; invalid rings 0 and existing ambiguity count 550 unchanged. Reports: `.runtime/rv5/reviewed-contours.json`, source prepared input and build audit adjacent.

Canonical file `modern_world_wave5.json`: 2,357,372 bytes. Runtime download `modern_world_wave5.transport.json`: 1,423,165 bytes, within unchanged budget. Original three packs retained. Root's combined Node checks passed 69/69 after admission; Python catalog/transport/coverage checks running separately.

Root owns the forthcoming Playwright commands on checked-free localhost port 8009, `MAPCREATOR_DEV_PORT=8009`, `PLAYWRIGHT_REUSE_EXISTING_SERVER=0`, one worker/retries 0. Per-case logs `.runtime/rv5/e2e-*.log`, output `.runtime/tests/playwright/rv5-*`; existing quick 120-second case budgets retained. Playwright owns automatic server teardown. Success means actual new default load/edit/save/export, eight newly admitted river representatives and smallest picker, and prior 6/12/302-parent import scope pass without page errors. A reproducible product failure stops that case for diagnosis; no timeout or console allowance expansion.

All source browser cases passed. Root built `.runtime/pw5` (822.68 MiB), refreshed only tracked dist mirrors plus the new decoder, and ran publication tests 65/65 PASS with `SCENARIO_FORGE_PAGES_ARTIFACT_ROOT=.runtime/pw5`. Root-owned static server on port 8008 served this artifact for three browser cases: real default load/edit/save/export, Canvas and old Wave 3 roundtrip, all PASS in60.0seconds. Servers8008/8009 closed. Affected adaptive execution completed exit0 in `.runtime/rv5/adaptive.json/.log`; no live processes remain. Ready for commit, push and protected PR workflow.

## Baseline facts

302 parents / 905 cells / 108 supports. Raw download 1,993,389 characters, limit 2,000,000. Model limits remain 512 parents, 8,192 cells and 250,000 coordinates. Old pilot and wave2 and wave3 saved projects must remain self-contained and authenticated. Five held parents and exact original joint failures are documented in `../river-wave3/integration.md`.
