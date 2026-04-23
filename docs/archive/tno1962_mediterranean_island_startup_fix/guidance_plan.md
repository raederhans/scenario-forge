# Guidance Plan

来源：用户提供的上一位代理计划，作为本轮执行真源。

## Summary
- 主根因分两层：
  1. startup 进入 ready 后，首个 scenario chunk refresh / promotion 没有真正提交，运行时停在 `selectionVersion=0` 的失败态。
  2. full TNO 产物里的 `ATLISL_*` 仍有 checked-in 漂移，真实岛屿里还留着 `interactive=false` 和旧的 `cntr_code`。
- 本轮保持 startup shell 合同不变，先修 handoff，再统一 ATLISL 数据契约，再做定向回归。

## Key Changes
- **运行时 handoff**
  - 在 `js/main.js` 的通用 ready 路径里，只要当前场景存在 `scheduleScenarioChunkRefreshFn`，就执行 `flushPendingScenarioChunkRefreshAfterReady("ready-state")`，不再把这条逻辑只留在特定 readonly 分支。
  - 在 `js/core/scenario_post_apply_effects.js` 保持现有 first-frame prewarm 逻辑，只把 refresh handoff 明确接到 ready 后的提交路径。
  - 在 `js/core/scenario/chunk_runtime.js` 收口 deferred refresh / pending promotion 的首提交流程，保证 startup 结束后会发生一次有效 promotion：`selectionVersion > 0`，`shellStatus` 离开当前 `idle` 失败态。

- **ATLISL 数据契约**
  - 在 `tools/patch_tno_1962_bundle.py` 明确写死：全部 `ATLISL_*` 都按真实岛屿处理，统一 `interactive=true`、`cntr_code="ATL"`。
  - `owners.by_feature.json` 继续作为真实归属真源，owner/controller/core 继续从现有映射生成。
  - visual-only helper 继续保留当前 helper 前缀和语义，不进真实岛屿命中集合。
  - 用 `python tools/patch_tno_1962_bundle.py` 重建并提交 TNO 相关 checked-in 产物。

## Contract / acceptance criteria
- ready 后 15 秒内：
  - `state.scenarioHydrationHealthGate.status === "ok"`
  - `state.runtimeChunkLoadState.selectionVersion > 0`
  - `state.runtimeChunkLoadState.shellStatus !== "idle"`
- settled 后以下 sentinel 岛屿能进入 land/hit 集合并正确命中：
  - `ATLISL_tyrrhenian_corsica`
  - `ATLISL_sicily_tunis_sicily`
  - `ATLISL_aegean_crete`
  - `ATLISL_levant_cyprus`
- checked-in TNO 产物满足：
  - 全部 `ATLISL_*` 都出现在 `owners.by_feature.json`
  - 全部 `ATLISL_*` 的 `cntr_code === "ATL"`
  - 全部 `ATLISL_*` 的 `interactive === true`

## Test Plan
- **静态 / contract**
  - 扩展 `tests/test_scenario_chunk_refresh_contracts.py`：锁住 ready 后首个 refresh / promotion 提交流程
  - 扩展 `tests/test_startup_hydration_boundary_contract.py`：锁住 startup shell 保持 shell-only，health gate 仍走现有合同
  - 扩展 `tests/test_tno_bundle_builder.py`：锁住 `ATLISL_*` 的 owner 覆盖、`interactive=true`、`cntr_code="ATL"`

- **浏览器回归**
  - 复用当前复现入口打开 TNO1962，等待 settled
  - 通过条件：
    - `landData.features.length` 脱离当前失败签名 `198`
    - `selectionVersion > 0`
    - `loadedChunkIds.length >= 3`
    - 点击 Corsica / Sardinia / Sicily / Crete / Cyprus 命中岛屿自身 feature
    - 地中海与岛屿区域不再出现当前截图里的异常配色和错误命中
    - 截图和状态继续留在 `.runtime/browser/`