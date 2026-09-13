# Geometry reuse and incremental refresh

User authorized implementation of performance exploration parts 1 and 2 on 2026-09-13. Preserve full geometry, IDs, picking, edits/undo and stale-result fencing. Data tiling/LOD is out of scope.

- CLI A: political collection normalization/wrapper reuse, projected bounds publication reset and tests.
- CLI B: persistent incremental worker geometry/path storage with strict frame validity and tests.
- Main: integrate geometry reuse, incremental primary indexes/colors and scoped invalidation into chunk refresh; shared policies/routes/dist and acceptance.

Acceptance: repeated unchanged geometry is not reprocessed; same-ID replacement and removals stay correct; local promotions preserve unrelated caches; projection/scene changes invalidate; stale worker results never publish. Compare incremental and full index/picking/color behavior, targeted tests and focused browser interaction. Performance evidence must identify its sampling scope.

Preserve pre-existing data/, map_builder/, tools/ and related test/document WIP. No commits, pushes or deployment requested.
