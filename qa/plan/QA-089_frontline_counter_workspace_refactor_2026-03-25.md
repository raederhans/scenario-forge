# QA-089 Frontline Counter Workspace Refactor

Date: 2026-03-25
Status: In Progress

## Locked Direction
- Keep the political frontline overlay as the owner/controller-derived view only.
- Add a separate `operationalLines` layer for editable battle-planning lines.
- Keep counters and operational lines as separate objects with optional attachment.
- Use a bottom-center four-action command bar for line creation:
  - 作战前线
  - 进攻线
  - 穿插线
  - 防守线
- Keep deep editing inside an expandable central workspace, while the right sidebar remains the launcher and summary surface.

## Implementation Notes
- `operationGraphics` remains for legacy strategic graphics and regression safety.
- `operationalLines` is introduced as a separate save/load collection with its own editor state.
- Counter presets are sourced from `js/core/unit_counter_presets.js` instead of being duplicated in `js/ui/sidebar.js`.
- Counter placement is moving from random/stack-centered layout toward deterministic slot placement keyed by province or attached operational line.
- Counter schema now carries:
  - `iconId`
  - `layoutAnchor`
  - `attachment`
- Operational line schema now carries:
  - `id`
  - `kind`
  - `points`
  - `label`
  - `stylePreset`
  - `attachedCounterIds`

## Scope Guardrails
- No area defense polygons.
- No naval invasion, supply route, or theater-region expansion in this phase.
- No AI semantics or HOI4 command execution logic.

## QA Focus
- Political frontline overlay must remain unaffected.
- Operational lines must draw, select, relabel, and delete independently.
- Counters must preserve stable local ordering after refresh and save/load.
- Counter-to-line attachment must roundtrip through project export/import.
- The command bar should enter draw mode immediately with one click.
