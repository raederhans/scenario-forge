# QA-029: Subdivision Visibility + Tool Binding + Local Vendor Fallback (2026-02-25)

## Scope
目标：修复“看起来只剩国家级、下级地块不见了”的回归，并同时回归检查 subdivision/country 填色与交互链路。

## Root Cause Summary
1. 视觉层面：低缩放下 internal border 的 alpha/width 过低，subdivision 在世界视图容易被误判为“没加载”。
2. 交互层面：工具按钮 class 选择器与 HTML 不匹配（`.tool-button` vs `.btn-tool`），导致 Eraser/Eyedropper 实际无法切换。
3. 运行环境层面：CDN 资源在部分环境被拦截（D3/topojson），会造成前端降级/空白，干扰真实排查。

## Code Changes
1. `index.html:306-307`
- D3/topojson 改为本地 vendor 依赖：
  - `vendor/d3.v7.min.js`
  - `vendor/topojson-client.min.js`

2. `js/ui/toolbar.js:45`
- 工具按钮选择器改为兼容双 class：
  - `document.querySelectorAll(".tool-button, .btn-tool")`

3. `js/core/map_renderer.js:63-66,1472-1474`
- 提升低缩放 subdivision 可见性：
  - `INTERNAL_BORDER_PROVINCE_MIN_ALPHA: 0.30`
  - `INTERNAL_BORDER_LOCAL_MIN_ALPHA: 0.22`
  - `INTERNAL_BORDER_PROVINCE_MIN_WIDTH: 0.52`
  - `INTERNAL_BORDER_LOCAL_MIN_WIDTH: 0.36`
  - `lowZoomDeclutter: 0.82`
  - `lowZoomWidthScale: 0.92`
  - `lowZoomInternalBoost: 1.55` (k < 1.45)

## Validation
### A. Data/mesh presence
- Runtime confirms composite mode loaded:
  - primary: 199
  - detail: 8305
  - merged land features: 8413
- Runtime confirms hierarchy border mesh exists:
  - `cachedLocalBorders`: non-empty (segments ~17k)
  - `cachedProvinceBorders`: non-empty

### B. Tool switching
- Before fix: `state.currentTool` 恒为 `fill`。
- After fix: `fill -> eyedropper -> eraser -> fill` 正常切换。

### C. Fill interaction regression
- country 模式点击 FR 子地块：只写 `countryBaseColors.FR`，`featureOverrides` 保持 0。
- subdivision 模式点击：写入 `featureOverrides[FR_ARR_*]`，且不清空国家基色。
- eraser 模式点击同点：对应 subdivision override 正常清除。

### D. Visual check (Playwright)
- 世界视图与 zoom-in(约 k=3) 下，subdivision 边界可见性提升，hover 命中正常。

## Evidence Artifacts
- `.mcp-artifacts/playwright_default_after_subdivision_visibility_tune.png`
- `.mcp-artifacts/playwright_zoom3_after_tune.png`
- `.mcp-artifacts/playwright_fr_bounds_clicks.png`
- `.mcp-artifacts/playwright_granularity_regression.png`

## Known Constraints
- `detail` 数据覆盖仍是 “91 国细分 + 106 国国家级兜底”（数据覆盖边界，不是渲染删除）。
- 控制台仍有字体 CDN 被拦截（`fonts.googleapis.com`）；不影响地图数据/交互主流程。

## Conclusion
本次已把“下级地块显示 + 下级交互链路”恢复到可用状态：
- subdivision 数据与边界确实在渲染；
- country/subdivision/eraser/eyedropper 交互链路可用；
- 同时消除了 CDN 依赖导致的误判风险。
