# Quick-fill hierarchy: phases 1 to 3

## Scope and compatibility

Base: `5f72e2e3cf037e30652cf8d27747ff4974e85f43`, including the bulk-preview/deferred-refresh improvements. No geometry, sovereignty, owner assignments, or existing legacy group IDs are replaced. No runtime spatial join or new frontend dependency is introduced.

### Phase 1: semantic fill contract

`js/core/quick_fill_hierarchy.js` is the independent semantic membership resolver used by `fill_target_policy.js`. It caches immutable payloads by identity and reads live ownership/hydration separately. Border visibility thresholds are not fill eligibility thresholds. Normalized scenario `tags`, legacy `countries`, and repeated normalization are handled explicitly; conflicting memberships fail closed. The border resolver consumes the same tag/legacy adapter.

A valid singleton remains a singleton. Missing, conflicting, stale, unverified, and incompletely loaded groups do not become country batches. Only an explicit `parent_available: false` contract can fall back to country. Explicit country means the entire current scenario owner, with incomplete hydration rejected. Existing single-click country semantics are unchanged.

TNO's default scenario-only parent policy is preserved. Named `level:*` geographic editing groups are an explicit user choice, intersected with current ownership; they do not assert historical administration. The dropdown is available in scenario visual/subdivision mode, not sovereignty mode. Selected levels survive snapshot restoration and are never silently rewritten because another inspected country lacks the level.

Project JSON export/import also preserves named levels. The existing case-insensitive legacy scope normalization remains supported. `tests/quick_fill_project_roundtrip.test.mjs` first reproduced the former reset-to-parent bug, then passed with the shared scope normalizer.

Immediate first-click feedback is retained. A recognized double-click coalesces its leading leaf-color history entry into the batch for one-step undo/redo. Exact leading-click timestamp, color, scenario and before/after continuity prevent unrelated/no-op leading clicks from absorbing older edits. The browser's recognized gesture remains atomic even when rendering delays event dispatch; a separate wall-clock cutoff must not split it.

### Phase 2: inspectable support audit

Run `npm run audit:quick-fill`. Outputs are `.runtime/reports/generated/quick-fill-support.{json,md}`. The audit uses the production resolver and political-interaction exclusion policy against default and all three scenario snapshots. It distinguishes helpers, raw/interactive leaves, singleton parents, unavailable levels, owner-scoped membership, missing IDs, conflicts and duplicate IDs. Scenario coarse chunks are used as complete ID inventories, not viewport subsets. This is a metadata/resolver audit, not a country-by-country pointer replay.

At this base snapshot: default CN 2391, FR 320, DE 401, US 914, GB 191, IN 718, RU 2329, CA 343, MX 300, JP 47, BR 27, PL 380 and UA 495 interactive leaves have usable existing parent membership. Australia's two remote passthrough units remain explicitly missing rather than silently changing a whole country. TNO default parents remain unavailable without scenario districts; named geographic levels remain available where membership is sound.

### Phase 3: France complete, China conservative partial release

France gains 96 département groups covering all 320 current arrondissement IDs exactly once. Existing region defaults and geometry remain unchanged; department ID parsing supports Corsica and overseas code widths.

China uses a pinned 2017 administrative code reference from `modood/Administrative-divisions-of-China`, commit `e01c078c68e044242bfcc4d26a970b2314b098cd`, under WTFPL-2.0. The vendored source SHA-256 is `3da1a40dd9395ac8a55673a41d2308b56f3e4fe3a6e55cc93fc55fefb1fba561`. This code reference is not proof that existing polygons reflect that year. Source names include historical/romanization mismatches.

The optional `tools/build_china_prefecture_crosswalk.py` source-preparation step uses pinned `pypinyin==0.55.0`, exact normalized province-scoped romanization only, and retains ambiguous/unmatched candidates. No fuzzy or nearest-neighbor assignment is permitted. It resolves 2038/2391 leaves; 353 remain unresolved/ambiguous. Because unresolved leaves could belong to any local prefecture, an entire province is withheld until every existing leaf resolves.

The published intermediate subset has 12 groups / 97 leaves across Beijing, Tianjin, Shanghai, Chongqing and Qinghai. Municipalities are explicitly labeled municipalities, not fictitious prefecture governments. 26 other province scopes remain blocked at the prefecture level (2294 leaves). Existing province fill still covers all 2391 leaves. Full national prefecture completion is NOT claimed. Candidate records, unresolved IDs, methods and source hashes remain in the checked-in crosswalk for review. Both source ID/name and parent-membership signatures must match before publication.

Normal builds use the checked-in crosswalk, not the transliteration dependency. `generate_hierarchy.py` regenerates the new metadata after the existing hierarchy transaction. `npm run build:quick-fill` refreshes just metadata and catalog governance. The source and derived crosswalk have explicit schemas, manifest entries, a pinned source ledger and license file.

## Verification and recorded evidence

Core implementation commit: `e00299a29286edd644e8cf3a32812e3594629ac3`.
Project-persistence follow-up commit: `872119284659077dbce09bc388ac0b8b4e614064`.

Full-checkout verification runs:
- https://github.com/raederhans/scenario-forge/actions/runs/35555018768
- https://github.com/raederhans/scenario-forge/actions/runs/35555404374

Recorded passing checks across these runs:

| Check | Result |
| --- | --- |
| Focused quick-fill Node contracts, including the persistence regression | 47 passed |
| Existing project file roundtrip suite | 41 passed |
| Hierarchy Python contracts | 6 passed |
| Catalog governance contracts | 19 passed |
| Existing precision and verification-routing contracts | 60 passed |
| Scenario lifecycle runtime suite | 39 passed |
| Architecture, state-writer and test-import boundaries | Passed |
| Canonical Pages build | Passed |
| Live Chromium toolbar smoke | Passed, no captured page exceptions |

The browser smoke starts the real app, seeds an existing French inspected feature, opens the native Quick Fill popover, verifies the region/department/current-owner options, selects `level:department`, checks the actual shared state and saves a screenshot. It then zooms to an existing Gironde arrondissement and replays a native mouse double-click. The six owner-scoped department members must change in exactly one history entry, one undo must restore their original overrides, and one redo must restore the fill. This is a focused pointer regression, not a country-by-country replay.

Useful rerun commands:

```sh
npm run test:node:quick-fill
npm run verify:quick-fill-data
npm run audit:quick-fill
python tools/data_health.py
python -m unittest tests.test_data_catalog_contract
node tools/check_quick_fill_browser.mjs
```

Browser startup, catalog, full-topology lifecycle tests and build checks require a complete repository checkout. A published-only artifact omits full scenario topology/transport source files. Do not weaken their tests to make a partial workspace look complete.

The temporary implementation transfer files were removed. The Quick Fill Contract workflow is read-only, uses pinned Actions, and does not commit to any branch. Repository-required PR checks remain separate. Merge authorization was subsequently provided for the local takeover; the authoritative receipt is [PR #142](https://github.com/raederhans/scenario-forge/pull/142).

## Local takeover and merge follow-up (2026-09-21)

The initial required PR gate stopped before adaptive execution because five delivery files lacked verification routes. Commit `364be49ded7d4dd1107523647592b85913c91c09` registers those files, preserves existing route order, and keeps browser/report execution under main-thread resource locks. The complete PR file selection now has no unmatched files. Local verification passed 48 focused Node tests, the 598-route schema check, script portfolio validation, metadata rebuild validation and six Python contracts. The live TNO/Gironde pointer test passed with exactly six targets, one undo/redo entry and no page exceptions. The localhost server was stopped after the check.

Local source inspection confirmed that unresolved records include old names and province-scoped ambiguity (for example, `Weixian` has three prefecture candidates in Hebei), as well as questionable inherited parent membership (`Siping` under `CN_Liaoning`, `Taibeixian` under `CN_Fujian`, and `Xianggang` under `CN_Guangdong`). These are evidence of why the current reference does not resolve the leaves, not authorization to infer replacement geography. Existing province groups and geometry remain unchanged; nationwide prefecture completion requires a separately validated source crosswalk. Municipalities deliberately reuse their existing province membership and do not claim independent county-name validation. The importer-compatible removal of `shi` is retained because changing only the reference normalization would break alignment with the existing source names.

The publication validator now proves that every province is partitioned exactly once into matched and unresolved leaves, checks nonempty groups and identity/parent membership, and verifies the counts and completion flags before publishing any intermediate group. A mutation regression reproduced seven previously accepted invalid payloads (missing or duplicate leaves, duplicate groups, unresolved overlaps, absent province records, stale totals and inconsistent completion); all are now rejected. The unchanged committed metadata still rebuilds exactly and all seven Python contracts pass.

Runtime evidence for this takeover is under `.runtime/reports/generated/quick-fill-local-*`, `.runtime/reports/generated/quick-fill-validator-before.log` and `.runtime/browser/quick-fill/result.json`. The parent owns local checks and integration. The delegated CLI completed read-only analysis but could not edit or execute in its resumed session; the parent implemented and tested the publication fix. No CLI commit, push, or merge was performed.

The expanded CI run exposed a second route registration contract: package `test:node:*` commands require a canonical `node:` route ID. The Quick Fill route now follows that contract; the entire 72-test structural tooling suite passes. The new pointer smoke also caught a real undo regression on slower runners. A local sixfold CPU-throttled replay reproduced two history entries with the same exact leading-click identity but about 14 seconds of dispatch delay. Removing the redundant two-second history cutoff preserves the browser-recognized gesture while retaining identity and snapshot checks. The focused Node suite now passes 49 tests, including a delayed-gesture regression.

The next full PR run passed the focused Quick Fill browser workflow, all three strict scenario contracts, transport, smoke and both performance scenarios. Its adaptive fast run exposed stale landing showcase source paths from earlier political-chunk splitting. The canonical Mediterranean asset generator now consumes the existing split chunks; its rendered Atlantropa count is 724 (previously 896), and the bilingual visible evidence is synchronized with the regenerated metadata and image. No map geometry was edited.

The parent ran the remaining 144 adaptive execution groups after the 73 groups already passed in CI. This uncovered six failed groups in total: the landing evidence, source-bound state-writer receipts, two click-wrapper signature contracts, and two verification-routing expectation groups. The click contracts retain the history/dirty/render boundary assertions while accepting the explicit gesture parameter. Routing expectations now include the new Quick Fill behavior leaves and documentation route rather than suppressing those obligations.

Source-bound receipts were reviewed against the actual functions and imported implementations. Besides this PR's gesture and semantic resolver changes, several precision/cache/chunk receipts were already stale on the main baseline. Exact receipts now match their reviewed implementations. The new fill and district readers also bind transitive imported modules, so downstream mutation or an unavailable dependency fails closed. The added mutation regression failed against the old mechanism and passes after the fix; all 466 quick state-writer contract tests pass. Frozen baselines and existing mutation acceptance rules were not widened.
