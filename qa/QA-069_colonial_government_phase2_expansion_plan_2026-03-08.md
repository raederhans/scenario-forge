# QA-069 Colonial Government Phase 2 Expansion Plan

## Objective

After the first-wave colonial government rollout for 1936/1939, identify the next historical administrations worth adding without collapsing the UI into dozens of micro-subjects.

The working rule remains:

- Large, historically legible, start-of-scenario colonial administrations should become `scenario_subject`.
- Small islands, leased ports, highly fragmented protectorates, or low-confidence teaching overlays should stay direct-owned or remain `releasable`.
- We should prefer macro colonial governments when they reflect a real administrative layer or when they clearly improve the map over direct metropolitan ownership.

## Phase 2 Priority: Major Powers

### Britain

Recommended additions:

- `SUD` Anglo-Egyptian Sudan
- `CEY` Ceylon
- `BEA` custom British East Africa macro government
- `BWA` custom British West Africa macro government, or a narrower `NGA` Nigeria-only option

Rationale:

- Britain still has the largest amount of visibly colonial territory left under direct `ENG`.
- Sudan and Ceylon are both historically recognizable and large enough to matter.
- East/West Africa are the only clean way to reduce `ENG` direct ownership further without spawning too many small colonies.

Recommended handling:

- `SUD` should likely be a `scenario_subject` with `subject_kind: "condominium"` or `protectorate`.
- `CEY` should be a `scenario_subject` with `subject_kind: "colony"`.
- `BEA` and `BWA` should be custom macro subjects with parent `ENG`.

Decision points:

- Whether Sudan should support dual parents `["ENG", "EGY"]` in metadata, or remain visually attached to `ENG` only.
- Whether British West Africa should be one macro federation or split into `NGA` and a smaller Gold Coast block.
- Whether Tanganyika should sit inside British East Africa or remain direct-owned because it is a League mandate rather than an ordinary colony.

### France

Recommended additions:

- `MAD` Madagascar
- `SYR` French Mandate for Syria
- `LEB` French Mandate for Lebanon

Rationale:

- France already has its biggest colonial federations and North Africa covered.
- The main remaining omissions are Madagascar and the Levant mandates.
- These are historically clear and use existing tags, so they are low-risk additions.

Recommended handling:

- `MAD` as `scenario_subject` with `subject_kind: "colony"`.
- `SYR` and `LEB` as `scenario_subject` with `subject_kind: "mandate"`.

Decision points:

- Whether the Levant should be represented as two subjects (`SYR` + `LEB`) or one custom combined mandate for cleaner UI.

### Japan

Recommended additions:

- `TAI` or `FORM` style Taiwan subject using the existing Taiwan/`TW` coverage
- `SSM` custom South Seas Mandate macro government if the mapped Pacific coverage is large enough

Rationale:

- Korea is now split out, but Taiwan is still a large missing colonial block.
- The South Seas Mandate is historically important, but only worth doing if it reads clearly at current map scale.

Recommended handling:

- Taiwan should become a `scenario_subject` with `subject_kind: "colony"`.
- South Seas Mandate should be a custom `scenario_subject` with `subject_kind: "mandate"`.

Decision points:

- Whether Taiwan should keep the current `TW` tag or move to a dedicated display name/taging convention.
- Whether the Pacific island mandate is large enough to justify a visible subject row rather than staying direct-owned.

### Italy

Recommended additions:

- None required for colonial scope after `LBA` / `ERI` / `SOM` / `AOI`
- Optional non-colonial extension: `ALB` in 1939 as an Italian protectorate

Rationale:

- The colonial picture is already substantially complete after the first wave.
- Further Italian work becomes a broader subject-state question rather than colonial administration.

### United States

Recommended additions:

- None in the mainline plan
- Optional completeness-only: `PUE`

Rationale:

- `PHI` already covers the one major colonial subject.
- Puerto Rico is real but too small to justify high UI priority.

## Phase 2 Priority: Secondary Colonial Powers

### Spain

Recommended additions:

- `SGN` custom Spanish Guinea
- `SWA` custom Spanish West Africa for Sahara + Ifni
- Optional `SMR` custom Spanish Morocco protectorate

Rationale:

- Spain is the biggest missing secondary colonial power.
- Spanish Morocco is historically important, but geographically small.
- Spanish Guinea and Spanish West Africa are better map-level subjects than trying to model every enclave.

Recommended handling:

- Spanish Guinea and Spanish West Africa should be `scenario_subject`.
- Spanish Morocco can be `scenario_subject` if the geometry reads clearly; otherwise leave it direct-owned.

Decision points:

- Whether Spanish Morocco is too small to justify a permanent subject row.
- Whether Ifni belongs with Sahara or stays direct-owned for simplicity.

### Denmark

Recommended additions:

- `ICE` Iceland as a Danish dependency in 1936
- Optional `GRL` Greenland as low-priority completeness content

Rationale:

- Denmark has very little colonial depth, but Iceland is historically recognizable and already has a familiar tag.
- Greenland is valid but may be too peripheral for start-of-scenario emphasis.

Recommended handling:

- `ICE` as `scenario_subject`.
- `GRL` remains low-priority or `releasable`.

### Belgium

Recommended additions:

- `RUR` custom Ruanda-Urundi subject, only if we want a finer Belgian layer

Rationale:

- Belgian Congo is already the main event.
- Ruanda-Urundi is historically real, but it is a refinement pass, not a high-value first addition.

Recommended handling:

- Keep low priority unless we want to push completeness over UI simplicity.

### Portugal

Recommended additions:

- `GUI` Portuguese Guinea

Rationale:

- Angola and Mozambique already capture most Portuguese colonial weight.
- Portuguese Guinea is the one remaining meaningful African omission.

Recommended handling:

- Add only if we want another medium-priority Africa pass.

### Netherlands

Recommended additions:

- Optional `SUR` Suriname

Rationale:

- Dutch East Indies already solved the main issue.
- Suriname is real but closer to a completeness/detail pass than a structural necessity.

## Suggested Execution Order

1. Britain Phase 2: Sudan, Ceylon, one Africa macro split
2. France Phase 2: Madagascar, then Levant
3. Japan Phase 2: Taiwan, then South Seas Mandate if readable
4. Spain package: Guinea + West Africa, evaluate Morocco separately
5. Denmark/Iceland
6. Belgian and Portuguese refinement pass

## Questions That Need Explicit Approval

1. Should Anglo-Egyptian Sudan be attached only to `ENG`, or should it carry dual-parent metadata under both `ENG` and `EGY`?
2. For Britain in Africa, do you prefer one macro West Africa and one macro East Africa, or a more literal Nigeria / Kenya split?
3. For France in the Levant, do you want `SYR` and `LEB` as separate start subjects, or one combined French Mandate block?
4. For Japan, should Taiwan be promoted in the next wave, or do you want to keep the first-wave line and prioritize the British/French gaps first?
5. For Spain, should Spanish Morocco be treated as a full start subject, or left direct-owned because the zone is too small?
