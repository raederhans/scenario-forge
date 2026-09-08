# Context

Baseline main/origin main: 9d2d9e88bc54c0ecf61ad03dc69495600d1d5895. Previous source PR #123 required CI passed, but subsequent automatic deployment failed drift; no deployment from that run.
Primary worktree: C:/Users/raede/.codex/worktrees/recovery-r0-u1-20260908/mapcreator, branch codex/recovery-r0-u1-20260908. Original workspace personal config and untracked M0/M1 records preserved.
Collaborator owns T1 only until explicitly released for P1; no runtime/dist/shared catalog writes during R0.

## Live ownership

Primary owns canonical builder: `npm run python -- tools/build_pages_dist.py`, cwd primary worktree, writes tracked dist and local .runtime only, log .runtime/tmp/r0-build.log. Success requires exit zero then review expected mirrors; failure is diagnosed, no blind retries. No other task may build dist.
Browser and server commands will be recorded before startup; only generated dist may be served for R0 product acceptance.

T1 completed in task 01a08017-f491-7ae2-8e80-27db3cb17647, commit 7508660a, integrated as 52c08e51; 4 behavior tests and direct-writer scanner pass in the primary worktree.
Windows checkout conversion left CRLF even after forced checkout/archive attempts. Source js/css/vendor/index.html were restored from `git cat-file --batch` blob bytes (verified renderer CRLF count zero), preserving semantic Git content. The intermediate build was stopped; authoritative canonical build log is .runtime/tmp/r0-git-blob-build.log. Do not use earlier build manifests.
Planned generated-product server: primary only, `py -3 -m http.server 8832 --bind 127.0.0.1 --directory dist`, cwd this worktree, log .runtime/tmp/r0-dist-server.log. It must serve only dist, with no source redirects. Stop after product checks.
Planned browser checks: `PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:8832`, existing tests/e2e/project_save_load_roundtrip.spec.js grep `editing baseline fast`, then tests/e2e/water_cache_strategy_regression.spec.js grep `mode reuse`, workers=1, output .runtime/tests/playwright/r0-dist. Test module imports now resolve relative to /app/ so pure dist hosting works. Exit zero and actual editing/cache assertions required; failure retains traces and is investigated without budget/allowlist relaxation.

Latest canonical build after the reproduced Modern World packaging fix: .runtime/tmp/r0-modern-build.log, exit zero, 922.02 MiB. Generated app/data is ignored by design; do not force-add it. Startup shell log .runtime/tmp/r0-modern-shell.log ran 63 tests, with only the obsolete unknown_files=8 assertion failing; updated to 7 and focused rerun passed. Metadata .runtime/tmp/r0-metadata.log: 51 passed. Cache .runtime/tmp/r0-dist-water.log: one passed in 31.8s.

Current server: port 8832, exec session 58146, log .runtime/tmp/r0-dist-server-final.log. Current browser: session 88528, log .runtime/tmp/r0-dist-roundtrip-final.log, grep `roundtrip only`, output .runtime/tests/playwright/r0-dist-roundtrip-final. This additional 1280x720 case uses supported keyboard history shortcuts because compact layout hides toolbar buttons, then verifies save/reload and Modern World switch. Original full 1600x1000 cases are unchanged. Do not run heavy suites concurrently. Stop server after acceptance.
