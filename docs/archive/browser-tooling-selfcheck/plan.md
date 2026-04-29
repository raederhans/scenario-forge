# Browser Tooling Selfcheck Fix

## Goal
- Make Browser Use and the project browser inspection path open the intended app surface.
- Keep the fix narrow: CLI path, inspection route, live server selection, and app readiness wait.

## Acceptance
- Browser Use can open an external HTTPS page without the app-server path error.
- Browser Use can open the local app and see `#mapContainer`.
- Browser inspection profile routes `home` to `/app/`.
- The smoke script can reuse a live `active_server.json` port and waits for app readiness before screenshots or section actions.

