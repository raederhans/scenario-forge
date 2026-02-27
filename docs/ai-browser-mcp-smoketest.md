# AI Browser MCP Smoke Test

Date: 2026-02-26 16:24:24 UTC
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
- .mcp-artifacts/screenshots/gesture-map_pan_zoom-quick-20260226-112302.png
- .mcp-artifacts/screenshots/route-data_readme-quick-20260226-112302.png
- .mcp-artifacts/screenshots/route-docs-quick-20260226-112302.png
- .mcp-artifacts/screenshots/route-home-quick-20260226-112302.png
- .mcp-artifacts/screenshots/section-left_sidebar-quick-20260226-112302.png
- .mcp-artifacts/screenshots/section-right_sidebar-quick-20260226-112302.png

## Console summary
- [quick][route:data_readme] 4:[ERROR] Failed to load resource: the server responded with a status of 404 (File not found) @ http://localhost:8000/data/favicon.ico:0
- [quick][route:data_readme] 5:TypeError: $(...).ready is not a function

## Network summary
- No 4xx/5xx lines matched the summary filter.

## Initial rendering diagnosis clues
- Favicon requests include 404 responses (low severity noise).
- README third-party page logs jQuery compatibility error: $(...).ready is not a function.
- Evidence order follows: console -> network -> screenshots -> repro steps -> patch hint.
