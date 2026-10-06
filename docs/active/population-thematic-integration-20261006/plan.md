# Integration plan

Deliver the authorized WGI/HDI/WDI scenario reference layers and GHSL population spatial display through a protected-main PR. Base: origin/main@926ee96f7. The primary checkout contains mixed work and remains untouched.

1. Select feature-owned changes into this worktree, preserving current-main renderer, rivers and delivery contracts.
2. Rebuild four population feature sidecars against current topology, including compressed TNO identity. Preserve GHSL 2020 1 km source and count-conserving display tiles.
3. Run scoped behavior/data checks and delivery plan, then commit and push the feature branch.
4. Wait for final-head required CI; fix failures within scope; merge normally and verify the remote merge receipt.

Acceptance: no unrelated primary WIP; valid complete data registration; feature tests pass; required PR checks pass on merged head. No force push, rule bypass, or deletion of user work.
