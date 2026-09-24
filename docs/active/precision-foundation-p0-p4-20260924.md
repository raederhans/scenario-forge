# Precision foundation P0-P4 implementation

Base: main e339681abcc8cc9fb554136cce8275622ba81eab, preserving the lake-fill continuity change. This increment does not merge main, deploy production, alter canonical data or approve local precision candidates.

## Implemented scope

P0: Shared performance mode policy and explicit PR label event triggers. Required smoke must match the plan. Candidate execution receipts bind clean source identity, candidate content hashes, command, exit code and log hashes; inventory never independently approves a release. Missing, stale, conflicting and changed-input evidence is rejected. Commands still require review for coverage of their named gate.

P1: Bounded political worker image patches using conservative existing projected bounds. Small synchronous partial repaint remains unchanged. The worker retains full-frame device-space raster coordinates, redraws all intersecting contributors in painter order, then exports a cropped bitmap. This avoids the native edge-coverage differences observed when translating paths into a smaller canvas. Patch commit verifies exact scene/view/style identity and retained baseline, constructs a separate full composite and releases retired images. Unsafe bounds, changed geometry/view, large coverage or transient memory estimates fall back to full rendering. Metadata scanning and full-frame composition still exist; this is not O(delta) throughout the renderer.

P2: Optional startup layer warming is sequential and yields between layers. Visibility and scenario currentness are checked at execution rather than trusting queued demand. Full logical interaction/localization hydration remains; this increment is not the complete lightweight logical layer or screen-error world LOD redesign.

P3: Streaming gzip comparison preserves EOF/CRC and byte equality without holding both complete payloads. Phase diagnostics distinguish unavailable memory from zero and lifetime high-water from per-phase peaks. Historical county adjacency caching is keyed by complete topology, retained IDs, decoder/algorithm source, Python, GeoPandas, Shapely and GEOS versions. Cache hits validate graph structure, symmetry and diagnostics. This is one reusable build stage, not a completed global incremental DAG or unified browser heap limit.

P4: Source-built, byte-verified Pages artifact becomes the default deployment path. Manual legacy mode remains for an appropriate historical tracked-dist revision. Relevant PRs build a temporary artifact and run existing startup-shell contracts rather than requiring generated mirrors to be committed. Tracked dist is retained pending broader rollback/migration acceptance; removing it from history is outside this change.

## Validation boundary

Focused tests run against a Git-blob-verified source snapshot; large canonical data and dist are not present in that local workspace. Browser localhost is denied by the local execution environment; native module-worker pixel acceptance was subsequently completed on a hosted runner, as recorded below. Neither fixture tests nor ordinary canonical-data CI validate the user's untracked high-precision candidates. No latency, memory or FPS speedup is claimed before controlled target-data measurements.

Native regression: tests/e2e/dev/precision_foundation_patch.dev.spec.js exercises 93 edited features, overlap, a hole, undo/redo colors, transform changes, stale scene rejection and zero re-upload. Run with the existing dev lane outside CI filtering, on a source static server. New files have explicit adaptive routes; budgets, geometry tolerances and test timeouts are not raised.

Candidate example:

```sh
python tools/precision_candidate_receipt.py run --candidate-root .runtime/candidates/tno_1962 --gate strict --out .runtime/receipts/strict-001.json -- python tools/check_scenario_contracts.py --strict --scenario-dir .runtime/candidates/tno_1962
```

Every operation records an immutable new receipt. Successful commands are evidence for review, never an automatic authorization to publish. Country-specific sources, mixed-LOD, real project migration and controlled browser performance remain separate release gates.

## Reviewed correction and hosted evidence

The initial helper run 35948212369 is not accepted as a green validation run. Raw logs show that an implicit shell pipeline through `tee` masked a failed native pixel comparison and a Pages shell assertion. Its native result had 514 unequal channels after each patch, maximum difference 16. The helper was replaced with explicit Bash and `set -euo pipefail`; the final outcome gate inspects required step outcomes. No pixel tolerance was added.

Corrected run 35949586705 applies exact before/after Git-blob-bound changes to source commit 3652a5cc46241ddd1c92117fe2c55603659e20c5. Its downloaded evidence archive SHA256 is e58ddcaba7dda99711ab42619fa77831713482dbaeabd6d8c931a354ff5aa230. Raw logs confirm:

- 141 source-boundary, borrowed-effect, delegation and write-allowlist tests pass, including mutation-negative cases.
- 106 runtime, startup and CI behavior tests pass.
- 140 Python structural, build, publication and real canonical bundle-fixture tests pass.
- The native served module-worker case passes exact RGBA equality for initial color, 93-feature recolor, undo and redo. It also checks painter overlap, a hole, lower patch raster counts, transform fallback, stale-scene rejection, zero fallback and zero geometry re-upload after initial upload.
- Two subsequently added unit regressions verify full raster coordinates during crop and bitmap retirement when cancellation occurs during asynchronous export. The final local joint run passes 249 Node tests, with no skips or failures.

The patch planner now accounts for old frame, new composite, full worker surface and cropped bitmap in its transient estimate. Full-size surface clearing, metadata scanning and final composition remain. The synthetic native fixture is not the user's 3,144-county candidate and establishes no target-data latency or FPS gain.

Source-proof reconciliation was limited to reviewed changes. Upstream #151 changed water transform reuse and live ocean colors; #150 added strategic-style signature reads and city color aliases. The implementation adds read-only patch-bound ports and owned bitmap operations, and changes optional warmup control flow. Updated fingerprints reflect these exact functions/modules. Four exact new conservative read records correspond to the three strategic-state accesses and their second style use; both array-join read sites remain explicitly checked. No mutation rule, global authority baseline, broad callback permission, negative test or timeout was relaxed.

## Still-blocking release result

A full source-built Pages package was produced at 570.94 MiB, but its 64-test shell suite failed exact `hero-blank.svg` builder parity. The corrected run separately reproduces the identical ring-start byte difference on untouched main e339681abcc8cc9fb554136cce8275622ba81eab. That baseline diagnostic is a failure, not part of the passing implementation gate. The source-built release remains blocked until the generator/asset consistency is resolved without relaxing equality. No generated hero, canonical data or tracked dist is changed here.

The latest PR checks remain the merge gate; earlier-head successes do not certify a later head. Full source-built release and legacy rollback exercise, exact local precision-candidate performance/visual/project acceptance, and the broader P2/P3 architecture work remain open. All task-only transfer and validation workflow files are removed from the final branch tree. Main and production remain unchanged.

## Local closeout — 2026-09-24

The user explicitly selected completion of PR #152, protected merge and local/remote synchronization. Broader P2/P3 architecture, precision-candidate publication and removal of tracked dist remain separate future batches. The earlier sections above describe the cloud implementation handoff, not the final closeout state.

The integration owner is the parent Codex agent in `C:/Users/raede/Desktop/dev/mapcreator`, on `codex/precision-foundation-p0-p4-20260923`. Existing `.playwright-mcp/` is unrelated untracked WIP and is preserved. The precision and showcase worktrees remain owned by their existing tasks.

Live validation ownership: only the parent launches or monitors local full builds, browser tests and PR checks. Local outputs use `.runtime/tmp/pr152-closeout/` and `.runtime/tests/playwright/`; native worker tests use the existing Playwright-managed localhost server, and the source-built Pages rehearsal uses an owned localhost port 4173. Browser commands run serially. Success requires actual command exit zero and expected assertions; failures are diagnosed before retries. The hero parity worker owns only generator/asset repairs and isolated generator tests. A read-only external CLI reviews the artifact handoff and rollback code without running processes.

Planned focused commands: native `precision_foundation_patch.dev.spec.js`; `python tools/build_pages_dist.py --output-root .runtime/pr152-pages/dist`; shell contracts against that output; localhost Pages public-release smoke and the HOI4 1936 project round-trip; artifact admission/handoff tests. Exact results and final integration status are recorded below as they complete.

Closeout corrections:

- Blank hero paths now choose a deterministic closed-ring start after projected-coordinate formatting. The original Windows/Linux difference was a cyclic rotation of identical vertices. Only `hero-blank.svg` is regenerated; all 6,512 paths retain their attributes, vertices, direction and hole structure. Metadata is byte-identical. Ring rotation and all four hero builder-output tests pass locally. Strict byte equality is retained.
- Windows native raster testing exposed 162,047 unequal channels after a patch, including pixels outside the patch region. Publishing the composited canvas as an immutable `ImageBitmap`, matching full worker frames, restores exact recolor/undo/redo equality. The native test passes with its original zero-tolerance assertions; 21 related Node tests pass, including bitmap retirement. The two reviewed factory fingerprints reflect that specific owned-resource operation, without granting state mutation authority.
- CI failed because the new real-geospatial Python test was absent from the heavy dependency manifest. It is now registered. The workflow-script behavior test accepts CRLF input, and candidate link rejection uses an actual Windows junction where symlink creation needs elevated privileges. All 18 build/admission tests pass locally without skips; the manifest checker classifies 70 heavy tests.
- Source-boundary, borrowed-storage, delegation and write-allowlist checks pass locally (121 + 3 + 77 tests). Architecture, route schema and the 64-spec import graph pass. The source-built Pages rehearsal output is 570.94 MiB. All 65 shell contracts pass, the localhost public release smoke passes with zero console issues/network failures, and the HOI4 1936 click/undo/save/reload round-trip passes against that same artifact.
- The preserved legacy tracked-dist package also passes localhost public-release smoke; no production rollback was performed. Hosted run 35952055571 confirms Linux Pages byte parity and all browser/demo checks on `4b740c67`; its final catalog test exposed a stale expected documentation count (61 versus 62 after adding this task's routed record). The assertion now includes the new record explicitly. Required checks must pass again on the final head.
