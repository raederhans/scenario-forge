# Ordered river overlap rendering and Wave 7

Wave 7 admits the seven previously held overlapping-source parents. The default scope is **389 parents / 1,276 cells / 104 contour supports**, adding 7 parents and 77 cells to Wave 6. All 382 previous parent records, cell IDs and coordinates remain exact. Administrative source IDs, geometry and scenario assignments remain unchanged; the partition geometry stays a derived paint surface.

New parents: `BY_INT_GOMEL`, `BY_INT_MOGILEV`, `RU_CITY_VOLGOGRAD`, `RU_RAY_50074027B24471111608761`, `RU_RAY_50074027B51726500082089`, `RU_RAY_50074027B61241799946425`, and `UA_RAY_74538382B4751802602524`. Navigation uses source names and reviewed Dnieper/Don/Volga associations. Unverified Chinese names remain empty and use the existing source-name fallback.

## Rendering contract

With a compatible active pack, each political parent and its cells draw as one unit in stable full-source order, with primary/shell underlays before detail. Pending edits and color overrides no longer promote an obscured parent over its covering source face. Full and partial paint paths share the order. Hits first choose the highest actually containing visual face; a noninteractive covering face blocks land below it. The canvas, point probe and spatial paths agree. Incompatible worker bitmaps, geometry raster paths and foreground patch previews defer to ordered rendering while partitions are visible. Ordinary rendering without an active pack retains its previous behavior.

Each partition has a complete local cell graph. Same-parent internal arcs are excluded from the global paint mesh, whose raw diagnostics remain intact. Internal lines are drawn on a transparent border scratch canvas in source order. Each later visual parent erases covered lower seams with the same original fill and base stroke, including holes and unpartitioned or noninteractive faces. Its own lines are clipped to its parent. This scratch is composited once before other borders. Political-only export contains fills; borders-only export includes visible internal lines. Extra scratch pixels count against the unchanged 640 MiB export budget.

The single-parent cell draw uses the existing partition index: ordinary source faces do not scan the complete pack or read projection/drawing state. This avoids a newly amplified full-map hot path. Export preparation rejects unavailable or invalid local geometry and releases export scratch afterward.

## Geometry and visibility evidence

`verify_layered_contours.mjs` explicitly separates geometry completeness from visibility. The old global verifier still reports the overlapping-source failures; its output is retained without changing thresholds or relabeling it as a pass.

The current Wave 6 → Wave 7 whole-map comparison covers **11,983 interactive source features and 24,247 neighbor pairs**, at the existing `1e-9` degree length tolerance. It has zero external neighbor differences, old record changes, baseline/candidate local seam mismatches, old local seam changes or unattributed ambiguities. Of 22 newly recorded legacy ambiguities, 21 are exact parent-local seams. The final 612/687 support interval is an existing unequal-length same-side collinear conflict exposed by a new subdivision. Its attribution checks exact integer-line identities, continuous subinterval coverage and complete parent/side owner sets; shifts, gaps, side changes and third owners fail. Evidence retains the original full edges. This classification does not use aggregate neighbor lengths as proof.

Independent GEOS fixtures provide original source order and visible/occluded points. Actual Modern World landData matches the relevant 66-face order. All seven candidates and two affected old parents pass real click/undo checks in spatial, canvas and automatic hit modes. Fourteen real seam samples pass native Canvas readback against the independent oracle: nine visible intervals draw, five covered intervals remain transparent. Separate DPR 1/2 Canvas tests cover unpartitioned/noninteractive covers, holes, reversed order, parent clips, line width, single alpha application and export layer isolation.

The real renderer also exercises a successful partial repaint, full repaint and political/borders/combined exports at a Volgograd overlap point. The upper bank color remains identical in all fill outputs, with a transparent border interior and a visible seam. Historical saved-pack scopes remain supported; loading an old project does not migrate its embedded pack.

Canonical pack: `data/river_partitions/modern_world_wave7.json`. Pack ID `sha256:6794639e6f664ed2a1e5585264eebc04706329a8561b413148bd47ad792478ec`; normalized canonical SHA-256 `e812632d421c965ac5fc0de2062d907bcedeb3c6252803bb075f813fba0335ed`. Lossless transport is **1,517,806 bytes**, below the unchanged 2,000,000-character download limit.

## Boundaries and publication

This change solves internal river seam visibility and stable paint/hit ownership. It does not redesign external political-border occlusion for all overlapping source polygons. Exact-edge global diagnostics can still describe inherited source conflicts. Planar geometry lengths are not metre-based cartographic accuracy claims.

The Pages artifact builds at 825.54 MiB. All 84 publication/catalog checks pass, along with both focused browser cases against the built static website: actual Wave 7 download/edit/save/import/export and successful partial repaint with political-only, borders-only and combined exports. Data health passes with 677 catalog entries. Generated dist mirrors come from this accepted artifact, including stale mirrors of physical-layer source fixes already on main in PR #199.

The PR-check prelude passes. After repairing legacy extracted-function ports and exact source-contract assertions, all 101 process entries in the final adaptive selection have passing evidence, with no route gaps. The repaired suites add explicit river-preview clearing and normal/stable-order switching assertions. Checks reserved for serial execution are supported by the focused browser/publication evidence above and the subsequent remote CI results.

Local detailed outputs are retained under `.runtime/rv7-*`. This checked-in document records local acceptance before publication. Final CI, merge, hosted-content and independent-checkout sync receipts are recorded separately under `.runtime/rv7/`; local geometry or browser success alone is not deployment proof.
