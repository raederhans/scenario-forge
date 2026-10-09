# HGO native editor implementation plan

## Goal

Implement the five user-approved stages: independent subproject and native dataset, complete editing loop, names/search/borders/labels/cities and measured runtime behavior, product navigation and file routing, then retire the former in-map HGO preview/vector path. Preserve editable ocean parcels and native pixel coordinates. On 2026-10-09 the user additionally authorized review, push and protected merge; the existing main-branch publication workflow may run after that merge.

## Scope

`apps/hgo/` is an independently bootable browser application. The root integrator owns product entry links, legacy retirement, root build/catalog/CI/test routing and task records. The primary checkout and all unrelated worktrees remain untouched.

## Sources of truth

- Original implementation starts at `origin/main` a91cb74e1, branch `codex/hgo-native-editor`; its worktree is retained for evidence and recovery. Reviewed integration uses `codex/hgo-reviewed-integration`, based on `origin/main` 89ce2ef954.
- Source mod is read-only at `C:/Users/raede/Desktop/dev/mapcreator/historic geographic overhaul`.
- Full BMP: 5120x2560, 20,781 pixel-present province IDs, 11,894 states. Definition ID 0 is unused. Dense codes reserve 0 for nodata.
- Verified exact ID image is 25 MiB raw / 977,242 bytes gzip level 6. Decode roundtrip mismatch count is zero. These are data sizes, not browser performance measurements.

## Stages

- [x] 1. Independent native dataset builder/validator and application entry.
- [x] 2. Exact hit/selection/paint/undo/redo/save/reopen/PNG end-to-end.
- [x] 3. Names, search, borders, labels, native cities; lifecycle and focused runtime evidence.
- [x] 4. Main product links, import dispatch, independent build/publish asset closure and scoped checks.
- [x] 5. Remove former HGO preview/vector runtime hooks and active common-base contracts after replacement coverage passes.

The five product stages are implemented and integrated with the newer main population and cache changes. Review fixes cover delayed handoff, JSON saving during GPU loss and the standalone return link. HGO authority retirement is applied as an exact narrowing delta: four absent writers and obsolete grants/hooks are removed while frozen baselines and unrelated records are preserved. Current-source receipts, transition checks and the official P4 quick suite pass. The earlier full-inventory rebuild still has 815 unresolved findings; it is not reported as passing and is not substituted for the actual required PR checks. Final merge remains gated on those checks at the final commit. Results and limitations are tracked in `task.md`.

## Acceptance criteria

- HGO never imports the main renderer, singleton state, old toolbar/sidebar, or common-base scenario loader; main boot never imports the new HGO runtime.
- Dataset rebuild is deterministic and source-grounded. All pixels resolve to source IDs and states, including WTR; no real-world projection claim.
- Paint and undo operate on stable state IDs; UI selection/zoom and reference groups are separate from editable paint.
- Saved files identify format/schema/dataset revision; wrong datasets and malformed input fail without losing the active document.
- Browser checks cover real small urban parcels and water, roundtrip, PNG, cancellations/reopening, WebGL context loss/recovery and no unwanted requests.
- Build/test owners have isolated outputs. New HGO code has independent targeted checks; shared entry/build changes receive both relevant checks.
- Legacy paths retire only after replacement behavior is verified. Preserve reusable HGO palettes/identity data that serve a separate product purpose.

## Non-goals

Georeferencing the source, true geometry editing, importing modern GIS layers, recreating every unrelated main-map feature, restoring ownership editing, manual production deployment, Git history rewrites.

## Risks and constraints

Main checkout has substantial unrelated WIP. Existing main startup cannot safely unmount in one page, so use independent HTML/document navigation. Browser back-forward cache may retain old documents; measure resource behavior rather than promise instant memory release. Root verification metadata/state-writer contracts and Pages asset admission must be updated consistently with touched integration code.
