# Atlantropa Mediterranean yellow flash debug 2026-04-13

## 目标
- 复现 app 初次打开时亚特兰托帕地中海局部发黄、缩放后消失的问题
- 判断问题属于 startup shell、detail promotion、water overlay、还是颜色状态切换
- 用最小修复收口，不扩大渲染链改动范围

## 实施清单
- [x] 本地复现并抓证据
- [x] 静态定位可疑渲染链
- [x] 实施最小修复
- [x] 跑定向验证
- [x] 留档归档

## 进度记录
- 2026-04-13：开始排查 Atlantropa 地中海首屏局部发黄问题。
- 2026-04-13：已用本地浏览器复现并抓图，截图在 `.runtime/browser/mcp-artifacts/atlantropa-yellow-debug/`：
  - `02-startup-8s.map.png`
  - `03-detail-16s.map.png`
  - `05-mediterranean-zoom-startup.png`
  - `06-mediterranean-zoom-detail.png`
- 2026-04-13：浏览器证据显示这块“发黄”更像是 **Atlantropa relief overlay 的盐滩纹理层**，不是 special zone：
  - console 没有水域/颜色 4xx，只看到 startup/detail promotion 的常规 warning
  - `state.scenarioReliefOverlaysData.features.length = 25`
  - `state.showScenarioReliefOverlays = true`
  - 启动后 8s：`renderPhase=idle`, `topologyBundleMode=composite`, `detailPromotionCompleted=true`
  - 首次滚轮后立即：`renderPhase=settling`，但 `reliefCount` 仍然是 `25`
  - 1.2s 后回到 `idle` 时，`reliefCount` 仍然是 `25`
- 2026-04-13：静态代码最可疑点已锁到 `js/core/map_renderer.js -> drawScenarioReliefOverlaysLayer()`：
  - `salt_flat_texture` 的填充色就是偏黄的 `RELIEF_SALT_FILL_COLOR`
  - 且 `drawScenarioReliefOverlaysLayer()` 在 `RENDER_PHASE_INTERACTING / SETTLING` 会直接跳过整层绘制
- 2026-04-13：当前判断是：**你看到的首屏地中海局部发黄，大概率是 Atlantropa relief overlay 默认开启；而缩放时它会因为 renderPhase 切到 settling 被整层临时跳过，所以看起来像“缩放后消失”。**
- 2026-04-13：这不是 startup support / whitelist 链路的问题，主嫌疑已经转到渲染层 `scenario relief overlay` 的首帧和交互期策略。
- 2026-04-13：已确认这次“亚特兰托帕地中海首屏发黄”主因不在 startup support，而在 `js/core/map_renderer.js` 的 `scenario relief overlay`：TNO 的 Atlantropa `salt_flat_texture` 默认会画偏黄米色填充，而且交互期这层会被跳过，造成首屏和缩放后的体感不一致。
- 2026-04-13：最小修复已落地：仅对 `tno_1962` 下 `id` 以 `atlantropa_` 开头的 `salt_flat_texture` 做定向去黄处理，改成透明填充 + 冷色极弱描边；不碰 shoreline / contour，也不改 chunk、detail promotion、交互期性能策略。
- 2026-04-13：定向验证已通过：
  - `python -m unittest tests.test_tno_relief_overlay_contract -q`
  - 浏览器截图对比：
    - 修前：`.runtime/browser/mcp-artifacts/atlantropa-yellow-debug/05-mediterranean-zoom-startup.png`
    - 修后：`.runtime/browser/mcp-artifacts/atlantropa-yellow-debug/09-mediterranean-zoom-startup-fixed.png`
  说明首屏泛黄已消失，同时 shoreline / contour 仍保留，detail 后视觉稳定。

## 结论
- 这次问题的根因是 **Atlantropa salt-flat relief overlay 的视觉策略过强**，不是数据错、也不是 startup/detail 载荷切坏。
- 修复后，亚特兰托帕区域不再首屏泛黄，且保持了原有地形边界与轮廓表达，性能策略基本没动。

- 2026-04-13：用户反馈首屏黄块仍间歇存在后，已将修复从单独 `salt_flat_texture` 扩大到 **全部 `atlantropa_*` relief overlay**：
  - `salt_flat_texture`：透明填充 + 冷色弱描边
  - `new_shoreline`：冷色弱 shoreline
  - `drained_basin_contour`：冷色弱 contour
- 2026-04-13：同时新增启动期护栏：`isReliefOverlayEnabled()` 对 `tno_1962` 的 `atlantropa_*` relief overlay 在 `detailPromotionCompleted` 前直接不显示，避免 coarse 首屏阶段的几何/遮罩未稳时闪出异常色块。
- 2026-04-13：定向复核后，首屏抓图已不再出现明显黄块；说明问题更像是 **Atlantropa relief overlay 的暖色首帧表达 + 启动早期显示时机** 共同造成，而不是 startup support 或 chunk 载荷本身错误。
