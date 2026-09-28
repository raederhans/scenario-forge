# Atlantropa continuation — 2026-09-28

## Scope and source decision

Continue the existing 730-feature local TNO scenario without changing unrelated
work in the primary checkout. Candidate build and baseline live under
`.runtime/tmp/atlantropa-continuation-20260928`; the root agent owns all builds,
adoption and browser checks. No remote publication is authorized by this task.

The previous deferral of states 9843 / 9844 as unresolved Lesvos / Chios islands
was based on stale state filenames. All three local English source tables agree:

| State / province | State filename label | Localized source label | Existing coastal ownership |
| --- | --- | --- | --- |
| 9843 / 19191 | Western Lesvos | Bodrum Atlantropa Zone | TR323: TUR; cores TUR |
| 9844 / 19190 | Eastern Chios | Milas Atlantropa Zone | TR321 and TR323: TUR; cores TUR |
| 9829 / 19159 | Eastern Vis | South Lesvos Atlantropa Zone | Regional affine incorrectly reaches Turkey; deferred pending island registration |

Source tables, relative to `historic geographic overhaul`:

- `localisation/state_names_l_english.yml`
- `localisation/replace/state_names_l_english.yml`
- `localisation/replace/HGO_states_names_l_english.yml`

The raw source positions and existing regional affine place 9843 / 9844 on the
southwestern Turkish coast. The unbuffered prospective land has coastal contact
of 0.695268 / 0.549409 degrees, respectively. These are angular lengths, not
kilometres or an absolute positional accuracy claim. Evidence is in
`admission-probe.json`, `source-labels.json` and `island-source-index.json` under
the runtime directory above.

## Implementation and validation state

- The isolated v1 trial exposed a behavioral consequence of stale names: the
  `lesvos` name hint classified Bodrum as an island. It was stopped and rejected.
- v2 registers both states with TUR and uses two explicit, source-supported
  `state_name_overrides` in the Aegean region. Other source names and region
  registrations remain unchanged. Bodrum and Milas now generate as
  `ATLPRV_19191` / `ATLPRV_19190`, with `donor_land` roles.
- The inventory preserves filename labels and separately reports all English
  localization labels and source paths, including `replace`; disagreements are
  evidence for review, never automatic adoption or engine precedence claims.
- Final serialized geometry removes zero old render-land area and adds
  0.08592015568914929 square degrees. Bodrum / Milas measure approximately
  570.03 / 278.53 km² using the WGS84 geodesic area calculation.
- v2 passed source/chunk geometry, strict scenario contracts, full water
  validation and all three focused browser tests. Its assignment-preservation
  gate rejected the retirement of `ATLSHL_aegean_5`: new source attribution had
  renamed the same shoal to `ATLSHL_aegean_34`. The measured Hausdorff difference
  was 1.4210854715202004e-14 degrees and symmetric-difference area was
  2.4008524834304144e-17 square degrees. The final v3 build retains this identity
  and its published coordinates while retaining the new donor evidence.
- Helper matching now permits retained source lineage to grow, only with the
  same helper role/region and unique geometry match. Numeric equivalence checks
  both boundary distance (at most 1e-12 degrees) and symmetric-difference area
  (at most the smaller of 1e-12 square degrees and 1e-9 of the old area).
  Changed footprints, replacement donors and ambiguous matches remain blocked.
  The new regression covers extended evidence, roundoff, changed geometry,
  lost source states and missing province evidence; all 16 rebuild tests pass.

Oran remains blocked on an evidenced IBR / ALC partition; Benghasi remains
deferred because its current candidate has no continuous coastal contact.
South Lesvos's anchored portion was subsequently admitted through the
[Lesvos / Chios / Skyros registration increment](lesvos-registration-20260928.md).
Its province 19159 shares 0.3515625 degrees of raw-source boundary
with original Lesvos province 8435 (zero overlap), whereas its distance to Chios
province 6550 is 0.140625 degrees. See `south-lesvos-source-contact.json` under
the runtime directory. The target `EL411` includes Lesvos and Limnos, so it
cannot be used as a whole-feature bounding-box anchor for Lesvos alone.
Full Black Sea migration remains outside this bounded increment.

## Final local adoption

The final v3 candidate is adopted to `data/scenarios/tno_1962`. Its 25 changed
files were guarded against the frozen source before copying. A Windows mapped
file lock interrupted copying at `runtime_topology.topo.json`; already copied
files were checked against the candidate, all remaining files against the
baseline, then atomic replacements completed the operation. Every candidate
file subsequently matched the canonical file bytes. No commit, push or
deployment was performed.

- ATL counts: 730 → 733 total; 165 → 167 land; 70 → 71 shoal; 495 water unchanged.
- Source/coarse/detail geometry and full water validation pass; no old land
  loss, new land / named-water overlap, or named-water geometry changes.
- Strict scenario contract passes. Existing owner/core assignments survive;
  79 helpers retain their identities and all 192 political chunks retain their
  original bytes. `ATLSHL_aegean_5` keeps its published coordinates and identity.
- Final browser suite: coastline source/visibility (17.0 s), Marmara / Constantine
  native hit/fill/undo (35.9 s), Bodrum / Milas native hit/fill/undo (31.1 s), all
  pass. New land probes are in land and coastline surfaces, outside original
  land, and outside ATL/named water. No page errors were reported.
- Source inventory tests: 9 pass. Scoped rebuild tests: 16 pass.
- Data catalog regenerated with 666 entries and no tracked content delta;
  data health passes with zero errors and 10 report-only large-file warnings.
  All 19 data catalog contract tests pass. Targeted diff whitespace checks pass.
- Native screenshots are at `.runtime/browser/atlantropa-continuation-20260928/`.
  Detailed reports are at `.runtime/reports/generated/atlantropa-continuation-20260928/`;
  browser log is `browser-v3.log` under the task runtime directory. Earlier
  rejected v2 reports remain in the report directory's `v2/` subdirectory.
- All task-owned preview servers and browser tabs have been closed; builds,
  checks and test processes have exited. The frozen baseline is retained for
  recovery, and unrelated primary-checkout changes are preserved.

The retained source bitmap still produces stepped outlines in the wider
Aegean. This increment adds evidence-backed coast parcels; it does not claim
that island registration or coastline precision is complete.


## Southern push completed

See [southern-push-20260928.md](southern-push-20260928.md) for the adopted
v2 batch, source decisions, exact-core repair, frozen locale isolation and
validation. Canonical ATL now has 170 land / 70 shoal / 486 water features.
Next unresolved areas remain Oran, Benghasi, Ayvacik and unanchored island
fragments; the inspected Levant candidates are already covered.
