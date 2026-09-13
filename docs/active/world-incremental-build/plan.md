# Plan

## Goal
Implement reusable regional geometry rebuilds across world source regions and scenario owners, with correct cache invalidation and incremental chunk reuse.

## Scope
Content identities, declared source compute units, same-ID topology assembly, read-only cross-scenario planning, isolated scenario candidate chunk rebuilds, and regression/real-data verification. Preserve all previous France work.

## Sources of truth
Existing processors, scenario manifests/owners/chunks, and current verified master snapshots. Analysis: `.runtime/reports/generated/regional-incremental-rebuild/README.md`.

## Stages
- Cache correctness and dependencies.
- Generic geometry assembler and source processor registry.
- Cross-scenario impact planner and isolated candidate rebuild CLI.
- Incremental owner chunks with unchanged artifact reuse.
- Integration tests, real multi-owner scenario evidence, usage documentation.

## Acceptance criteria
Non-target geometries/metadata remain intact; IDs/lineage changes cannot silently pass; source region differs from scenario owner; stale inputs/outputs invalidate cache; unrelated chunks retain bytes; manifests and gzip agree; failed candidates never mutate baseline. Existing full paths still pass relevant tests.

User's France rollout criterion allows visually insignificant geometry deviations, including TNO special terrain. Preserve scenario identity and protected geography; assess numeric residuals by their visible extent instead of requiring mathematical zero. France passed the focused local rollout checks on 2026-09-13; broader country upgrades still require their own source/owner mapping and scenario checks.

## Non-goals
No new worldwide source download or wholesale precision upgrade, no automatic historical-cut inference, no deployment. ID split/merge needs explicit future migration support, not silent assignment.

## Risks and constraints
Coupled RU/UA and CZ/SK processors, old snapshot rollback, shared arcs and neighbor indices, antimeridian, physical-water dependencies, and cross-scenario identity.
