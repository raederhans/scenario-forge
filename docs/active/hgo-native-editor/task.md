# HGO native editor task

## Current status

五个功能阶段已实现；用户于 2026-10-09 授权审核、合并和推送。当前在 `C:/Users/raede/.codex/worktrees/hgo-reviewed-integration/mapcreator`、分支 `codex/hgo-reviewed-integration` 整合最新主线。三项审核发现已修复，精确 HGO 权限退役已在整合源码上核验并落盘。**当前状态为审核整合中，等待最终 required checks 与合并回执**。先前全量库存重建的 815 项失败仍作为历史证据保留，不冒充已经清零；本次以不增加既有治理违规的严格缩窄证明完成 HGO 退役。主工作区未被写入。

Delivery checkpoint: implementation commit `96014184a5c761f4c4d9c7c1a4d9f38d413fd51e` is pushed. [PR #215](https://github.com/raederhans/scenario-forge/pull/215) is the authoritative receipt for final-head required checks and protected merge. This checked-in record describes local acceptance before those hosted checks finish; it is not a deployment receipt.

## Checklist

- [x] Independent source builder/validator and native core assets.
- [x] Independent WebGL2 renderer, exact hit, edit/history/project/PNG loop.
- [x] Map-first UI with search/names/labels/native cities and Chinese/English copy.
- [x] Root navigation, import routing, independent packaging and scoped CI.
- [x] Retire old embedded HGO runtime/vector contracts after replacement coverage.
- [x] Targeted source, Node, browser, build and integration checks.
- [x] Exact HGO writer retirement, preserving frozen baselines, unrelated records and previous action proofs; validate against final integrated source without claiming a full inventory rebuild.
- [ ] Final-head required checks and authorized merge/push.
- [x] Final PR plan, scope audit, documentation and evidence report, with incomplete acceptance stated explicitly.

## Validation evidence

The table below records implementation-stage checks. Review/integration evidence is appended in `context.md` and `.runtime/reports/generated/hgo-review/`; it supersedes the earlier claim that the full inventory rebuild is necessarily a prerequisite for every scoped delivery. Full inventory debt remains open, with no required route removed or baseline expanded.

| Command or check | Result |
| --- | --- |
| Source BMP pixel ID/RGB roundtrip | PASS: all 13,107,200 pixels, 0 mismatches; 20,781 present province IDs; all 11,894 states covered |
| Native Node / Python tests | PASS: 14 Node behavior tests and 11 Python dataset/package tests |
| Real WebGL2 browser contract | PASS: 17 assertions including 1-pixel water/city, paint/history, atomic wrong-revision rejection, JSON roundtrip, full 5120×2560 PNG exact RGB, context recovery, cancellation and disposal |
| Real editor UI | PASS: search/focus, paint/labels/history, actual JSON download and reopening, main-file import handoff, HEX input and loading cancel/retry |
| Standalone / Pages packaging | PASS: native 15-file package; source graph has no unresolved references; main and HGO module graphs are disjoint; 5 final package/link/manifest checks passed |
| Landing / main guide entrypoints | PASS: 24 tests against `.runtime/dist/hgo-pages` |
| Routing / conditional CI gate | PASS: 18 Node tests; HGO-only changes select the native job; mixed integration changes retain main checks |
| Legacy main renderer / contracts | Relevant renderer suites, 34 selected Python contracts and architecture checks passed; known unrelated baseline gaps below remain |
| County adapter / retired tooling | 16 of 17 initial target tests passed; one Windows rename failed transiently, its single-case recheck passed; old HGO scenario is explicitly rejected |
| Main ownership proof preflight | PASS: 27 relevant behavior/declaration tests; 63 reader entries, 2 effectful delegators and 45 module discoveries; all 58 retirement receipts and their 58 restoration/injected-write negatives pass |
| Existing retirement and default-owner regression tests | PASS: official focused runner, 11 retirement/cross-file negative tests and 5 default-owner tests; current 481 facade keys have no unowned, missing or colliding key |
| Inspector focus scan repair | PASS: existing 9 behavior tests; all 37 module findings have canonical authority after renaming a non-state focus descriptor parameter; no scanner or authority relaxation |
| Context writer and ledger repair | PASS: the seven fixed context assignments remain explicit writers; 19 scenario-refresh tests pass; complete real-edge ledger preflight has 510 entries and zero violations |
| Final Pages source refresh | PASS: final resolver source mirrored into the root-owned artifact, inventory rebuilt to 821,366,642 bytes, three focused package/isolation/manifest checks pass |
| Verification routing | PASS: 727 routes; script portfolio 354 scripts with complete classification |
| Historical state proof | Completed normal official replay: 413 strict production paths, 419 historical baseline paths, full cache identity verified; this does not establish progression acceptance |
| Final P4.4 progression | FAIL: 815 violations; no authoritative policy written. 812 semantic-authority additions, two test-budget violations and one retirement regression |
| Final delivery plan / whitespace | `npm run pr:plan` and `git diff --check` completed; the plan runs no tests and reports no committed changes, with this branch 10 commits behind local `origin/main` |

Evidence lives under `.runtime/reports/generated/hgo-native/`. `browser-proof.json` records exact browser assertions and limitations; the saved real GUI document is `gui-saved-hgo-project.json`. Builds are local artifacts, not production deployment proof.

The two retired HGO data trees contain 80,415,895 source bytes; the native dataset contains 5,670,968 bytes, with 4,294,076 bytes in the three assets requested at startup. This is a logical asset-footprint comparison, not a timing or browser-memory benchmark (`asset-footprint.json`).

## Open risks and remaining work

- The earlier full state-policy rebuild rejected 815 findings after real discovery and historical replay. Bounded source comparisons establish substantial existing drift, but do not prove every finding predates HGO. This full rebuild remains unresolved. Its diagnostic budget was 804 versus frozen 781 (alias escape 668 versus 632); no scanner allowance or frozen baseline was expanded.
- The reviewed scoped policy update is applied: writers 217→213, ledger entries 460→464, with four HGO retirements and six previously retired color grants explicitly proved. All unaffected records/checkpoints remain unchanged, ten affected receipts pass against integrated source, and semantic narrowing/replacement/transition checks pass. The same 13 existing schema violations remain by stable identity. Official P4 quick passes 533/533; neither that result nor the scoped update is a claim of a clean full inventory rebuild.
- HGO retains native top-left pixel coordinates and editable WTR water; it does not invent georeferencing or convert old common-base HGO projects. Reference owners are immutable.
- Source diagnostics explicitly omit 207 stale victory-point references and apply two byte-pinned missing-brace interpretation corrections. The original mod is untouched. Capital states are retained as source metadata; no capital-city coordinates are guessed.
- WebGL2 and 5120×2560 texture support are required. Warm cached timings in the browser proof are diagnostic, not a comparative performance benchmark.
- The in-app browser's download event timed out although the JSON reached Downloads. PNG dimensions/bytes/pixels passed the real GPU harness; a second GUI download receipt and native confirmation cancellation were not established.
- Review repaired stale city/world metadata, canonical-LF metadata for 684 GHSL outputs, and five stale toolbar assertions. All 754 manifest hashes, 36 data tests, 54 toolbar contracts and 15 related behavior tests pass. No population source values were changed. Two unrelated registry-size expectations identified during the implementation stage are not represented as a passing full-main-suite result.
- Integration is based on `origin/main@89ce2ef954`, preserving the newer population/thematic and cache behavior. The fresh Pages artifact builds successfully. Review repaired missing native entrypoints in synthetic graph fixtures and restored explicit rejection of retired scenario paths; all 69 Pages tests now pass, with strict unresolved-reference assertions retained.
- GitHub-hosted CI, push and protected merge are authorized and still pending. Deployment can be reported only from its own workflow receipt. The previous localhost preview on port 8009 is stopped; the primary checkout and unrelated WIP remain untouched.
