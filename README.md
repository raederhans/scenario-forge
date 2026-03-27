# Map Creator

## Dev Entrypoints

- `start_dev.bat`: build data first, then start the local server.
- `start_dev_fast.bat`: skip the rebuild and start the local server immediately.
- `build_data.bat` and `run_server.bat`: low-level helpers used by the two root entrypoints.

## Browser And E2E Tooling

- `package.json` is the source of truth for the Playwright-based browser inspection and regression test toolchain.
- Run `npm install` at repo root to restore `playwright` and `@playwright/test` from scratch.
- Run `npm run test:e2e` for the full suite, or use the targeted scripts:
  - `npm run test:e2e:project-save-load`
  - `npm run test:e2e:scenario-resilience`
- Run `npm run playwright:install` if Playwright asks for browser binaries on a fresh machine.
- The project-level browser MCP helpers now prefer the repo-local `node_modules/playwright/cli.js` before falling back to npm cache or `npx`.

## Runtime Output Policy

- All temporary outputs, test results, browser inspection evidence, generated reports, and local caches must go under `.runtime/`.
- Checked-in deliverables stay in `data/`. Do not write disposable artifacts directly under the repo root.
