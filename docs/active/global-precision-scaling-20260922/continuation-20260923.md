# Global migration continuation — 2026-09-23

This is a candidate migration and CI readiness change. Canonical scenario data is
unchanged. No merge, production deployment, or performance acceptance is implied.

## Country scope and current evidence

| Area | Fresh evidence | Remaining gate |
| --- | --- | --- |
| United States, Modern World | Rebuilt 3,144 counties against current checkout bytes; strict scenario and 20 whole-shard mixed-LOD checks pass | Device/performance acceptance and old-project unresolved IDs |
| United States, historical scenarios | Full assembler now covers blank, HGO, HOI4 and TNO while retaining historical domains, assignment lineage, authoring assets and scenario hierarchy | Each complete bundle must pass its own strict and runtime checks |
| Albania / North Macedonia | 20 targets; frozen owner-domain geometry gate passes with zero surface delta | Full combined stage and visual acceptance |
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

## Reproduction and evidence

All run products are ignored under `.runtime/reports/generated/global-migration-20260923/`
and `.runtime/tmp/global-migration-20260923/`. The retained 20260922 worktree is a
read-only input. Its modern runtime and two blank sidecars differ from this
checkout only by line endings; source/sidecar plans were freshly rebound, never
patched to bypass digest checks.

- Modern candidate: `modern/modern_world`; gates `modern-current.strict.json`, `modern-lod.json`.
- Historical candidates: `historical/<scenario_id>`; HGO and blank strict reports pass.
- Rejected Europe stage: `europe/tno_1962`, `europe-validation.json`; never publish it.
- Safe geometry: `europe-al-mk-geometry-validation.json`.
- Fresh country reports: `jp-cn-candidates-v1/{jp,cn}.report.json`, `japan-full-v1/jp.report.json`.
- Browser observation: `modern-browser-perf.json`.

Use `stage_us_county_adapted_bundle.py` with explicit baseline, adaptation,
sidecar-plan, source and new `.runtime` output directories. It refuses stale
bindings, ambiguous city/capital hosts, unsupported references, changed
historical assignments, and stale compressed representations. Blank and HGO
keep their existing vector profiles; their `performance_accepted` remains false.

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
had one parent owner.

Local evidence includes 33 migration/regional/major-country tests, 13 source/pilot
tests, 65 blank-and-Pages tests, planner and routing tests, and exact policy suites.
Pages distribution rebuilt successfully at 550.37 MiB. The former landing parity
failure was freshly rerun and passed; no landing asset change was needed.
Nightly 35785752495 also had historical-builder and guide-layout failures: those
are separate baseline findings, not proven fixed by migration candidate checks.
