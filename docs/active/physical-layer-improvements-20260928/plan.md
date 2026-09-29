# Plan

## Goal
Implement the six physical-layer improvements authorized by the user on 2026-09-28, in order, and explain the visual-expression work (item 6) in detail.

## Scope
Physical UI, mode-aware diagnostics, classification/coverage, bounded higher-detail data, local intensity rendering, separate terrain/landcover styling, names/legend, and a measured relief-shading experiment.

## Sources of truth
Current working-tree implementation and datasets. The workspace contains substantial unrelated WIP; preserve it. Starting copies of relevant files are under `.runtime/tmp/physical-layer-baseline/`.

## Stages

- [x] 1. Fix styled-select synchronization, physical status, and preset behavior.
- [x] 2. Organize controls, conditional sections, and reveal selected properties.
- [x] 3. Accurate classification labels, swatches, and empty coverage.
- [x] 4. Bounded detail resources and scale-dependent use, preserving existing global overview.
- [x] 5. Neutral/zero intensity correctness and genuinely local edits.
- [x] 6. Independent terrain/cover strengths, useful names/legend, and relief shading trial.

## Acceptance criteria
Target regression tests; focused localhost browser validation; no dropped unrelated edits; explicit treatment of source precision, resource cost, historical/scenario limitations, exports, and project round trips. Each item must have implemented behavior or a specific evidenced limitation, not a claimed success from placeholders.

## Non-goals
No deployment, commits, unrelated refactor, scenario regeneration, or wholesale global high-resolution rebuild.

## Risks and constraints
Shared renderer and loader already modified by other work. Source rasters may be absent/large. Keep temporary output under `.runtime/`; register new runtime assets and validate data contracts. Prefer existing renderer caching, loading, clipping and export paths.
