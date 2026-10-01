# Scenario geography repair

User authorized repair, merge and push on 2026-10-01. Preserve unrelated primary-checkout country-label WIP.

Scope: restore French Guiana and northern Somali coverage in TNO/blank; remove demonstrated India/Pakistan duplicate coverage while preserving the existing Pakistan boundaries and unrelated geometry; preserve shared Canadian 60N edge nodes across coarse/detail LOD. Use source-backed assignments, unchanged identities where possible, no inferred sovereignty.

Acceptance: target regression tests; real-data coverage/overlap and coarse/detail path checks; derived scenario strict contracts; focused localhost browser verification; canonical Pages artifacts and sample baseline consistency; final-head CI and confirmed PR merge/push.

Stages: implement isolated algorithms; root-owned geometry promotion and derived builds; focused verification; commit/PR/merge; confirm remote integration and preserve primary WIP.
