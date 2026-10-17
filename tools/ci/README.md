# Verification cost policy

`verify:edit`, `verify:impact`, `verify:commit` and `verify:pr` share affected
selection in `run_pr_checks.mjs`. It uses the existing authored routes and command
parser, adding nine invariant behavior test files for startup recovery,
save/import, ZIP limits, imported feature trust, undo, backend origin/CSRF,
raster integrity and geometry cache bounds. pytest/unittest collection, runner
flags and serial resource isolation are preserved. Identical commands and
identical Node test invocations are deduplicated.

```sh
npm run pr:plan
npm run verify:edit -- --changed-file js/core/renderer/political_id_raster_source.js
npm run verify:commit -- --base origin/main --list
```

Without explicit paths, selection includes committed changes from the base and
staged, unstaged and untracked files. Use `--base HEAD` for a detached local copy
without origin/main. `--list` only plans. Unknown executable paths stop execution
before tests start. Markdown and generated `dist/` changes are explicit
exceptions. Scenario payloads select the scenario's manifest routes, keeping
expensive data checks reachable for related data or generator changes. Changed
npm scripts also select routed callers. Failed package comparison conservatively
keeps all package routes.

The old `verify:core`, `verify:nightly`, `verify:release`, `verify:pages-dist` and
raw verification tools remain callable with their original flags. The four daily
aliases accept `--base`, `--changed-file`, `--changed-files-list`, `--lane
unit|browser|all` and `--list`. Old ownership/reservation flags belong to the
retained legacy tools. package.json is now the single source of npm scripts;
the duplicate catalog snapshot is removed.

## Automatic coverage

| Lane | Scope |
| --- | --- |
| PR fast | Invariant core plus affected routes; source graph/build according to classifier |
| PR browser | Existing smoke or focused UI plus affected browser specs; sample/export/UI changes and the existing demo request select the full sample-guide spec |
| PR data | Existing scenario/transport workflows and affected data/generator tests |
| PR performance | Existing automatic, scheduled and manual policy and thresholds retained |
| Quick Fill | Existing behavior, data, lifecycle, browser, architecture and state-write checks; three global governance commands removed |
| Deploy | One source artifact, all 19 local release cases, HOI4 save/load, source SHA and downloaded-byte receipt, all 19 public release cases and HGO byte checks |
| Nightly | Existing two Linux core jobs, source artifact with all release cases, browser/sample guide and strict/heavy scenario portfolio |
| Footprint | Existing weekly schedule and manual dispatch; no PR report |

The existing Playwright configuration excludes `tests/e2e/dev/` probes on CI.
Affected selection reports these as local-only and runs them locally, avoiding
zero-test CI commands. No browser assertion, timeout, threshold or failure
allowlist is relaxed. The known sample-guide layout failure remains visible.

Both values of deprecated deployment inputs `artifact_only` and
`pages-artifact-only` build from source into `.runtime`. Their names remain
accepted for old dispatchers and workflow callers. Build admission, runtime
tests, receipt/source matching and artifact byte validation remain. The complete
startup-shell module is no longer repeated after every deploy build; packaging
changes still select that module and artifact-admission tests. Tracked `dist/`
is retained but not used as a deployment source.

## Explicit maintenance

Nightly's `workflow_dispatch` input `maintenance: true` enables existing metadata,
P4 checker/full/fast/closeout, mirror drift and Windows governance jobs, plus the
legacy comparison build and comparison receipt. Their absence in normal runs is
an explicit skip, not a pass. P4 repair requires a maintenance run with its
original authority artifacts.

Daily selection retires only the exact maintenance commands/files listed in
`run_pr_checks.mjs`: wrapper/catalog self-checks, historical P4 phase and AST
proofs, mirror equality and live Williams hardware governance. They still help
maintain old audit machinery. The risk is later discovery of drift in that
machinery; run its original tools explicitly when maintaining it. Product tests
named boundary, inventory or retirement are not excluded by a filename pattern.
City, river, export, geometry, import security and related data checks remain
routed. A deferred item never counts as passed.

Source artifacts and browser runs remain expensive. These changes reduce
repeated maintenance/build work, but do not establish a new measured CI duration.
Use actual hosted timings before claiming an end-to-end saving.
