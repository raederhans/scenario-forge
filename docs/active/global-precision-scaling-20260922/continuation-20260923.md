# Global migration continuation — 2026-09-23

This is a candidate migration and CI readiness change. Canonical scenario data is
unchanged. No merge, production deployment, or performance acceptance is implied.

## Country scope and current evidence

| Area | Fresh evidence | Remaining gate |
| --- | --- | --- |
| United States, Modern World | Rebuilt 3,144 counties against current checkout bytes; strict scenario and 20 whole-shard mixed-LOD checks pass | Device/performance acceptance and old-project unresolved IDs |
| United States, historical scenarios | Complete blank, HGO, TNO, HOI4 1936 and HOI4 1939 bundles all pass strict contracts | Per-scenario runtime/performance acceptance and retained unresolved IDs |
| Albania / North Macedonia | 20 targets included in the combined TNO candidate; frozen owner-domain gate passes with zero surface delta | Detailed visual acceptance |
| CH/HU/RO/BG/SE/NO/FI/SI/HR/RS | Cached source preflight available; first 241-target batch rejected for 1.4231851947029341 deg² surface drift | 22 inherited overlap pairs across the original batch require explicit handling; do not assign nearest-source ownership |
| Czechia / Slovakia | 77 / 79 source IDs match governed cache provenance | Joint source seams and constrained baseline staging |
| Montenegro / Moldova | 21 / 40 source targets prepared | Joint neighboring-source seams and staged owner-domain validation |
| Denmark / Greece | Historical Denmark remainder and mixed Greek source coverage identified | Historical synthesis / source reconciliation |
| China | Fresh conservative candidate upgrades 254 IDs and preserves 2,137 geographic IDs | Remaining lineage and inherited owner overlaps |
| Japan | Fresh conservative preparation upgrades 5 IDs and preserves 42; full 47 preparation is blocked by `nearest_source_overlap_resolution_forbidden` | Earlier 47-ID candidate is historical evidence, not fresh reproduction under the current gate |
| India | Existing 718 geographic features retained; no ADM3 expansion | Verify preservation in final combined runtime |
| Canada / Mexico | Optional scope only; no fresh Canadian candidate, Mexican prepared source has pending synthesis/review | Deferred behind priority countries |

## Runtime observation

The current Modern World candidate was served through a read-only localhost
overlay on port 8013, including `/app/data/scenarios/modern_world/` (no fallback
to canonical scenario files). Browser selected `US_CNTY_31117`, McPherson County,
Nebraska, with fine detail and `US_Nebraska` parent. State-level double-click
changed 93 counties; Undo, Redo, final Undo returned Undo to disabled. No preview
HTTP 4xx/5xx occurred. The owned page and server were closed.

Single local settled-frame observations: fill 238.3 ms, Undo 368.0 ms, Redo
370.1 ms. Political passes were 190.0 / 329.0 / 343.8 ms. Each reused 13,947 paths,
built zero new paths, and fell back on the existing dirty-feature threshold.
Background regrouping/rebuild remains material. These are not controlled A/B,
FPS, or statistical performance-gate results; thresholds remain unchanged.

The combined TNO candidate includes the historical US county partition and 279
additional targets (China 254, Japan 5, Albania/North Macedonia 20). Strict
contracts and 38 mixed-LOD checks pass, with zero target surface delta. Its
localhost browser smoke reached the unlocked editor and idle rendering with no
preview HTTP 4xx/5xx. This does not establish detailed visual acceptance.

The performance cost remains a release blocker: TNO coarse raw JSON grows from
63,856,324 bytes to 122,365,460 after historical US adaptation, then 123,051,048
in the combined stage (37,034,214 gzip bytes). Combined construction took
329.062 seconds and peaked at 3,836,313,600 working-set bytes. Browser startup
component timings are not total load-time measurements.

A read-only Gemini CLI analysis identified the shared simplifier's global
all-or-nothing fallback; parent inspection confirmed the code path and both
manifests report `regional_shared_coverage_applied: false`. Precision features
retain original unrounded geometry on fallback. The exact failing geometry and
the achievable savings remain unmeasured. Per-shard simplification is a proposed
experiment only: it must preserve historical owner domains and all mixed-LOD
seams. No rounding, tolerance, or coverage gate was relaxed.

## Reproduction and evidence

All run products are ignored under `.runtime/reports/generated/global-migration-20260923/`
and `.runtime/tmp/global-migration-20260923/`. The retained 20260922 worktree is a
read-only input. Its modern runtime and two blank sidecars differ from this
checkout only by line endings; source/sidecar plans were freshly rebound, never
patched to bypass digest checks.

- Modern candidate: `modern/modern_world`; gates `modern-current.strict.json`, `modern-lod.json`.
- Historical candidates: `historical/{blank_base,hgo_1936,tno_1962}` and `historical-v3/{hoi4_1936,hoi4_1939}`; all five strict reports pass. The earlier `historical/hoi4_1936` is rejected and superseded.
- Combined candidate: `combined/tno_1962`; `combined.strict.json`, `combined-validation.json`, `combined-browser.txt`.
- Rejected Europe stage: `europe/tno_1962`, `europe-validation.json`; never publish it.
- Safe geometry: `europe-al-mk-geometry-validation.json`.
- Fresh country reports: `jp-cn-candidates-v1/{jp,cn}.report.json`, `japan-full-v1/jp.report.json`.
- Browser observation: `modern-browser-perf.json`.

Use `stage_us_county_adapted_bundle.py` with explicit baseline, adaptation,
sidecar-plan, source and new `.runtime` output directories. It refuses stale
bindings, ambiguous city/capital hosts, unsupported references, changed
historical assignments, and stale compressed representations. Blank and HGO
keep their existing vector profiles; their `performance_accepted` remains false.

HOI4's existing degenerate rings are decoded with the established runtime/chunk
decoder for adjacency only. Inherited invalid and zero-area surfaces are retained
and reported; new invalid children fail. Political detail bounds now omit
zero-extent boxes, matching the canonical metadata contract, while preserving
every payload feature. This resolved 51 strict errors in the first rebuilt 1936
candidate. Both fresh v3 builds pass without changing the validator or coarse
bounds semantics. Each retains three unresolved historical IDs unchanged.

## CI and delegated work

The strict matrix now covers all six registered scenarios. Blank has an explicit
ownerless contract with pollution, duplicate-ID and direct-controller-map
regressions. New migration/source tests are routed through the existing catalog.
Modern World is an observation-only performance scenario; governed gate scenarios
remain exactly TNO and HOI4.

CLI Gemini completed the startup wiring fixture and Modern performance runner
tasks; parent reviewed and reran the 11 and 68 tests. The Air inventory attempt
produced an invalid artifact, was cancelled, and was completed by the parent.
Native delegates covered cached source preparation, historical bundle assembly,
review and exact policy-source receipt fixes. Full builds and browser operations
had one parent owner. A proposed running-session handoff was unavailable across
agents; the parent retained execution and verified both HOI4 exits.

Local evidence includes 33 migration/regional/major-country tests, 13 source/pilot
tests, 65 blank-and-Pages tests, planner and routing tests, and exact policy suites.
Pages distribution rebuilt successfully at 550.37 MiB. The former landing parity
failure was freshly rerun and passed; no landing asset change was needed.
Nightly 35785752495 also had historical-builder and guide-layout failures: those
are separate baseline findings, not proven fixed by migration candidate checks.

Final targeted follow-ups: 20 assembler/source tests, two detail-bounds tests and
38 Python performance-contract tests pass. The performance-contract assertion
still fixes the governed scenarios to exactly TNO/HOI4, now matching the frozen
export used by the already-tested Node behavior contract. CI on `1afb3af1` had
six strict lanes and smoke passing, but exposed that stale text assertion and
rejected performance measurement three times due hosted-runner background CPU.
No usable performance regression result came from that run. Latest commit CI
and final run receipts are maintained on draft PR #146; unchanged thresholds
and environment admission remain mandatory.
