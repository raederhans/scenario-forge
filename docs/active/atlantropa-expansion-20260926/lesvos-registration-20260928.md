# South Lesvos and neighboring island registration

The validated `lesvos-v2` candidate is adopted locally to
`data/scenarios/tno_1962`. South Lesvos joins the existing Lesvos feature;
the total stays at 733 ATL features: 167 land, 71 shoal and 495 water.
Twenty scenario files changed, with every canonical source file checked
against the frozen baseline before atomic replacement. All candidate files
then matched their canonical counterparts. No commit, push or deployment.

## Source evidence and scope

| Island | Original HGO province | Target baseline component | Reclamation states | Retained feature / owner |
| --- | --- | --- | --- | --- |
| Lesvos | 8435 | Lesvos component of EL411 | 8536, 9829 | ATLISL_aegean_lesvos / TUR |
| Chios | 6550 | Chios component of EL413 | 8538 | ATLISL_aegean_chios / TUR |
| Skyros | 13353, in state 1223 | Skyros component of EL642 | 8524 | ATLISL_aegean_GRE_5 / GRE |

State 9829's filename says Eastern Vis, but all three English localization
tables identify South Lesvos. Province 19159 directly touches original Lesvos
province 8435 in the source bitmap. Both Lesvos reclamation states now use
the same original-island transform. EL411 also contains Limnos: the new
component selector requires exactly one complete island and rejects empty,
ambiguous or clipping windows. It never clips the target to the window.

The first isolated candidate, aligning Lesvos alone, was rejected by the
strict builder: its TUR footprint overlapped the old GRE Skyros geometry by
0.004530279116839476 square degrees. Registering Skyros and Chios against
their own original islands removes that conflict. Skyros retains its
published numeric feature ID so owner/core mappings remain valid.

The resulting Skyros extension overlaps old GRE Euboea / neighboring
reclamation geometry. Existing same-owner normalization resolves these
overlaps (0.0421592791 and 0.0241918904 square degrees); no original neighboring
island core lies in the new Skyros footprint. No cross-owner priority or
overlap tolerance was introduced.

This is a registration correction, not an append-only land addition.
It removes 0.2735441190 square degrees of the three old island footprints
and adds 0.6910892146 square degrees at source-aligned positions. No land
loss occurs outside those three old footprints. Each original island is
fully retained, and Limnos is unchanged. The source bitmap still produces
stepped outlines; this does not establish precise real-world coastlines.

Two detached Lesvos source components remain deferred because they have no
original-island anchor: 0.0071580378 and 0.0357901888 square degrees. The first
belongs to the South Lesvos source area; admitting its connected portion
does not mean every pixel of state 9829 has been migrated.

## Verification

- Island alignment / scoped rebuild / source inventory unit tests: 35 pass.
- Source, coarse and detail ATL geometry checks, with frozen baseline: pass.
- Strict scenario contracts and full TNO water validation: pass.
- Original island coverage, bounded land relocation, unchanged Limnos,
  existing owner/controller/core mappings and surface-loss checks: pass.
- All 192 active political chunks are preserved; 379 political chunk files
  including retained inactive files match the baseline. The rebuild reports
  80 helper identities preserved.
- Focused Playwright checks: coastline switching passes (18.8 s); native
  hit, fill and undo on all three islands passes (37.0 s). The Lesvos fixed
  probe is inside newly admitted province 19159. Probes are outside original
  land, inside the current land/coast surfaces and outside water; no page
  errors occurred.
- The frozen preview logged a 404 for `/assets/sample-runs.json` on each
  startup. It did not prevent either focused check; this run does not claim
  an error-free network audit or fix that separate sample-list request.
- Catalog regenerated: 666 entries, no content delta. Data health passes
  with zero errors and 10 existing report-only large-file warnings; all 19
  catalog contract tests pass. Task-owned preview and test processes exited.

Runtime baseline, rejected v1, accepted v2 and probes:
`.runtime/tmp/atlantropa-lesvos-20260928/`.
Validation reports: `.runtime/reports/generated/atlantropa-lesvos-20260928/`.
Native screenshots: `.runtime/browser/atlantropa-lesvos-20260928/`.

Oran's ownership partition, Benghasi's coastal contact, detached island
fragments and the wider Black Sea migration remain separate unresolved work.
