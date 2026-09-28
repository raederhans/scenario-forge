# Southern Mediterranean and Asia Minor expansion

Validated candidate-v2 is adopted locally to `data/scenarios/tno_1962`.
All frozen source-file guards passed before 28 scenario files were atomically
replaced; every candidate file then matched its canonical counterpart.
No commit, push or deployment.

## Source decisions

| Target | Source | Original-island anchor | Owner |
| --- | --- | --- | --- |
| Samos | state 9825 / province 19164 | source 15068 to the Samos component of EL412 | TUR, explicitly confirmed by user |
| Ikaria | state 9845 / province 19189 | source 15067 to the Ikaria component of EL412 | TUR, explicitly confirmed by user |
| Soke coastal zone | state 9831 / province 19158 | existing Aegean regional fit and actual coast-contact restoration | TUR |
| Malta and Gozo | states 8560 + 9890 / provinces 18159 + 19216 | source 12003 + 13814 to MT001 + MT002 | existing ITA |

English localization and source bitmap adjacency identify the donors. Stale
state filenames are not authoritative. Soke uses the existing regional
source fit near Izmir, not a claim of precise modern municipal registration.

Samos and Ikaria reuse the whole original island components; the selector
never clips those components. Samos overlaps original Turkish mainland by
0.0011147172 square degrees: its opt-in clipping removes only that duplicate
mainland, fails if any original island core is lost, and rejects detached
reclamation after clipping. Ikaria needs no such clipping.

Malta retains its stable ATLISL_sicily_tunis_malta ID. The old synthetic
island was misplaced north of the original Malta/Gozo cores. One shared
transform for both original source islands and both reclamation donors
returns the island to its original location and adds East Maltan land.
The complete prepared footprint is 12.4013 times the small original cores;
a new 12.5 limit bounds that source-derived extent. It overlaps existing
same-owner Sicilian reclamation, resolved by existing strict normalization,
but overlaps no original Sicily core. This is a registration correction
with a land relocation, not an append-only change.

The source-supported coastal-band completion is enabled only for states
8516 (Peloponnese) and 8531 (Thrace), where it fills measured source gaps.
It adds only source polygons adjacent to both existing reclaimed land and
the original coast. Source holes and straits remain unfilled.

A reproducible Poros helper regression is also repaired: when a unique
same-source, same-owner generated shoal subsumes an old published land weld,
its exact old footprint is carved out and retained as editable land. The
larger shoal remainder does not become land. Ambiguous coverage and any
other new land occupying the old footprint are rejected.

## Deferred sources and limits

- South Hatay state 3416 / province 19213 is entirely covered by original
  land. Existing Levant states 8544-8556 and 9035 are already configured.
  Coastal-band trials add no new retained land there; no new Levant coverage
  is claimed by this batch.
- Oran 9069 / 18320 remains unresolved across IBR and ALC ownership.
- Benghasi 9084 / 18310 and Ayvacik 9823 / 19165 remain disconnected from
  the actual coast after the existing snap/restore pipeline.
- Edremit 9826 / 19163 is already covered. Castelrosso 9885 / 19220 requires
  an original-island registration instead of the mainland regional fit.
- Detached previous Lesvos fragments and North Samos 9828 / 19160 remain
  unadmitted. The source raster still gives stepped outlines.

Runtime baseline, source probes and candidate:
`.runtime/tmp/atlantropa-southern-push-20260928/`.

## Final geometry and behavior verification

- 53 focused Python tests pass: 14 island-group, 12 land-join, 17 scoped
  rebuild, 9 source-inventory and 1 frozen-locale forwarding test.
- Source geometry, coarse/detail geometry and strict scenario contracts pass.
  Full TNO water validation also passes.
- Focused Playwright checks pass: coastline visibility/refresh (26.7 s) and
  native hit/fill/undo on Samos, Ikaria, Malta and Soke (50.7 s). All fixed
  probes are outside original land, inside the land/coast surfaces and
  outside both named and Atlantropa water. No page errors occurred.
- The preview still requests missing `/assets/sample-runs.json` on startup
  (404), as in the prior run. This separate request did not prevent either
  focused check; no error-free network claim is made.
- Candidate counts: 726 ATL features = 170 land, 70 shoal, 486 water,
  versus baseline 733 = 167 land, 71 shoal, 495 water. Sea geometry splitting
  changes the total; the decrease does not represent removed editable land.
- ATL land adds 0.4108423833 and relocates away 0.1756615321 square degrees.
  All removed ATL land, coast surface and land mask lie inside the old
  misplaced Malta footprint. The original Malta/Gozo, Samos and Ikaria
  cores are fully retained and water-free. Previous Lesvos, Chios and Skyros
  retain their land. All 379 political chunk files are byte-identical.
- Sicily original core coverage now also passes the strict gate: island
  geometry, coastline and water checks have only floating-point tails
  (maximum 2.21e-16 square degrees). The earlier failed candidate is retained
  for diagnosis; its inherited edge gaps are fixed in v2.

Reports: `.runtime/reports/generated/atlantropa-southern-push-20260928/`.
Browser screenshots: `.runtime/browser/atlantropa-southern-push-20260928/`.

## First candidate rejection and Sicily repair

The first candidate passes the standard geometry, strict scenario contract,
water and native-edit checks, but an additional strict original-core check
rejects it. The old Sicily group was already missing 0.00305146476 square
degrees of original island edges; v1 does not enlarge this land/coast gap.
Nevertheless, regenerated ATL water shifts within the existing gap at one
ITG11 component, adding 9.90781307e-8 square degrees of new water overlap
with the original core. A smaller total overlap is not a spatial no-regression
proof, so v1 is not adopted.

Candidate-v2 explicitly preserves the Sicily group's exact baseline core
after smoothing. Existing donor geometry is retained, while the original
island edges are unioned back without importing neighboring political
features. Sea exclusion then uses the corrected island footprint. A focused
regression test demonstrates both smoothing erosion and exact core recovery.
The v2 acceptance gate requires complete original Sicily core coverage and
zero named/ATL water overlap, not merely unchanged historical deficiencies.

## Frozen startup locale source

During v2 regeneration, concurrent edits to the global locale file introduced
11 unrelated UI strings into the stage startup locale. Baseline comparison
correctly rejected that drift. Scoped rebuilding now explicitly supplies the
frozen scenario startup locale to the existing contract-repair writer; other
callers retain the global locale default. Only startup support, bundles and
contracts need refreshing, without regenerating accepted geography.

The final locale refresh preserves `locales.startup.json` byte-for-byte.
Final geometry/baseline comparison and strict contracts pass. A further
browser coastline/startup check passes (22.5 s) after this refresh; the
previous v2 native editing check covers the unchanged geographic assets.
The task-owned preview servers have been stopped. Unrelated local servers
and work remain untouched.

## Data governance completion

Catalog regeneration produces 667 entries, including a concurrently registered
physical-semantics detail resource already present in the workspace registry.
The landing page's two catalog counters are synchronized to 667. Data health
passes with zero errors and report-only large-file warnings. Of the 19 catalog
contract tests, 18 initially pass; the sole stale landing-counter assertion
passes after the numeric update. No unrelated resource registration is removed.
