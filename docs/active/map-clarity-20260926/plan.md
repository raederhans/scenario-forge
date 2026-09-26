# Map clarity implementation plan

## Goal
Improve default and zoomed map clarity, keeping editing/data semantics and unrelated WIP intact.

## Scope and authority
User authorized ordered implementation and CLI/native delegation on 2026-09-26. Original investigation: C:/Users/raede/Desktop/dev/mapcreator/.runtime/reports/generated/map-clarity-investigation-20260926.md. User explicitly chose political borders ON by default for political scenarios, optional OFF; blank drawing retains color merging.

## Stages
1. Fixed viewport/DPR baseline.
2. Display density independent from data loading profile; explicit profile priority; UI and project persistence.
3. Border/river visual hierarchy and optional semantic political boundaries.
4. Screen-space LOD measurement and targeted changes only when evidence warrants them.
5. Exact-frame recovery, interaction/export correctness and bounded resource checks.

## Acceptance
Native density through DPR2 on ordinary viewport within pixel budget; stable density during gestures; explicit quality survives scenario changes and project roundtrip. Same-color different political owners distinguishable; color contours and blank mode remain correct. No geography/ownership/ID changes or stale-border fallback. Stop input recovers exact political/border frame. Target tests and controlled localhost screenshots verify behavior; report measured limitations.

## Non-goals
No data migration, engine rewrite, deployment, pushing/merging or unrelated cleanup. GPU work only if measured bottlenecks justify a later decision.

## Risks
Main checkout holds unrelated WIP and an older HEAD. Work from managed worktree origin/main@2f4cb130. Higher density increases pixel memory quadratically. All live tests have one owner.

