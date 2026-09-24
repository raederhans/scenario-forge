# Precision engineering continuation

## P0-P5 cloud continuation: candidate evidence and comparisons

Base verified on 2026-09-24: `2b2f1fecf9c388616a01dfb10da5e372ea65b3dc`.
PRs #152-#154 are merged. Release run 35957214865 completed verify/build/deploy,
including deployed smoke. Earlier unresolved-release sections are historical.
No canonical geography is replaced by this continuation.

`tools/precision_campaign.py` adds provenance/parameter envelopes around the
existing receipt runner. Source records require explicit version, HTTPS source
and license references, license declaration and hashes of actual original files.
These declarations do not substitute for a license review. Its country/scenario
inventory never conflates a claimed stage, command success, reviewed acceptance
and publication. Source changes, parameter changes, candidate changes, changed
logs and conflicting receipts remain visible. Reference and synthetic runs never
approve a precision candidate.

Start with `ops/precision/campaign.example.json`, copy it to
`.runtime/precision-campaign.json`, populate source records/parameters and place
candidate bundles at the paths in that file. The example contains no passing
candidate gates or invented source/license assertions. On a clean checkout:

```sh
python tools/precision_campaign.py inventory --campaign .runtime/precision-campaign.json --out .runtime/receipts/inventory-001.json
python tools/precision_campaign.py run --campaign .runtime/precision-campaign.json --target us-modern --gate strict --out .runtime/receipts/us-modern-strict-001.json -- python tools/check_scenario_contracts.py --strict --scenario-dir .runtime/precision-candidates/us-modern/modern_world
```

Add the envelope path to the target's `receipts` list, then inventory a new output.
Inventory exits 2 when evidence is incomplete; that is NOT a passing release.
LOD, project migration, visual and performance are separate named gates. Every
command still needs review for actual assertion coverage.

`tools/precision_comparison.py --definition .runtime/comparison.json --out
.runtime/comparisons/run-001` runs a fixed, reviewed argv harness through the
existing receipt runner in each source worktree. `fixed-data` requires the exact
same candidate digest; `fixed-code` requires the same Git source tree. Specify
`left`/`right` source_root and candidate_root, `scenario_id`, `harness_files`,
`evidence_kind`, and command placeholders `{source_root}`, `{candidate_root}`,
`{sample_out}`, `{sample_id}`. Defaults: two warmups, five measured pairs,
alternating AB/BA order, no retries. Each fresh measurement must carry its sample
id, candidate digest, scenario, assertion result, nonnegative finite metrics and
identical environment metadata (browser, OS, viewport, DPR and device profile).
Failures stop the comparison, preserve logs and never summarize a surviving
subset. `comparison.json` retains raw samples and median/nearest-rank-p95 ratios;
it never sets `performance_accepted` true. Small-sample p95 is explicitly coarse.

Cloud source snapshots omit large data. Local source-snapshot tests and synthetic
runner tests establish tool behavior only; actual high-precision candidate
results remain **not-run** until the corresponding local bundles are supplied.
