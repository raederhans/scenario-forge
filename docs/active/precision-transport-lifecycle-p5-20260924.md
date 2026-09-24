# Transport lifecycle and shared-budget extension boundary

Dependency: resource PR158, based on main `2b2f1fecf9c388616a01dfb10da5e372ea65b3dc`.
This branch retains all resource fixes through `71a4eec4` and only adds transport
lifecycle work. It excludes the experimental chunk-payload cache pressure owner.
There is no national data replacement, main update or production deployment.

## Runtime changes

The existing transport line-pack owner now has a cancellable generation, explicit
release, projected-pack retention accounting and shared-budget admission. Duplicate
receivers still share work. Full-pack background hydration and audit loads are
speculative; a user request promotes the existing queued task. Required preview
loads keep their original ability to proceed. Shared scheduler reservations survive
ignored aborts until actual completion, so rapid open/close cannot invent capacity.

Road clear/destroy removes the pack owner's preview/full promises and caches,
retained projected data, SVG nodes and pending receiver. Hide can keep only the
small selected ID; it cannot keep its feature object. Reopening the same country
creates a fresh request generation. Old fetch/carrier/build completions and pending
render continuations cannot republish retired roads or invoke stale hydration.
The rail consumer shares the updated factory and keeps its existing interfaces.

The catalog data-service wrapper now forwards AbortSignal and verifies it before
and after fetch. Same-URL receivers have independent identities: an old failure or
abort cannot overwrite the latest status/metrics or remove its pending identity.
Accepted caller-owned payloads are not mutated when the owner's cache is released.

Resource weights cover owned road records, strings, indexes, native/projected
coordinates and segment records. Borrowed projected endpoint arrays are not counted
twice. The shared carrier, DOM/native canvases and unreported layers remain outside
this estimate. These are retention estimates, not heap/GC measurements. The ledger
is not an authority to mutate political state, country ownership or geometry.

## Source and dataset boundary

This increment uses existing committed Japan road data, not new geographic sources.
`data/transport_layers/japan_road/manifest.json` declares `japan_road_v1`, built
2026-03-31, 4,794 preview roads / 4,187 labels and 75,824 full roads / 4,930 labels.
The carrier is the declared Japan main corridor. Source bbox is approximately
129,30.75,145.824962,45.520413; declared Okinawa exclusion is unchanged.

The existing `source_recipe.manual.json` is the authority, with recipe
`japan_road_v1_osm_osrm_n06` and source hashes:

- `geofabrik_japan_osm_20260330`, version 2026-03-30, ODbL-1.0,
  attribution OpenStreetMap contributors / Geofabrik;
  sha256 `3acd8838a0b6f2f499d416bb35316d4c0880e6f160ea05ee533031a8140267c5`.
- `mlit_n06_2024`, version 2024, Japanese Government Standard Terms of Use
  Version 2.0, attribution MLIT National Land Numerical Information N06;
  sha256 `eeeeb8448e29829e556cec87420de0e4f82e112c7235e9fdfe3c2d9395afb43f`.

License/source snapshots, recipe paths, preview/full payload paths and dependencies
are not replaced. These modern source dates do not establish historical road
coverage. No historical owner-domain or nearest-neighbour assignment is introduced.

## Evidence

Hosted run `35988124968`, job `107595496849`, recorded on source
`f171f5399ea13a68a361d46c7eea76f41bfd5b930`:

- 21 focused cases pass: ten lifetime cases, five data-service cancellation cases
  and six existing data-service behavior cases.
- 29 existing transport workbench cases pass, including rail consumer contracts.
- Architecture boundaries and whitespace pass.
- The new native Chromium probe passes on the actual committed Japan road preview:
  two visible/select/hide cycles, actual SVG paths, zero retained owned packs after
  hide, fresh reopen, and final ledger bytes/owner count restored to the baseline.
  Under deliberately injected scalar ledger pressure the full-road request never
  starts. Browser errors, console warnings/errors, failed requests and HTTP errors
  are all zero.
- Evidence archive 10802927163 sha256:
  `ea66fc7abfd55eba269f425c7d2652897df062a7a13d94d6ac96c6c27b981b48`.

The clean branch uses the same tested runtime/test blobs. The probe's reporting CLI
was subsequently extended to allocate fresh UUID-named reports with --report-dir;
current-head checks must also validate that packaging change and route additions.
The raw native report is canonical-road.json inside the evidence archive.

The browser is an isolated real-data transport consumer and does not import the
political renderer. That proves this direct dependency boundary, not every full-app
invalidator, political pass count, resource-index callback or exported project.
Pressure is explicitly synthetic ledger pressure; data and native SVG rendering
are real. No memory-speedup percentage, full-app FPS or county-candidate latency
is claimed. There are no raised timeouts, weakened assertions or retries.

## Reproduction

```sh
npm ci
npx playwright install chromium
node --test tests/transport_lifetime_behavior.test.mjs tests/data_service_cancellation_behavior.test.mjs tests/data_service_runtime_behavior.test.mjs
node tools/probe_transport_lifetime.mjs --report-dir .runtime/reports/generated/transport-lifetime
```

The probe runs one attempt and writes a new immutable JSON each time. A passing
report requires status=passed; both show/hide cycles must render then release,
ledger estimates/owner count must return to baseline, no full-road fetch may occur
while speculative pressure is held, and all error arrays must be empty. Elapsed
observations include loading and are NOT a controlled old/new benchmark.

## Remaining P2/P5 work

This closes a concrete optional-layer demand/release gap. It does not complete
lightweight political ID/ownership/hierarchy separation, global screen-error LOD,
or replacement of the ready-state full interaction infrastructure. Quick Fill's
missing-member rejection and exact geometry requirements remain unchanged.

The untracked 3,144-county/high-precision candidate bundles still require PR155's
exact-input receipts, per-scenario legacy project tests, mixed-LOD/owner-domain
checks, visual acceptance and target-device measurements. Canonical road success
must not mark those candidates green. Full-editor political pass counters, export
and shared-carrier cache reclamation remain separate acceptance items.

Integration: merge resource PR158 first, then this dependent PR. Other PR155/157/159
catalog records are additive: preserve all original command identities, append all
new records and update the explicit count/order tests for the actual union.
