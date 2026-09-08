# Status

- [x] R0 final source/artifact closure: PR #124 merged as fbf89bee after all six required checks passed.
- [x] T1 history-color fixture: 7508660a integrated as 52c08e51; 4/4 real behavior tests and direct-writer scanner passed in integration worktree.
- [ ] U1 project import feedback.
- [ ] P1 measured operation improvement.

R0: deployment run 34201618073 independently confirmed failed drift, build/deploy skipped. Canonical Git-byte build updates eight JS mirrors plus manifest. Pure-dist testing additionally exposed Modern World topology excluded by the builder; the exclusion is removed and the generated product includes its manifest URL and renderable geometry (922.02 MiB, unchanged budget). Startup-shell suite: 62 of 63 passed; the remaining old unknown-file count assertion was corrected and its focused rerun passed. Relevant-PR mirror check regression and verification metadata 51/51 passed. The original 1600px editing cases remain intact; observed slow undo/redo is part of P1 measurement, with no timeout relaxation.
T1/P1 collaborator task: 01a08017-f491-7ae2-8e80-27db3cb17647, title T1 测试夹具收口与后续 P1 性能工作. P1 released at fbf89bee; currently owns local performance sampling, server port 8008.

R0 generated-product acceptance: `.runtime/tmp/r0-dist-roundtrip-final.log`, 1 passed in 1.5m, actual fill/undo/redo/save/import equality and Modern World switch. TNO cache reuse passed. Independent full checkout at 10edc8f7 rebuilt twice with zero tracked drift. Remote fast, smoke, demo, scenario, transport and required aggregator passed. Deployment run 34207190613 has passed verify/build; deployment outcome is tracked separately.

R0 deployment: automatic run 34207190613 completed successfully (verify, build and deploy all success) for fbf89bee.

U1: migration read-only counts flow through successful import observers into Project status; cancellation error remains distinct. Target behavior tests 68/68 passed. Boundary checks 9/10 passed, with only expected pending dist mirror mismatch. Browser acceptance passed in 1.2m (.runtime/tmp/u1-roundtrip-fresh-edit.log): real dirty survives cancellation and invalid JSON, successful import reports scenario/ignored count, forged ID is filtered and save/reload equality holds. First attempt used undo as a dirty precondition; undo restores a historical clean snapshot, so the test now creates a fresh real map edit. No runtime workaround or timeout change. Canonical build and remote integration remain pending P1. No format version, autosave or cloud workflow changes.

U1 data qualification: data_health passed; catalog generation had zero diff. Data contract now 18/18 passed after updating three stale baseline assertions: 29 schema kinds (including the existing City Lights descriptor) and landing's current catalog-count data binding instead of retired copy. Locale manifest byte identity/counts refreshed only for the edited locale bundle. U1 will be admitted independently while P1 closes the remaining measurement gap.

P1 remains open after first delivery: 12 runs/60 samples and functional checks passed, water stage improved, but busy task/input queue overlap was not observed and busy redo median action time increased 16.4% (capture-to-visible +6.7%). Primary requested real overlapping browser input calibration and a fixed-probe A/B reassessment before accepting the optimization. Commits 1b08b219 and 79c81016 are preserved in collaborator worktree, not yet integrated. Do not describe P1 or whole-input responsiveness as complete.

U1 local admission complete: canonical build .runtime/tmp/u1-final-build.log passed at 922.02 MiB, controller boundary 10/10 passed after mirror refresh, test import graph and diff check passed. Four source mirrors plus manifest changed as expected. U1 is being submitted independently for remote review; P1 retains exclusive local browser/perf ownership for corrected busy calibration.
