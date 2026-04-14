# Atlantropa Mediterranean residual overlay fix 2026-04-13

## 目标
- 修复 TNO 1962 在 startup bundle / detail promotion 改动后，亚特兰托帕海域首屏或缩放停下后仍残留的发黄/接缝问题。
- 保持现有启动、chunk、detail promotion、交互性能策略不降级。
- 用最小改动收口到 scenario overlay 渲染链，不回退到旧的暖黄色视觉。

## 实施清单
- [x] 复现并确认问题落在 coarse/detail 切换与 contextScenario pass 缓存链
- [x] 实施最小代码修复
- [x] 跑定向自动化验证
- [x] 复核并归档

## 进度记录
- 2026-04-13：已复查浏览器与静态渲染链，当前问题不再像最早那样是单纯的 Atlantropa relief 配色，而更像是 detail/composite 状态切换后 scenario overlay 缓存没有严格失效。
- 2026-04-13：已确认 `contextScenario` pass 的签名没有纳入 `topologyBundleMode` / `detailPromotionCompleted` / `detailPromotionInFlight`，而 Atlantropa relief 只靠运行时条件决定是否显示，容易让 coarse 阶段旧缓存残留到 detail 后，或反过来残留到停下后的稳定帧。
- 2026-04-13：已确认 startup bundle 自带的 runtime bootstrap 不含 Atlantropa political 几何；问题主链仍在 `js/core/map_renderer.js` 的 scenario overlay pass，而不是 startup data 真把盐滩 land 画进了 coarse 拓扑。
- 2026-04-13：已实施最小修复：
  - `getScenarioOverlaySignatureToken()` 现在把 `topologyBundleMode`、`detailPromotionCompleted`、`detailPromotionInFlight` 纳入签名，保证 coarse/detail 切换时 `contextScenario` 缓存必然失效。
  - `isReliefOverlayEnabled()` 对 `atlantropa_*` overlay 额外要求 `topologyBundleMode === "composite"`，避免 single/coarse 阶段把这层误画出来。
- 2026-04-13：定向验证已通过：
  - `python -m unittest tests.test_tno_relief_overlay_contract -q`
  - `PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:8810 node node_modules/@playwright/test/cli.js test tests/e2e/tno_ready_state_contract.spec.js --reporter=list --workers=1`
- 2026-04-13：结论确认：这次残留黄块/接缝的主因是 **scenario overlay cache key 缺 detail phase，叠加 Atlantropa overlay 只靠单一 ready 条件门控**，不是数据源再次退回了旧黄纹理。

## 结论
- 修复后，Atlantropa overlay 只会在真正的 composite detail 稳态下参与绘制。
- coarse 阶段和 detail 切换后的稳定帧都会强制重算 `contextScenario`，避免旧缓存残留。
- 改动只触及 scenario overlay 门控和缓存签名，没有改重启动链、chunk 选择或交互性能策略。
- 2026-04-13：继续复核后确认首屏残留的真正根因不是 relief pass 自己还在乱画，而是 **startup bundle 先把场景带到 ready/composite，但 full scenario hydration 还按 4.2s 延后调度，导致 `scenarioLandMaskData` / `scenarioContextLandMaskData` 在首屏稳定阶段仍为空**。
- 2026-04-13：已将修复从“只收紧 overlay pass”补到“缺 mask 时提前 full scenario hydration”：`js/main.js` 会在检测到活动场景已有 runtime topology URL 但 mask 仍为空时，把 `post-ready-scenario-hydration` 从常规延后改成快速调度。
- 2026-04-13：复核结果：detail ready 后立即检查，`scenarioLandMaskData.features.length === 1`、`scenarioContextLandMaskData.features.length === 1`，不再需要等 6 秒背景补水合；对应 e2e `tests/e2e/tno_ready_state_contract.spec.js` 已新增快速水合断言并通过。
