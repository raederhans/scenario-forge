# Startup Bundle 修复与性能保留方案（2026-04-08）

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
