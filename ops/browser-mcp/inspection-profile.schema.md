# Inspection Profile Schema (`inspection-profile.toml`)

## Purpose
This profile drives section traversal for browser inspection runs.
It defines where to navigate, which sections to inspect, when to escalate from quick to full mode, and how to enforce runtime budgets.

## Top-level fields
- `version` (int): profile format version.
- `[defaults]`: environment and server discovery defaults.
- `[decision]`: mode selection and auto-upgrade rules.
- `[budgets.quick]`, `[budgets.full]`: resource budgets per mode.
- `[evidence]`: evidence capture preferences.
- `[outputs]`: artifact and report paths.
- `[[routes]]`: route traversal units.
- `[[sections]]`: section traversal units on a route.
- `[[gestures]]`: map/canvas interaction units.

## `[defaults]`
- `base_host` (string): host for final browser URL, usually `localhost`.
- `port_range_start`, `port_range_end` (int): dev server scan range.
- `server_title_pattern` (string): page marker used to identify the app root.
- `wsl_windows_fallback` (bool): enable Windows-local fallback server when Edge cannot reach WSL-bound localhost.

## `[decision]`
- `default_mode` (`quick|full|auto`): default CLI mode when `--mode` omitted.
- `auto_start_mode` (`quick|full`): first phase when `mode=auto`.
- `upgrade_on_cross_section_anomaly` (bool): upgrade quick->full when anomalies appear across multiple areas.
- `cross_section_threshold` (int): minimum unique areas to trigger cross-section upgrade.
- `upgrade_on_insufficient_evidence` (bool): upgrade when quick coverage is too small and evidence is weak.
- `min_sections_for_confidence` (int): minimum inspected sections before quick is considered sufficiently representative.
- `full_trigger_keywords` (string array): canonical phrases that imply full traversal.
- `quick_trigger_keywords` (string array): canonical phrases for quick traversal.

## `[budgets.quick]` / `[budgets.full]`
- `max_sections` (int): hard cap for section inspections.
- `max_screenshots` (int): hard cap for captured screenshots.
- `max_runtime_sec` (int): time budget for mode phase.
- `max_network_entries` (int): max network issue rows included in report.

## `[evidence]`
- `console_min_level` (string): expected console level (`warning` recommended).
- `network_include_static` (bool): whether to include static requests in network capture.
- `network_failed_only` (bool): summary focuses on failed/4xx/5xx requests.

## `[outputs]`
- `artifact_dir` (string): root for screenshots/logs.
- `report_path` (string): smoke report output path.

## `[[routes]]`
Required fields:
- `id` (string)
- `url` (string, absolute or app-relative)

Optional fields:
- `scroll` (int, default `0`)
- `screenshot` (bool, default `true`)
- `capture_console` (bool, default `true`)
- `capture_network` (bool, default `true`)
- `enabled_modes` (array, default `['quick','full']`)

## `[[sections]]`
Required fields:
- `id` (string)
- `page` (string, route id)
- `selector` (string, CSS selector)

Optional fields:
- `expand` (`none|click|toggle`, default `none`)
- `scroll` (int, default `0`)
- `screenshot` (`always|on_error|never`, default `on_error`)
- `priority` (`high|normal|low`, default `normal`)
- `enabled_modes` (array, default `['quick','full']`)

## `[[gestures]]`
Required fields:
- `id` (string)
- `page` (string, route id)
- `selector` (string)
- `type` (`drag_zoom` currently supported)

Optional fields:
- `from` (int array `[x,y]`)
- `to` (int array `[x,y]`)
- `wheel` (int, default `0`)
- `screenshot` (bool, default `true`)
- `enabled_modes` (array, default `['quick','full']`)

## Notes
- `--mode quick|full|auto` CLI parameter overrides `decision.default_mode`.
- `--max-runtime-sec` overrides phase runtime budget.
- In `auto`, the script starts with `auto_start_mode` and upgrades to `full` when upgrade rules match.
