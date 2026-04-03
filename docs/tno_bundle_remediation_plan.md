# TNO Bundle 修复计划（基于 2026-04-03 本地实测）

## 1) 当前测试结果

已执行并通过：

1. `python -m py_compile tools/patch_tno_1962_bundle.py tests/test_tno_bundle_builder.py`
2. `python -m pytest -q tests/test_tno_bundle_builder.py -k 'owner_only_backfill or checkpoint_build_lock'`
3. `python -m pytest -q tests/test_tno_bundle_builder.py`

结论：
- 目前 `tests/test_tno_bundle_builder.py` 相关用例在本地可稳定通过。
- “测试本身先炸”与“并发锁机制缺失”这两类工程问题在当前代码状态下未再复现。
- 但这不等于发布数据已刷新；它仅说明当前代码和已提交数据在现有测试语义下是自洽的。

## 2) 修复目标拆分

把问题拆为两个独立目标，避免混淆：

- **目标 A：构建链稳定性**（当前已基本达成）
  - 测试和锁机制稳定，不出现随机中断/并发踩踏。
- **目标 B：发布数据刷新**（尚未执行）
  - 是否需要把 owner-only backfill 的最新结果真正发布到 `data/scenarios/tno_1962/`。

## 3) 建议执行顺序（云端）

### Phase 1：回归验证（不 rebuild）

1. 运行语法与关键测试子集（与本地一致）。
2. 补跑一次 bundle 相关更广子集（可按 CI 现有标签/路径过滤）。
3. 若出现失败，优先按以下顺序定位：
   - 常量/路径引用错误；
   - checked-in 数据一致性断言；
   - checkpoint 互斥行为在目标环境差异（尤其 `_pid_is_alive`）。

**通过门槛**：关键测试全部通过后再进入 Phase 2。

### Phase 2：受控 rebuild/publish（如业务确认需要刷新）

1. 在单进程、独占环境执行 rebuild/publish（避免并发干扰）。
2. 发布后进行三类一致性核对：
   - `owners.by_feature.json`
   - `countries.json`
   - startup bundle 相关产物
3. 对比变更清单，确认仅包含预期 owner-only backfill 影响范围。

**通过门槛**：数据与产物同步一致，再考虑合并/发布。

### Phase 3：防回归加固

1. 把临时脚本式校验持续纳入正式测试或 CI job。
2. 对 build lock 增加跨进程压力测试（至少 2 进程竞争 + stale lock 场景）。
3. 在 CI 日志中固定输出 checkpoint lock holder 信息，降低故障排查成本。

## 4) 失败分流策略

若后续云端仍出现“像崩溃”的症状，按下面分流：

1. **测试立即报错**：优先归类为测试/接口回归，不先归因于 bundle 崩溃。
2. **写入结果不一致**：优先检查并发执行与锁文件生命周期。
3. **发布后数据不一致**：优先检查 publish 范围与 startup bundle 同步步骤是否完整。

## 5) 决策建议

在当前测试已通过前提下，建议先完成 Phase 1 证据闭环；
若产品/数据侧确认需要刷新 owner-only backfill，再进入 Phase 2 做一次受控 rebuild/publish。
