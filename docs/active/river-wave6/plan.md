# River contour repair

Base: `433e5b33` (Wave 5, 376 parents / 1,164 cells).

Repair contour behavior behind the 13 held river parents, preserve exact approved geometry and saved projects, and admit only candidates whose full-map and runtime checks pass. Work stays in the retained integration worktree; primary checkout WIP is untouched.

1. Reproduce all held candidates against Wave 5 and choose a bounded production fix.
2. Implement source-backed regression coverage and runtime integration without changing coordinate tolerances, source polygons, or ownership.
3. Verify full-map adjacency, internal seams, old parent records, browser painting/history/export, and publication contracts appropriate to the final patch.
4. Push a reviewable PR, merge after checks, and synchronize the independent checkout; record remaining held cases explicitly.

Source overlap and near-coincident boundary segmentation are distinct defects. An implementation must explain rendered behavior, not merely remove acceptance failures. Existing source precision, budgets, and old saved pack scope remain constraints.
