# Plan

## Goal

Complete the recovery plan's M4 structural-governance cycle around the current scenario-overlay modification hotspot. Original plan: https://chatgpt.com/c/6a9ec54f-31f0-83ec-953a-efa96be491b0 (read 2026-09-08). Its M4 goal is “持续做有收益的结构治理”; acceptance is “每次重构降低修改范围或验证成本，而非只减少行数”. Its guidance calls for lifecycle ownership, a composition-only renderer, and behavior-based tests.

## Scope and stages

1. Consolidate repeated water cache strategy paths.
2. Complete shared scenario-layer canvas lifecycle in the existing render cache owner; consumers receive cache summaries rather than mutable cache entries.
3. Complete relief pass ownership in its existing owner; renderer retains assembly and pass delegation. Preserve ordering, runtime state replacement, projection resets, diagnostics and direct/adaptive/reuse/redraw behavior.
4. Replace affected implementation-location assertions with owner behavior/assembly coverage; route affected cache and overlay edits through focused tests using the existing verification catalog.
5. Validate the whole changed surface and record results and limitations.

## Acceptance criteria

- Water/special/relief canvas creation, publication, resize invalidation and global reference reset use one cache owner.
- Renderer contains no relief cache mutation or reuse decisions; the relief owner no longer depends on the region owner for cache access.
- Cache consumers cannot mutate the cache through scenario-layer summaries. Failed rendering does not publish a valid partial canvas.
- Tests exercise cache hits, signature and dimension changes, DPR/overscan transforms, replacement runtime cache, global reset, missing contexts, drawing errors, modes, relief idle/interaction behavior and draw order.
- Focused routes cover all affected owners and their shared integration test; metadata and relevant integration contracts pass without a new verification framework.

## Non-goals and constraints

No global state rewrite, arbitrary file-count target, data/deployment migration, frozen policy baseline refresh, historical admission claim or unmeasured performance claim. Preserve existing unowned config and M0–M1 documents. Ongoing future maintenance is not finite; completion here refers to all stages and acceptance criteria of this recovery M4 cycle.
