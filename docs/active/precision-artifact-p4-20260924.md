# Immutable artifact partition and isolated recovery

Base: main `2b2f1fecf9c388616a01dfb10da5e372ea65b3dc`. PR152-154 and the successful
release `35957214865` are already on main. Default source-built artifact delivery
is unchanged. This work does not rebuild tracked dist, publish new national data,
change protection/permissions, rewrite history or roll production backward.

## Implemented

`pages_artifact_partition.py` splits an independently admitted artifact into an
application set and a versioned data set. The data mount is `app/data/`; every
relative URL and every byte stays unchanged. Manifests bind both actual trees to
the independently supplied source/admission receipt. Assembly copies, never hard
links, both sets into a new temporary tree and checks that tree with the existing
handoff verifier before atomically publishing the new directory. Links, duplicate
paths, extra files, overwritten inputs, stale receipts and modified input/output
bytes are rejected. All writes are confined to new `.runtime` directories.

This is a concrete application/data packaging boundary. It is not a remote CDN
resolver, network-range format migration or permission to replace existing hosts.
Application and data versions can be stored separately, but the tested serving
layout is reconstructed and byte-identical. Cross-version data mounts without a
matching artifact receipt are deliberately not supported.

`pages_artifact_rehearsal.py` runs previous -> candidate -> restored previous using
fresh fixed-root servers bound only to 127.0.0.1. It accepts explicit JSON argv,
uses no shell, records raw stdout/stderr hashes and real exit codes, checks HTTP
errors and verifies artifact bytes before and after each phase. It neither calls
GitHub deployment APIs nor changes symlinks/refs under an active server. Failures
stop once and preserve logs. A successful rehearsal is not production approval.

## Actual evidence and important distinctions

Run `35984434842`, source `a73dc778abd69e66171c449f359d1ef025908d37`, establishes:

- Ten negative/roundtrip unit tests pass. Distinct A/B/A selection is tested using
  small synthetic HTTP fixtures, not historical production bundles.
- The real canonical Pages artifact builds at 570.94 MiB. Initial shell execution
  ran 65 tests with six skips: five missing-Shapely cases and one Windows-only case.
  These six are NOT passing assertions; dependency-complete validation is separate.
- Existing public-release browser smoke passes with zero console issues and zero
  network failures, one attempt and no retries.
- Real partition, reassembly and all three fresh-server browser phases pass.
  Exact artifact tree SHA256:
  `0cf8249c264806e81440bea3adc17a08cfb71d49c6df8245b793a468c416c8cd`.
  The real previous/candidate inputs are source and reconstructed copies of that
  SAME admitted artifact. Report `distinctArtifactBytes` is false. This proves
  real byte-preserving reassembly/reselection, not a different-release rollback.
- Evidence artifact 10801508782 has archive SHA256
  `2ad438eac6f65de17c32a8f367f6640d9a9b1016978c364391bcdc6021095c7a`.

Earlier run 35983420119 stopped because acorn was not installed before the builder.
The fixed workflow installs locked Node dependencies first; the earlier failure
is retained, not counted as a successful build. Subsequent current-head required
checks are authoritative. Branch-only execution helpers are removed before delivery.

## Normal local build/check path, without tracked mirrors

Use a fresh directory, not the legacy no-argument builder path:

```sh
npm ci
python tools/build_pages_dist.py --output-root .runtime/pages-check/run-001
```

Point `SCENARIO_FORGE_PAGES_ARTIFACT_ROOT` at that same directory before running
`python -m unittest tests.test_pages_dist_startup_shell -q`. Serve that directory
on loopback and set `PLAYWRIGHT_TEST_BASE_URL` for the existing public-release and
project behavior tests. An admission receipt is created only after those actual
checks pass. Do not synthesize a passing receipt to drive the commands below.
PowerShell uses `$env:NAME = 'value'`; Bash uses `export NAME=value`. Python CLIs
accept paths and are otherwise shell-independent.

## Reproduce lossless partition

With the source artifact and its independently retained admission receipt under
`.runtime/releases/current/`, use the receipt's exact source commit as SHA:

```sh
python tools/pages_artifact_partition.py partition --input-root .runtime/releases/current/dist --receipt .runtime/releases/current/receipt.json --source-sha SHA --output-root .runtime/releases/current/package
python tools/pages_artifact_partition.py assemble --input-root .runtime/releases/current/package --receipt .runtime/releases/current/receipt.json --source-sha SHA --output-root .runtime/releases/current/restored
```

The JSON result must report `byte-identical`. Every file/hash/count, manifest hash
and source SHA must match, with no added, missing or rewritten files.

## Actual different-release recovery gap

Needed inputs: two independently retained artifact directories and their original
passed admission receipts, not a rebuilt approximation of the old release:

- `.runtime/releases/previous/dist`, `.runtime/releases/previous/receipt.json`
- `.runtime/releases/current/dist`, `.runtime/releases/current/receipt.json`
- corresponding previous/current source SHAs, plus compatible existing browser
  and project behavior commands with their unchanged timeouts and retries.

```sh
python tools/pages_artifact_rehearsal.py --previous-root .runtime/releases/previous/dist --previous-receipt .runtime/releases/previous/receipt.json --previous-sha PREVIOUS_SHA --candidate-root .runtime/releases/current/dist --candidate-receipt .runtime/releases/current/receipt.json --candidate-sha CURRENT_SHA --output-root .runtime/releases/rehearsal-001 --smoke-command-json '["npm","run","test:e2e:pages-public-release-gate"]'
```

On Windows use a JSON argv invoking Node's installed Playwright CLI directly if
`npm` resolves only to npm.cmd; shell execution is deliberately disabled. Expected
outputs are `rehearsal.json` and per-phase stdout/stderr logs. Acceptance requires
all real exits zero, no HTTP/browser failures, unchanged trusted asset hashes,
previous restored exactly, and explicit `distinctArtifactBytes: true` for a real
cross-release rehearsal. Project import/export behavior must be exercised with
compatible old/new artifacts separately; a startup-only smoke cannot replace it.

## Tracked-dist retirement is not authorized by this evidence

The legacy local command/default and historical tracked mirror remain available.
This PR intentionally does not remove tracked dist: archived release recovery,
normal-command migration and all downstream consumers still need review. Existing
shadow retirement receipt requirements are unchanged; one same-artifact rehearsal
cannot manufacture that eligibility. Current application/data partition and the
CLI recovery path are usable independently of that larger migration.

## Local integration, 2026-09-24

Direct partition verification now validates the complete independently supplied
admission receipt, expected source identity and passing public smoke before
accepting a package. Regressions reject both tampered and resealed nonpassing
receipts. On Windows the link rejection test uses a real directory junction,
without requiring symbolic-link privileges. All 11 artifact tests pass with no
skips. Main through #157 is integrated, preserving #160 data and #156 raster
changes. Both build-graph and artifact verification routes are retained.
The parent owns test/server execution; delegated review was read-only.
Logs: `.runtime/tmp/pr158-161-closeout/artifact-tests.log`.
