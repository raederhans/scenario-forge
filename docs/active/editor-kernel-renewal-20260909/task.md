# Implementation status

## Second-round P4 follow-up (2026-09-09)

The second-round request extends the earlier bounded classification task to remaining owner/proof repairs. Its baseline is merged main `75ccc19e8b8a46fa3d46019affcc40ba631702ff`. The official local P4.4 report passed on 2026-09-09 with zero violations, and its candidate was installed byte-identically with a successful schema check. The earlier 784-violation and 96-entry reports below are retained historical diagnostics; their pending dispositions are superseded by the final closeout section.

- Published bundle eviction and outgoing chunk-pin release now use three target-first activation actions. Retention policy returns detached eviction IDs and retains the existing count/byte, in-flight and active-selection rules. Cache/byte/cancellation checks pass 24/24; a frozen-bundle reader check and registered-source mutation rejection pass 2/2.
- Legend writes now pass through actions. Existing palette authority retains `legendLabels` and `legendConfig`; the new legend action owns `legendControl` and `legendColorOrder` and explicitly delegates the palette fields. Existing getter normalization remains. The relevant action/generation/revision/control checks pass 37/37.
- Three affected action writer entries were regenerated with official per-binding discovery and grant construction. Schema and action-binding checks pass, and `baseline`, `baselines` and `progress` remain equal to the committed starting policy. These scoped checks do not evaluate global progression or establish P4 admission.
- P4 routing behavior tests pass 23/23. New retention-policy and legend-action paths have focused behavior routes.

The retained 96-entry diagnostic is assigned by owner as follows. Counts describe that older diagnostic only; changing source or proving a read requires a fresh report before a row can be called closed.

| Owner / module | Historical entries | Classification and current disposition |
| --- | ---: | --- |
| `legend_manager.js` | 16 | Mixed: getter normalization is a real write, while scalar/JSON and class-method forwarding can be conservative escapes. Canonical write migration implemented; reader/forwarding progression still requires fresh proof. |
| `scenario/bundle_cache.js` | 8 | Real published-cache mutation. Moved to activation actions; current strict per-file inventory reports no remaining raw findings. |
| `scenario/chunk_payload_loader.js` | 14 | Outgoing published bundle pins were real writes. Reset now delegates to activation actions; remaining loader/callback escapes require the fresh report. |
| `interaction_funnel.js` | 15 | Import request bookkeeping and document-identity propagation mix local request state with borrowed app-state references. Import owner handles completion assembly and exact read proofs. |
| `interaction_funnel/import_apply_orchestration.js` | 16 | Prepared-state projections, borrowed topology and valid-ID iteration need exact reader/clone proof; no blanket exclusion. |
| `map_renderer/scenario_refresh_runtime.js` | 8 | Local execution bookkeeping inherits taint from an infrastructure-stage value; actual infrastructure writes stay with their existing owner. |
| `bootstrap/post_ready_scheduler.js` | 4 | Local outcomes/timer bookkeeping is conservatively tainted; cancellation and resource semantics remain with the scheduler owner. |
| `history_manager.js` | 2 | Detached snapshot clone path; verify clone provenance rather than allow the source state to escape. |
| `renderer/scenario_relief_overlay_render_owner.js` | 2 | Zoom-transform read/clone path; needs exact helper proof. |
| `scenario/bundle_runtime.js` | 6 | Cached-bundle reads and calls into a mutating cache owner are mixed; cannot classify the entire controller as read-only. |
| `scenario_manager.js` | 4 | Mix of scalar ID normalization and transaction diagnostics delegation; preserve actual diagnostic authority. |
| `map_renderer.js` | 1 | DPR read/argument path; do not confuse the read finding with the separate existing DPR assignment. |

Frozen baseline refresh, broad unsupported-site exclusions and self-seeded previous-policy identity remain prohibited. The integration owner alone runs the fresh full source/P4 gate after source edits settle.

## Original implementation status

Runtime implementation, independent reviews and the original bounded P4 repair scope are complete. The current import/file/sample suite passes56/56. Current artifact builds are byte-identical. The current artifact journey passes with identical assertions and110s budget when trace is disabled; two traced deadline failures remain recorded. Full P4 admission remains FAIL with source-level classification; this does not satisfy or claim a release gate.

- [x] Read the complete source conversation and current clean baseline.
- [x] Identify existing C color-only history refresh and D execution identity/infra stale guards in current source.
- [x] A/B import safety and full staged transaction; independent review PASS WITH NOTES, current transaction/file/sample56/56 and current rebuilt-artifact journey passed.
- [x] A/P4 bounded repair and durable failure evidence:93/93 scope tests,3/3 exact proof tests, schema/bindings and current routes pass. Full P4 remains FAIL; see evidence and retained classification.
- [x] C verify current color-only incrementality: existing real history tests 6/6; do not repeat prior optimization or claim new performance gains.
- [x] D cancellation, guarded cooperative work and bounded lifecycle: scheduler/handoff 47/47 incl real assembly stale completion and queued cancellation. Source cold/warm/switch real editing lifecycle passed.
- [x] E stable data contract and artifact-only release preparation: city migration and independent review passed; handoff7/7; current independent build trees byte-identical,9565files/966850264bytes. Actual production promotion/rollback remains external follow-up.
- [x] Final artifact focused import journey after P4 source corrections: current rebuild pair matches9565files/966850264bytes; identical assertions pass in about85s with trace off under the original110s budget. Two traced deadline failures remain recorded; permanent configuration unchanged. Earlier source lifecycle+save/reload, artifact public gate and all3editing journeys passed. Single natural-background observation only, no p95 or paired speedup claim.

## Authorized remote integration and cleanup

- [x] Preserve the complete implementation in `ece5d2c0`, on top of the existing optimization commit `9d4b715a`.
- [x] Fix the actual PR #127 adaptive-selector failure: explicitly classify bounded task prose and the exact local Codex configuration without accepting unknown runtime files. Metadata/routes tests76/76; cumulative selection189files,0unmatched,15nonbehavioral.
- [x] Audit all15 additional worktrees; preserve359 evidence files /179,225,200bytes, binary patches and originals for both generated-dist dirty trees,8 source-identity archive tags, and a verified incremental Git bundle.
- [x] Remove15 covered worktrees,17 old local branches and6 remote branches already contained in remote main. Retain main and the active PR branch pending acceptance.
- [x] Final integration merged through [PR #127](https://github.com/raederhans/scenario-forge/pull/127) at `2026-09-09T05:18:04Z`, merge SHA `75ccc19e8b8a46fa3d46019affcc40ba631702ff`. Fresh `gh pr checks 127 --required` reports all six required checks passing. Local main is at that merge; the merged PR branch is absent locally and from the remote heads query. Source-identity archive tags and cleanup receipts are recorded above and under `.runtime/tmp/editor-kernel-renewal/worktree-recovery/`.
- [x] The tracked-dist Pages workflow [34314328978](https://github.com/raederhans/scenario-forge/actions/runs/34314328978) completed successfully for the same merge SHA at `2026-09-09T05:24:52Z`. Its verify, build and deploy jobs succeeded, including `Smoke deployed Pages URL`. Optional artifact-only build, admission and downloaded-byte verification steps were skipped; this run therefore does not establish artifact-only promotion or rollback acceptance.

Cleanup preserves original commit identities and existing local performance evidence; it does not establish a new paired performance improvement. Full P4 and traced artifact limitations below remain recorded independently of the PR required checks.

The first pushed integration (`7299a6ad`) passed remote performance, transport, TNO, tracked-mirror, smoke and demo checks. Required-check follow-up synchronized HOI4 snapshot/manifest/audit identities, selector artifact consumption, duplicate Playwright aliases, actual city-test heavy dependencies and current behavior assertions. The immutable performance baseline is now checked against its existing ratification receipt rather than the changing candidate manifest; the live workload gate remains unchanged. Unknown executable files remain rejected. The three-window lifecycle test retains its original180s budget with the required justification (previously measured1.6m), and the landing city-alias count now matches189255.

Complete local selected-child execution exposed13 failing command groups, each addressed with the relevant narrower check; already-passed groups were retained. The final runtime-only adjustment moves pure political-coverage analysis to the existing promotion helper: scenario refresh804→729lines within the unchanged746line budget, architecture PASS and related runtime33/33. Source imports/Pages mirrors are regenerated after this extraction. The final PR head subsequently passed all required checks and merged, as verified above; the earlier performance result remains attached to its own tested identity.

## Evidence

Initial git status --short: empty. HEAD: 9d4b715a.
Prior project records describe implemented optimizations; they are not new validation of this change.

- D tests cover cancellation during resource wait, independent task progress, bounded waiting/execution outcomes, revision changes across yield, same-key replacement, interaction guard on resume, and old epoch/handle races.
- E city: 40 duplicate-ID groups / 41 extra points repaired using stored GeoNames identities; 21,338 cities unchanged in all nonidentity fields. Eight HOI4 strategic references migrated by exact old-ID/coordinates. City Node 4/4, Python 9/9, neighboring 5 tests, catalog/manifest 32, data_health exit 0 (existing size warnings). Migration report `.runtime/tmp/city_identity_migration_20260909.json`.
- E release: `artifact_only` is a default-false manual input in the existing deploy workflow. Source-built runtime artifact must pass shell/public smoke and editing roundtrip, then a receipt binds source and actual downloaded bytes before Pages upload. Default tracked release remains until real promotion/rollback is authorized and verified.
- Source failures exposed outgoing TNO landData seeding target owners and missing shared primary topology IDs. Both fixed, along with plain-project detail-ID preservation and stale scenario summary. A real renderer epoch change during pending FileReader is now detected even when dirtyRevision/request ID do not change; the red-to-green regression uses the actual epoch owner. Current transaction/file/sample56/56 and rebuilt-artifact roundtrip pass.
- Import commit now coordinates14 existing domain owners for63 fields; new action owns only13 previously unowned fields. Source/rollback remain synchronous. Related domain/transaction checks130/130 before final narrow preflight tests.
- P4 final route report:changed187,owned63,unmatched0,route gaps0. Exact owner13-field and existing14-domain policy updates pass schema/bindings, preserving frozen baselines/progress. Scope tests93/93 and exact proof tests3/3 pass; full admission remains FAIL as explained below.
- Artifact verification before final narrow source corrections: public gate passed with0console/network issues; natural background editing, full cross-scene+PNG477painted pixels, and cancel/save/reopen all passed. Current corrected artifact passed the focused cancel/save/reopen journey with trace off. Shell62/63 passed first; the sole stale fixed-path assertion was updated to the exact opt-in/default expression and passed with7handoff tests (8/8). Unaffected62 not repeated.
- Full P4 original report contains784violations; exact diagnostics and trusted historical proof subsequently narrowed the candidate rejection to96 progression entries. New action missing/duplicate writer errors are resolved. No candidate replaced canonical policy, no blanket unsupported allowlist or frozen baseline refresh occurred, and no generator/checker remains running.
- Project `.codex/config.toml` parsed with Python tomllib successfully; no config modification.

## Original remaining boundaries (historical snapshot)

All unchecked items remain open. PR #127 remote acceptance and the tracked-dist Pages deployment are now verified above. Full historical P4 admission and optional artifact-only promotion/rollback remain separate open boundaries.

Trace recording remains a local verification limitation: two current artifact runs with recording exceeded110s; the controlled trace-off run passed all identical functional assertions within the same budget. This implicates recording overhead as a contributor, without proving the exact mechanism or an application speedup. No timeout, assertion or allowlist was relaxed. Both owned artifact servers30040/37708 were stopped; no task-owned browser/build/server or P4 process remains.

The source plan explicitly limits phase A to source-level explanations, targeted verification and failure reports, and warns against an extended recovery project. That scoped outcome is PASS; full P4 admission is FAIL. Original784violations and the latest96 progression entries across12modules remain available. The latter include genuine pre-existing cache/legend writes and conservative read-only escapes. No frozen baseline, authority budget or previous-source identity was refreshed to make the gate green. Final route:changed187/P4-owned63/unmatched0/gaps0. Policy schema,15directly affected import domain owner bindings and exact contracts pass; all non15owner writer entries and baseline/baselines/progress remain equal to trusted HEAD.

## Second-round P4 closeout — local report PASS

The 784-violation and 96-entry statements above describe earlier evidence snapshots, not the current second-round source. PR #127 and Pages acceptance above remain verified historical remote results; the second-round changes are local and have not been pushed or deployed.

- Cache and legend mutations now use canonical actions. Cache retention preserves required/active/in-flight payloads and transaction deferral; the LRU action exchanges only a short string-ID order with its caller and retains the caller's Map identity. Shared legend normalizers and detached color/revision readers retain the public class API.
- Import trust projection returns fresh ID Sets and ownership maps. Document identity now closes over history references for equality checks without exposing them as request data. Exact source-bound reader proofs cover these boundaries and reject source drift.
- Renderer transaction diagnostic initialization and scenario-apply epoch updates now use a dedicated canonical action. The legacy ensure wrapper still returns the original diagnostics object, while the action itself returns no borrowed state. Epoch results cross the boundary as numbers.
- Two scanner corrections remain narrowly scoped: imported readers with a validated `allowBorrowedTarget` contract may read borrowed values inside actions; local helper arguments are evaluated in the caller's scope and return expressions in the callee's scope. Writer delegation still requires the exact target. Forward-declaration regression cases preserve detection of real state, field, helper, and alias returns. Callable capability escape tracking remains outside this return-value correction.
- Local preflight now compares both frozen and previous-active semantics. Startup cancellation cleanup uses identity-guarded content actions; the handoff injects the city loader through its existing helper interface. Renderer asynchronous completion exposes booleans while preserving rejection behavior.
- The official builder produced the complete candidate. An extra local assertion initially treated `diagnosticDelta` as append-only; the official contract instead independently recomputes that historical projection. The follow-up official report in `.runtime/tmp/round2-final-report.mjs` passed with zero violations, including historical reconstruction and transition checks. Frozen baseline, source/algorithm identity, existing paths, checkpoints and transition semantic entries were preserved. Historical coverage increased from 191 to 215 paths; no current-source baseline reset or self-seeded previous policy was used.
- During candidate generation another task added `tests/tno_burgundy_africa_city_labels_behavior.test.mjs`. Removing only that added path reproduced the original source identity exactly. The final report freshly scanned the current tree, and its complete source identity and candidate bytes remained unchanged throughout that run.
- Final report: `.runtime/reports/generated/nightly/round2-final-policy-report.json` (PASS, zero violations, zero unknown candidates and zero stale bindings). Installation receipt: `round2-policy-install.json` (candidate byte identity and schema PASS). The latest real browser recovery/reopen/late-loader journey passed in 1.3m; architecture boundaries also passed.

The second-round local P4 gate is complete. It does not claim a new CI run, clean-checkout release, artifact-only promotion or deployment. The policy still tracks 739 legacy memberships; zero gate violations does not mean all legacy state access has been removed. Unowned city/locale data and related tests remain preserved.
