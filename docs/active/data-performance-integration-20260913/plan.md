# Plan

Integrate all currently pending Mapcreator product changes into main and push via a reviewable PR. User authorized merge, including forced merge if necessary, and relevant test repairs. Scope: regional builders and FR/DE/BE/NL precision rollout; geometry/incremental rendering; data packing/chunk loading; related docs/tests and tracked dist. Preserve .playwright-mcp historical diagnostics and clean contours evidence checkout. External CLI installation/global skills are outside this Git repository.

Validate current combined state, repair demonstrated test/implementation failures without weakening gates, regenerate release dist, commit with rationale, push and merge, then reconcile local main and remote status. No remote history rewrite or protection configuration edits are needed by default.
