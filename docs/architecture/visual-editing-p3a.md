# Visual editing P3A: migrate consumers and unify paint transactions

Initial base: `5ba80dacb62cb74ad960b557d8ea176fe210ad22`, after PR #162.
Continuation integration target: `aed67962d6f814c7a2d86e3e6d2fb43385704404`,
including the subsequent capital corrections from PR #163. Those source/data
changes are preserved and rechecked with the P3A branch, not overwritten.

## P1/P2 recheck

The agreed P1/P2 scope is present: ownership edits are disabled, mode restore is
visual-only, reference membership is independent of paint, and the compact paint
API is wired into the ordinary renderer. The 89 existing focused behavior tests
passed on the merged source after resolving the local parser dependency; 19
module-boundary tests also passed. This is not a claim of exhaustive validation.
No legacy save conversion or RGB identity policy is added.

## P3A delivered contract

Auto Fill and country-click selection now query immutable scenario baseline
membership, including unloaded members. Blank scenarios use geographic groups.
Geographic indexes may be Arrays or Sets. Neither a stale owner mirror nor an
owner index may change target scope. An incomplete group produces no partial
paint; country clicks explain that detailed members must load first.

Country clicks and drag brushes now use exactly the same per-feature paint
transaction as subdivision painting. They no longer overwrite a geographic
country base color while ignoring the selected scenario group. Erasing removes
feature edits and reveals the current base palette; it does not delete the base
palette or change reference membership. Country-swatch palette edits remain a
separate intentional palette operation. Undo/redo restores the exact feature
batch. The land eyedropper samples persistent paint rather than a temporary
heatmap/highlight color.

The ordinary color strategy, owner-color generation, palette refresh selection,
legend origin lookup, reference border context, parent-border grouping and
scenario owner query use baseline reference data. The old sovereignty getter
names are transition bridges. Their edit/reset methods are inert, and regular
reference publication freezes the runtime mirror. User input cannot revive
ownership edits via import or history. Ownership-only history entries are rejected
before clearing redo; mixed entries retain only their actual editable domains.

The reference and paint APIs remain facades, not duplicate mutable stores.
Geography, water/Atlantropa rules, projection and render scheduling remain in
their existing owners. Field/serializer/resource renaming remains deferred.

## Independent follow-on P3B: paint-derived contours

This PR does NOT claim the entire P3 roadmap is finished. Borders remain reference
borders, now sourced through the read-only boundary. Color-derived contours need
their own topology/chunk and invalidation work, then actual pixel validation.

A cloud audit of the real base data (run `36092572284`) found:

| Scenario | Reference IDs | Full runtime topology IDs | Reference IDs absent from that topology |
|---|---:|---:|---:|
| Modern World | 11,294 | 11,294 | 0 |
| HOI4 1936 | 23,426 | 23,426 | 0 |
| HOI4 1939 | 23,426 | 23,426 | 0 |
| TNO 1962 | 12,696 | 12,022 | 725 |

TNO's 51-feature bootstrap contains shell features rather than the complete leaf
ID set. Missing-reference examples include separately represented Atlantropa
islands. These are ID-coverage measurements, NOT evidence of missing rendered
land or an adjacency/pixel audit. They rule out assuming that one loaded topology
is the whole editable surface. A future contour implementation must account for
supplementary geometry and cross-chunk seams, not silently omit them or fall back
to modern country borders. It must use persistent paint, never sampled screen
pixels, and invalidate on erase, undo, palette changes and geometry promotion.

## Validation

Focused unit/behavior command: `npm run test:node:ownership-retirement`.
This includes reference selection, normal click and drag transactions, fill
hierarchies, history, palette/legend and reference-border consumers.
Browser coverage adds real Modern World hit dispatch, multi-feature country
fill/erase, undo/redo and same-version export/import to the existing retirement
UI check. Actual results are recorded in the PR, not inferred from test presence.

The pristine merged source still fails the historical borrowed-owner proof in
`check_state_writer_policy.mjs` at `political_path_cache_owner.js`. The working
source's direct-write allowlist remains unchanged. No allowance, timeout, route
rule or unrelated proof fingerprint is widened to hide a failure.

## Continuation review corrections

The developer reference-group macro still filtered out unhydrated members. It now
rejects the whole operation before history or paint, just like normal country
clicks and Auto Fill. The geographic macro helper likewise requires complete
Array/Set membership and tolerates an unavailable geographic index. Regression
tests bind the actual composition-root macro instead of duplicating its logic.

The historical overlay test asserted an assignment statement that disappeared
when selective snapshots were introduced. It now executes the real capture
function and checks full/scoped membership and deep-copy isolation; overlay
undo/redo coverage remains. The architecture checker follows the delegated
shared paint transaction and still requires paint, history, render and sidebar
effects. A behavior test checks that both country and subdivision fills publish
exactly one render after their history commit. No fake duplicate render is added
to satisfy the old string assertion.

Generated E2E lists/import graph, route schema and script portfolio are checked as
part of integration. The focused source checks do not replace the outstanding
historical writer-proof work recorded in PR #162: that record identifies both
baseline failures and newer proof-registration gaps. No all-green proof claim or
new protection exception is made by P3A.
