# Water geometry contract

Named water sources and physical masks use different edge semantics. Source sea
boundaries are straight segments in longitude/latitude. Existing physical masks
are consumed by D3 as spherical polygons. Applying planar booleans directly to
those masks loses the Arctic cap and can disagree with the visible coastline.

`physical_water_mask.py` converts physical masks through the vendored D3
Equirectangular stream, including its pole and antimeridian clipping, then
reconstructs the filled planar surface. It must not process named-water source
boundaries. Primary land/ocean are the global authority; the detail topology
inherits those exact objects because its legacy background was regional.

`water_region_authority.py` restores complete Natural Earth marine source rows,
including North/South Atlantic and Pacific rows that share a translated name.
It subtracts named seas from macro oceans and explicit children from their
parents, then clips marine water to physical masks. Inland lakes retain their
own geometry. Unrelated region overlaps are errors, not draw-order decisions.

`water_geometry.py` compiles after the last clipping/simplification operation.
It preserves IDs, nodes shared boundaries, samples planar edges at 0.25-degree
grid crossings and sets clockwise shells/counterclockwise holes. It does not
introduce longitude-band epsilon gaps. Quantized water is normalized on the
final grid before topology construction. Non-water coordinates remain exact;
detail mask inheritance removes its incompatible transform rather than moving
political coordinates.

Unquantized water uses a shared 1e-9-degree numerical grid before encoding.
This removes floating-point self-intersections and micro-overlaps, with bounded
area-change diagnostics; it is not source simplification or survey accuracy.
Already-short encoded arcs are not repeatedly resampled.

The TopoJSON encoder's redundant winding is disabled, and final ring references
are checked using translated coordinates and compensated summation. This is
necessary for mixed large and tiny components where encoder direction handling
can reverse individual rings. Components of at most 1e-10 square degrees are
below the numerical compatibility floor and are removed with count/area records;
removal of an entire nonempty feature fails. These units are not square km or a
claim about survey precision.

Final decoded geometry is also the source export. TNO chunks copy these full
features without further simplification. The Python publication guard first
requires exact decoded Shapely validity. `check_water_geometry.mjs` validates
actual vendored D3 containment and EqualEarth fill, edge drift, mask exclusion
and same-level overlaps. Canonical source/runtime/chunk equality and focused
canvas painting/undo tests cover the application's effective geometry surface.

For a narrow asset rebuild, run `python -m tools.rebuild_water_geometry
--stage-root .runtime/tmp/<new-stage>`. Failed candidates remain staged for
diagnosis; only an exit-zero stage with an outputs manifest and unchanged input
identities can be adopted. Regenerate dependent scenario contracts/startup/chunks
after adoption, then run final runtime and browser gates. Do not promote a staged
candidate solely because its planar polygons are valid.
