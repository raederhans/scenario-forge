# Plan

## Goal and scope

Repair the TNO Mediterranean sea gap around 16.5–22 E, 35.2–38.8 N. Add whole-basin closure to the canonical generator, regenerate matching runtime assets, and cover the missing basin in water validation.

## Stages and acceptance

1. Reproduce missing source coverage at (18,36), (20,36), (20,38).
2. Complete only uncovered Mediterranean water, excluding existing land, Atlantropa land, and other legitimate water. Preserve existing feature identities and reviewed names.
3. Refresh standalone topology, metadata, chunks and their contracts; run focused geometry/data checks.
4. Check the repaired area and adjacent seas in an isolated localhost browser page.

## Non-goals and constraints

No changes to existing political ownership or place names, renderer architecture change, full donor rebuild, push, merge or deployment. Register the new synthetic sea in existing feature maps and update derived country counts as required by the scenario contract. Preserve the user's open preview state. Runtime outputs belong in `.runtime/`.
