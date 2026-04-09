# Startup Bundle 修复与性能保留方案（2026-04-08）

## 执行进度
- [x] 完成 Phase A / B / C 现状复核，确认当前实现与文档存在偏差：A2/A3 仍是部分完成。
- [x] 补齐 Phase A 硬护栏：health gate 前移到 `applyScenarioBundle()` 事务内，mask 契约补齐，失败时先回滚再由启动链决定是否切到 `legacy bootstrap`。
- [x] 落地 Phase B 强契约：`chunked-coarse-first` 缺最小 runtime 壳时不再继续吃 startup bundle，直接回落 `legacy bootstrap`。
- [x] 落地 Phase B ultra-light shell：继续复用 `scenario.runtime_topology_bootstrap` 键，但只保留空壳对象名 + `runtime_political_meta`，不再塞回完整 runtime topology。
- [x] 补齐契约报告、targeted 自动化验证和收尾归档。

## 本轮落地结果
- startup bundle 版本升级到 `v3`，新增 `runtime_political_meta`，并把 `runtime_topology_bootstrap` 收成 ultra-light shell。
- 启动场景应用时，startup bundle 现在会先走事务内 health gate；如果 owner-feature 或 runtime overlay 契约不对，就先回滚，再由启动链自动切回 `legacy bootstrap`。
- hydration fallback 现在不只清 `scenario_water`，还会一起清 `land_mask` / `context_land_mask`，并把只读提示切到专门的 `scenario-health-gate` 文案。
- 构建报告新增 runtime 壳对象存在性、owner/controller 覆盖率和 gzip 预算检查，报告落在 `.runtime/reports/generated/tno_1962.startup_bundle_report.phaseB.json`。

## 本轮验证
- `node --check js/main.js`
- `node --check js/core/scenario_resources.js`
- `node --check js/core/scenario_manager.js`
- `node --check js/workers/startup_boot.worker.js`
- `python -m py_compile tools/build_startup_bundle.py`
- `node node_modules/@playwright/test/cli.js test tests/e2e/startup_bundle_recovery_contract.spec.js --reporter=list --workers=1`

## 后续补充修复（2026-04-08 晚间）
- 修复 chunked detail political features 在并入 runtime land collection 前未做 `normalizeFeatureGeometry()`，解决 `world_bounds` 误判导致的 TNO 无国家填色、南极/外海异常放大。
- 补齐 `scenarioLandMask / scenarioContextLandMask / scenarioWater` 改动后的 renderer invalidation，把 `physicalBase` 一起纳入刷新链；并限制 terrain 开启时的 exact refresh 不再在 startup/apply 阶段强制触发。
- 将 scenario controls 的 apply/reset/exit 改成非阻塞 `renderMode: "request"`，并把 startup 默认场景 apply 也纳入 `scenarioApplyInFlight`。
- 将 `runPostScenarioApplyEffects()` 里的 chunked coarse preload 改为后台任务，同时把 full bundle 的 `releasable_catalog / district_groups / audit` 改成 deferred metadata load，避免阻塞 1939 startup apply。

## 后续补充验证（2026-04-08 晚间）
- `node --check js/core/map_renderer.js`
- `node --check js/core/scenario_post_apply_effects.js`
- `node --check js/core/scenario_recovery.js`
- `node --check js/ui/scenario_controls.js`
- `node --check tests/e2e/tno_open_ocean_rendering.spec.js`
- `node node_modules/@playwright/test/cli.js test tests/e2e/tno_open_ocean_rendering.spec.js --reporter=list --workers=1`
- `node node_modules/@playwright/test/cli.js test tests/e2e/scenario_apply_resilience.spec.js --reporter=list --workers=1`
- `node node_modules/@playwright/test/cli.js test tests/e2e/startup_bundle_recovery_contract.spec.js --reporter=list --workers=1`

## 备注
- `tests/e2e/tno_open_ocean_rendering.spec.js` 单独跑时仍会在 `applyScenarioByIdCommand("tno_1962")` 阶段撞到既有 120s 超时，未纳入本轮修复范围。

## 目标
在不丢失“首屏更快”收益的前提下，修复以下问题：
1. 启动后长时间加载。
2. TNO 1962 启动后国家填色缺失。
3. 海洋/水体出现错误覆盖。

## 现状归因（精简）
- 启动链改成 startup bundle-first 后，首屏确实更快，但首屏使用的是 bootstrap 级数据；
  full hydration 发生在后续异步阶段。
- 当前 startup bundle 产物内不再携带 `scenario.runtime_topology_bootstrap`，
  造成 owner/controller 与实际政治几何（feature id 空间）更容易错配。
- 即便 full bundle 拉取成功，如果“政治几何 promotion”链没有完整触发，
  页面会继续停留在 coarse/base 几何，出现无填色与海洋覆盖异常。

## 设计原则
1. **正确性优先级高于首屏视觉完整度**：首屏可“简”，但绝不能“错”。
2. **分层承诺**：
   - 首屏阶段承诺：可见、可操作、无错误覆盖。
   - 解锁阶段承诺：完整政治几何、正确 ownership、水体遮罩一致。
3. **性能预算刚性化**：每次调整都必须带指标回归（TTFV、TTI、hydrate 总耗时、主线程长任务）。
4. **双兜底**：
   - 数据兜底：startup bundle 与 runtime shell 的最小契约。
   - 运行时兜底：hydration 后强制一致性检查 + 自动补救。

## 修复路线（建议按阶段落地）

### Phase A：先止损（1 天）
**目标**：立即避免“加载完仍损坏”。

- A1. 保留已做的 hydration political promotion 修复（当前分支已有）。
- A2. 增加一致性健康门（health gate）：
  - 统计 `owners` key 与当前 political feature ids 的交集比例。
  - 若低于阈值（例如 0.85）：
    1) 立即触发一次 `full bundle reload + promote`（单次重试）；
    2) 仍失败则进入只读保护并给出显式错误提示。
- A3. 海洋层一致性门：
  - 校验 `scenario_water` / `land_mask` 与当前 runtime political 拓扑版本号一致；
  - 不一致时禁用 scenario water 覆盖，回退 base ocean 渲染并打告警。

**验收**
- 启动后 100% 不出现“无国家填色 + 海洋大块覆盖错位”。
- 允许“逐步细化”，但不允许“错误覆盖”。

### Phase B：补齐 startup 最小契约（1~2 天）
**目标**：保留首屏性能，同时减少错配窗口。

- B1. 重新在 startup bundle 中携带“最小 runtime 壳”（二选一）：
  1) 恢复 `runtime_topology_bootstrap`（推荐，最直接）；或
  2) 仅携带 `political id index + land/water mask 必需对象` 的 ultra-light shell。
- B2. worker 启动解码改为“强契约模式”：
  - 若 startup bundle 标记 `chunked-coarse-first`，但 runtime 最小契约缺失，
    则直接降级到 legacy bootstrap 路径，不进入不完整应用。
- B3. startup bundle 构建器增加契约校验报告：
  - 必需对象是否存在；
  - feature id 映射覆盖率；
  - gzip 体积与预算是否超限。

**验收**
- startup bundle-first 不再出现 owner/feature id 空间错配。
- 首屏时间较当前回退不超过 10%。

### Phase C：减少“启动后漫长加载”体感（2~3 天）
**目标**：把慢路径从“阻塞感知”变成“无感后台”。

- C1. 分离 full hydration 任务：
  - `political 必需` 与 `optional layers`（relief/cities 等）拆分优先级。
- C2. 将 full hydration 的 CPU 重任务更多下沉 worker。
- C3. 引入 hydration 进度状态（仅开发态默认展示，必要时可对用户展示简版）。
- C4. 对 chunk registry 与 runtime meta 做缓存命中优化（版本 hash 键）。

**验收**
- 首次可交互后的 5s 窗口内，主线程长任务显著下降。
- 用户可感知等待减少（交互不中断、无明显卡顿）。

### Phase D：回归与发布护栏（1 天）
- D1. 新增 e2e 场景：
  1) startup bundle-first 冷启动；
  2) full hydration 后颜色/海洋正确性断言；
  3) runtime 契约缺失时自动降级断言。
- D2. 新增 CI 合同检查：
  - 启动包体积预算；
  - runtime 契约字段完整性；
  - owner-feature 覆盖率门槛。

## 推荐实施顺序（最小风险）
1. 先做 Phase A（止损兜底）。
2. 再做 Phase B（补齐数据契约）。
3. 最后做 Phase C（继续压体验时延）。
4. Phase D 全程并行补上自动化。

## 回滚策略
- 任一阶段只要触发：
  - 启动错误率上升；
  - TTI 回退超过预算；
  - 海洋覆盖异常复现；
  即切回 `legacy bootstrap` + 禁用 startup bundle-first 的开关（按场景白名单逐步恢复）。

## 里程碑输出
- M1（止损）：不再出现损坏地图。
- M2（契约）：startup bundle 与 runtime shell 合同稳定。
- M3（体验）：首屏快 + 启动后无漫长“假加载感”。
