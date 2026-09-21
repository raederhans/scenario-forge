# Quick-fill hierarchy: phases 1 to 3

## Scope and compatibility

Base: `5f72e2e3cf037e30652cf8d27747ff4974e85f43`, including the bulk-preview/deferred-refresh improvements. No geometry, sovereignty, owner assignments, or existing legacy group IDs are replaced. No runtime spatial join or new frontend dependency is introduced.

### Phase 1: semantic fill contract

`js/core/quick_fill_hierarchy.js` is the independent semantic membership resolver used by `fill_target_policy.js`. It caches immutable payloads by identity and reads live ownership/hydration separately. Border visibility thresholds are not fill eligibility thresholds. Normalized scenario `tags`, legacy `countries`, and repeated normalization are handled explicitly; conflicting memberships fail closed. The border resolver consumes the same tag/legacy adapter.

A valid singleton remains a singleton. Missing, conflicting, stale, unverified, and incompletely loaded groups do not become country batches. Only an explicit `parent_available: false` contract can fall back to country. Explicit country means the entire current scenario owner, with incomplete hydration rejected. Existing single-click country semantics are unchanged.

TNO's default scenario-only parent policy is preserved. Named `level:*` geographic editing groups are an explicit user choice, intersected with current ownership; they do not assert historical administration. The dropdown is available in scenario visual/subdivision mode, not sovereignty mode. Selected levels survive snapshot restoration and are never silently rewritten because another inspected country lacks the level.

Immediate first-click feedback is retained. A recognized double-click coalesces its leading leaf-color history entry into the batch for one-step undo/redo. Gesture identity, timestamp, color, scenario and before/after continuity prevent unrelated/no-op leading clicks from absorbing older edits.

### Phase 2: inspectable support audit

Run `npm run audit:quick-fill`. Outputs are `.runtime/reports/generated/quick-fill-support.{json,md}`. The audit uses the production resolver and political-interaction exclusion policy against default and all three scenario snapshots. It distinguishes helpers, raw/interactive leaves, singleton parents, unavailable levels, owner-scoped membership, missing IDs, conflicts and duplicate IDs. Scenario coarse chunks are used as complete ID inventories, not viewport subsets. This is a metadata/resolver audit, not a country-by-country pointer replay.

At this base snapshot: default CN 2391, FR 320, DE 401, US 914, GB 191, IN 718, RU 2329, CA 343, MX 300, JP 47, BR 27, PL 380 and UA 495 interactive leaves have usable existing parent membership. Australia's two remote passthrough units remain explicitly missing rather than silently changing a whole country. TNO default parents remain unavailable without scenario districts; named geographic levels remain available where membership is sound.

### Phase 3: France complete, China conservative partial release

France gains 96 département groups covering all 320 current arrondissement IDs exactly once. Existing region defaults and geometry remain unchanged; department ID parsing supports Corsica and overseas code widths.

China uses a pinned 2017 administrative code reference from `modood/Administrative-divisions-of-China`, commit `e01c078c68e044242bfcc4d26a970b2314b098cd`, under WTFPL-2.0. The vendored source SHA-256 is `3da1a40dd9395ac8a55673a41d2308b56f3e4fe3a6e55cc93fc55fefb1fba561`. This code reference is not proof that existing polygons reflect that year. Source names include historical/romanization mismatches.

The optional `tools/build_china_prefecture_crosswalk.py` source-preparation step uses pinned `pypinyin==0.55.0`, exact normalized province-scoped romanization only, and retains ambiguous/unmatched candidates. No fuzzy or nearest-neighbor assignment is permitted. It resolves 2038/2391 leaves; 353 remain unresolved/ambiguous. Because unresolved leaves could belong to any local prefecture, an entire province is withheld until every existing leaf resolves.

The published intermediate subset has 12 groups / 97 leaves across Beijing, Tianjin, Shanghai, Chongqing and Qinghai. Municipalities are explicitly labeled municipalities, not fictitious prefecture governments. 26 other province scopes remain blocked at the prefecture level (2294 leaves). Existing province fill still covers all 2391 leaves. Full national prefecture completion is NOT claimed. Candidate records, unresolved IDs, methods and source hashes remain in the checked-in crosswalk for review. Both source ID/name and parent-membership signatures must match before publication.

Normal builds use the checked-in crosswalk, not the transliteration dependency. `generate_hierarchy.py` regenerates the new metadata after the existing hierarchy transaction. `npm run build:quick-fill` refreshes just metadata and catalog governance. The source and derived crosswalk have explicit schemas, manifest entries, a pinned source ledger and license file.

## Verification

- `npm run test:node:quick-fill`: targeted policy, UI, district and history tests.
- `npm run verify:quick-fill-data`: deterministic metadata, hashes, partitions, partial-release and stale-crosswalk checks.
- `npm run audit:quick-fill`: all published scenario metadata inventories.
- `python tools/build_data_catalog.py`, `python tools/data_health.py`, `python -m unittest tests.test_data_catalog_contract`.
- `node tools/check_quick_fill_browser.mjs`: live-app dropdown smoke on localhost; seeds the inspected feature, does not pretend to be a full map-pointer regression.

Browser startup, catalog, full-topology lifecycle tests and build checks require a complete repository checkout. A published-only artifact omits full scenario topology/transport source files. Do not weaken their tests to make a partial workspace look complete.
