# Context

- Browser Use plugin was enabled and could inspect localhost through the Node REPL path.
- External HTTPS navigation failed because `CODEX_CLI_PATH` pointed to a missing `.sandbox-bin\codex.exe`.
- Project browser profile opened `/`, while configured selectors belong to `/app/`.
- Immediate screenshots could catch the startup overlay before the map became usable.
- WSL Playwright can run in a Linux browser process, so a Windows-only localhost fallback is not reachable from that browser; the inspection script now has a WSL static fallback for read-only visual smoke checks.
