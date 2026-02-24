# AI Browser MCP Smoke Test

Date: 2026-02-24 14:55:06 UTC
Profile: ops/browser-mcp/inspection-profile.toml
Requested Mode: quick
Executed Phases: quick
Auto Upgrade: not triggered
Base URL: http://localhost:8000

## Visited URLs
- http://localhost:8000/
- http://localhost:8000/data/ne_10m_admin_1_states_provinces.README.html
- http://localhost:8000/docs/

## Covered Sections
- [quick][home] country_list (#countryList)
- [quick][home] left_sidebar (aside.sidebar .sidebar-sections)
- [quick][home] map_container (#mapContainer)
- [quick][home] preset_tree (#presetTree)
- [quick][home] right_sidebar (#rightSidebar .sidebar-sections)

## Skipped Sections
- None

## Screenshot files
- .mcp-artifacts/screenshots/gesture-map_pan_zoom-quick-20260224-095322.png
- .mcp-artifacts/screenshots/route-data_readme-quick-20260224-095322.png
- .mcp-artifacts/screenshots/route-docs-quick-20260224-095322.png
- .mcp-artifacts/screenshots/route-home-quick-20260224-095322.png
- .mcp-artifacts/screenshots/section-left_sidebar-quick-20260224-095322.png
- .mcp-artifacts/screenshots/section-right_sidebar-quick-20260224-095322.png

## Console summary
- [quick][route:data_readme] 4:[ERROR] Failed to load resource: the server responded with a status of 404 (File not found) @ http://localhost:8000/data/favicon.ico:0
- [quick][route:data_readme] 5:TypeError: $(...).ready is not a function

## Network summary
- No 4xx/5xx lines matched the summary filter.

## Initial rendering diagnosis clues
- Favicon requests include 404 responses (low severity noise).
- README third-party page logs jQuery compatibility error: $(...).ready is not a function.
- Evidence order follows: console -> network -> screenshots -> repro steps -> patch hint.

---

## QA-023 Addendum (2026-02-24)

### Console
- Home route未观察到 `topology.highres` 404 或 “primary too coarse -> fallback .bak” 历史告警。
- 仅保留文档页低优先级噪音：
  - `GET /data/favicon.ico 404`
  - `TypeError: $(...).ready is not a function`（README 页面脚本）

### Network
- Quick run summary 未发现首页关键地图资源 4xx/5xx。
- 与 QA-021 对比，默认路径不再请求 `data/europe_topology.highres.json`。

### Screenshots
- `.mcp-artifacts/screenshots/route-home-quick-20260224-095322.png`
- `.mcp-artifacts/screenshots/gesture-map_pan_zoom-quick-20260224-095322.png`
- `.mcp-artifacts/screenshots/section-left_sidebar-quick-20260224-095322.png`
- `.mcp-artifacts/screenshots/section-right_sidebar-quick-20260224-095322.png`

### Repro
1. `python3 tools/dev_server.py`
2. 打开 `http://localhost:8000/`
3. 保持默认参数（不加 `topology_variant`，不加 `detail_layer=off`）
4. 观察 composite 渲染结果与右栏新控件（`Paint Granularity`）

### Patch note
- 默认渲染路径为 primary + detail 组合，不再隐式自动回退 `.bak`。
- 颜色模型采用 `countryBaseColors + featureOverrides`。
- 边界采用 country/province/local 分层与缩放联动。
