# Ocean geometry implementation

User requests completion of the four investigation recommendations: physical water authority; shared source-to-D3 geometry conversion; consistent shared boundaries across partitions; final runtime geometry and interaction acceptance. Structural changes are authorized. No publishing is requested.

Scope: base water regions and TNO ordinary water; preserve IDs, properties, scenario-specific coast changes, unrelated political geometry, and all existing WIP. The physical ocean/land masks remain the authority. Do not classify new territory by draw order.

1. Implement common planar-edge compilation, winding/holes, seam and pole handling, and final topology conversion.
2. Integrate base and scenario builders; regenerate only water-dependent assets using existing materializers. Preserve non-water topology objects and maps.
3. Use consistent compiled geometry for rendering and picking; keep ocean masks separate from named regions.
4. Validate final decoded assets, source-vs-D3 geometry, water/land exclusion, internal overlap, polar/dateline coverage, and focused browser painting/picking compatibility.

Acceptance: known false water points over Antarctica have zero water hits; Arctic water cap is present; water interior points have the expected semantic membership; shared boundaries have no non-boundary overlap or gaps; holes/IDs survive export; existing relevant data contracts and focused interaction checks pass. No world-fill exceptions or relaxed allowlists.
