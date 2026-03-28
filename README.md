# Map Creator

## Dev Entrypoints

- `start_dev.bat`: build data first, then start the local server.
- `start_dev_fast.bat`: skip the rebuild and start the local server immediately.
- `build_data.bat` and `run_server.bat`: low-level helpers used by the two root entrypoints.

## Python Test Environment

- `requirements.txt` is the source of truth for Python runtime dependencies used by the map build scripts and Python unit tests.
- `requirements-dev.txt` layers Python test tooling on top of the runtime dependencies. Use it for local test environments and CI-style validation.
- The checked-in `.venv/` is a WSL/Linux virtual environment layout (`.venv/bin/python`). PowerShell will not use it directly.
- On Windows PowerShell, create a separate Windows virtual environment instead of relying on the system Python or the checked-in WSL `.venv`.

### Windows PowerShell

- Create a local virtual environment:
  - `py -3.12 -m venv .runtime\tmp\venv-win`
- Activate it:
  - `. .\.runtime\tmp\venv-win\Scripts\Activate.ps1`
- Install Python runtime and test dependencies:
  - `python -m pip install --upgrade pip`
  - `python -m pip install -r requirements-dev.txt`
- Run Python tests:
  - `python -m unittest discover -s tests -p "test_*.py"`
  - `python -m pytest tests -q`

### WSL / Linux

- Create or recreate the project virtual environment:
  - `python3.12 -m venv .venv`
- Activate it:
  - `source .venv/bin/activate`
- Install Python runtime and test dependencies:
  - `python -m pip install --upgrade pip`
  - `python -m pip install -r requirements-dev.txt`
- Run Python tests:
  - `python -m unittest discover -s tests -p "test_*.py"`
  - `python -m pytest tests -q`

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
