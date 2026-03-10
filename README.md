# Map Creator

## Dev Entrypoints

- `start_dev.bat`: build data first, then start the local server.
- `start_dev_fast.bat`: skip the rebuild and start the local server immediately.
- `build_data.bat` and `run_server.bat`: low-level helpers used by the two root entrypoints.

## Runtime Output Policy

- All temporary outputs, test results, browser inspection evidence, generated reports, and local caches must go under `.runtime/`.
- Checked-in deliverables stay in `data/`. Do not write disposable artifacts directly under the repo root.
