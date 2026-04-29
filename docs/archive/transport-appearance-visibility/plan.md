# Transport Appearance Visibility Plan

## Goal

Restore the visible transport appearance layers on the main map without changing the current data-loading phase boundary.

## Scope

- Fix airport and port rendering so their point entries can be built without a runtime `ReferenceError`.
- Allow explicit road and rail toggle requests to reach the existing catalog-backed runtime loaders.
- Keep `includeContextLayers === true` as the current eager-pack behavior, so startup does not preload global road or rail catalogs.
- Keep panel summaries as loaded, filtered collection counts; use renderer metrics for viewport-visible counts.

## Steps

- [ ] Confirm current file shape and existing test owners.
- [ ] Patch `js/core/map_renderer.js`.
- [ ] Patch `js/core/data_loader.js`.
- [ ] Extend existing contract tests.
- [ ] Run syntax checks and targeted tests.
- [ ] Run a short browser validation for the four transport toggles.
- [ ] Complete static review and close out docs.
