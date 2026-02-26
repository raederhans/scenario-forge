# AI Browser MCP Smoke Test

Date: 2026-02-26 15:39:16 UTC
Profile: /tmp/inspection-parent-ui.toml
Requested Mode: full
Executed Phases: full
Auto Upgrade: not triggered
Base URL: http://localhost:8000

## Visited URLs
- http://localhost:8000/
- http://localhost:8000/data/ne_10m_admin_1_states_provinces.README.html
- http://localhost:8000/docs/

## Covered Sections
- [full][home] country_list (#countryList)
- [full][home] left_sidebar (aside.sidebar .sidebar-sections)
- [full][home] map_container (#mapContainer)
- [full][home] map_style_details (details.card)
- [full][home] preset_tree (#presetTree)
- [full][home] right_sidebar (#rightSidebar .sidebar-sections)

## Skipped Sections
- None

## Screenshot files
- .mcp-artifacts/screenshots/gesture-map_pan_zoom-full-20260226-103748.png
- .mcp-artifacts/screenshots/route-data_readme-full-20260226-103748.png
- .mcp-artifacts/screenshots/route-docs-full-20260226-103748.png
- .mcp-artifacts/screenshots/route-home-full-20260226-103748.png
- .mcp-artifacts/screenshots/section-left_sidebar-full-20260226-103748.png
- .mcp-artifacts/screenshots/section-map_style_details-full-20260226-103748.png
- .mcp-artifacts/screenshots/section-right_sidebar-full-20260226-103748.png

## Console summary
- [full][route:data_readme] 4:[ERROR] Failed to load resource: the server responded with a status of 404 (File not found) @ http://localhost:8000/data/favicon.ico:0
- [full][route:data_readme] 5:TypeError: $(...).ready is not a function

## Network summary
- No 4xx/5xx lines matched the summary filter.

## Initial rendering diagnosis clues
- Favicon requests include 404 responses (low severity noise).
- README third-party page logs jQuery compatibility error: $(...).ready is not a function.
- Evidence order follows: console -> network -> screenshots -> repro steps -> patch hint.
