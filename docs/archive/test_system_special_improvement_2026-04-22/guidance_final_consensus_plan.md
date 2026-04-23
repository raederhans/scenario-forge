# 测试系统专项改进：最终共识计划草案

## Summary
第一阶段只做“测试分层提速”，目标锁定为三件事：缩短日常反馈时间、提高入口可理解性、降低 agent 选错入口。机制写死为 `manifest + 生成式 --test-list`，不用 tags。manifest 的作用域也写死：它只登记 `tests/e2e/*.spec.js` 这 45 个 Playwright spec 文件；迁出的 `static-contract` 测试走独立 `test:node:*` 入口，不进入 E2E layer list。

第一阶段分成 1A / 1B / 1C 三个交付包，顺序固定：
- 1A：manifest + 分层入口 + smoke 重定义 + 覆盖检查
- 1B：perf-pr-gate required-check-safe 改造
- 1C：两处假 E2E 的最小迁出

分层决策写死如下：
- E2E layer 只允许 `smoke / contract / regression / feature / all`
- `primaryLayer` 为互斥单值
- `executionMode` 只用于 runner 决策，允许 `browser / hybrid / static-contract`
- `static-contract` 只描述执行方式；一旦测试迁出 Playwright，它只出现在 node 测试入口里，不再进入 E2E layer 清单

主 smoke 集合写死为最小稳定集合，继续排除 `scenario_apply_resilience.spec.js`。建议 smoke 只包含以下 4 个 spec：
- `tests/e2e/main_shell_i18n.spec.js`
- `tests/e2e/hoi4_1939_ui_smoke.spec.js`
- `tests/e2e/tno_1962_ui_smoke.spec.js`
- `tests/e2e/strategic_overlay_smoke.spec.js`

这 4 个 spec 分别覆盖主壳、HOI4 happy-path、TNO happy-path、战略覆盖层主路径。CI 墙钟预算上限写死为：
- `test:e2e:smoke` 在 GitHub Actions Ubuntu runner 上 **6 分钟内完成**
- `deploy verify` 中全部 E2E smoke 相关步骤合计 **8 分钟内完成**

## Implementation Changes

### 1A：manifest + 分层入口 + smoke 重定义 + 覆盖检查
1. 新增一份 E2E manifest，作用域只覆盖 `tests/e2e/*.spec.js` 这 45 个 Playwright spec。
2. manifest 每条记录至少包含：
   - `specPath`
   - `primaryLayer`
   - `executionMode`
   - `domain`
   - `ownerHint`
3. manifest 规则写死：
   - `primaryLayer` 互斥，只允许单值
   - E2E layer 只允许 `smoke / contract / regression / feature`
   - `executionMode` 只用于 runner 决策，允许 `browser / hybrid / static-contract`
   - 迁出到 node 的 `static-contract` 测试不写入这份 E2E manifest
4. 从 manifest 生成 5 份 `--test-list`：
   - smoke
   - contract
   - regression
   - feature
   - all
5. 保留现有 13 条 `test:e2e:*` 脚本，新增：
   - `test:e2e:layer:smoke`
   - `test:e2e:layer:contract`
   - `test:e2e:layer:regression`
   - `test:e2e:layer:feature`
   - `test:e2e:layer:all`
6. smoke 组成写死为 4 个 spec：
   - `tests/e2e/main_shell_i18n.spec.js`
   - `tests/e2e/hoi4_1939_ui_smoke.spec.js`
   - `tests/e2e/tno_1962_ui_smoke.spec.js`
   - `tests/e2e/strategic_overlay_smoke.spec.js`
7. `scenario_apply_resilience.spec.js` 从主 smoke 入口降出，保留在更高成本层级。
8. 覆盖检查写死为：
   - manifest 覆盖全部 45 个 E2E spec
   - 每个 spec 恰好一个 `primaryLayer`
   - 生成出的 `--test-list` 与 manifest 一致
   - 新增 layer 入口与现有 13 条入口全部指向存在文件
   - `test:e2e:smoke` 恰好只包含上面 4 个 spec

### 1B：perf-pr-gate required-check-safe 改造
1. `perf-pr-gate` 改成 always-run workflow，保留稳定 check 名称。
2. workflow 内新增 changed-files classifier，把 PR 改动分成“性能相关”和“性能无关”两类。
3. 性能相关时执行真实 perf gate；性能无关时走快速完成路径，check 名称保持不变。
4. classifier 至少覆盖：
   - `docs/perf/**`
   - `tools/perf/**`
   - `tests/e2e/support/playwright-app.js`
   - perf gate 真正依赖的性能相关 `js/**` 子路径
   - `package.json`
   - `package-lock.json`
5. 这一包只交付 required-check-safe；workflow 复用化留到后续阶段。

### 1C：两处假 E2E 的最小迁出
1. `scenario_chunk_exact_after_settle_regression.spec.js`
   - 把后段 2 个纯源码 contract 测试迁出 Playwright
   - 新增 node 测试文件，使用新增脚本 `test:node:scenario-chunk-contracts` 触达
   - Playwright 文件只保留真正依赖浏览器时序、渲染和交互的断言
2. `physical_layer_regression.spec.js`
   - 把源码读取与源码 contract 断言链整体迁出浏览器路径
   - 新增 node 测试文件，使用新增脚本 `test:node:physical-layer-contracts` 触达
   - Playwright 文件继续保留视觉断言与浏览器可见行为断言
3. 迁出后的落点脚本写死为：
   - `test:node:scenario-chunk-contracts`
   - `test:node:physical-layer-contracts`
4. 同步更新：
   - E2E manifest
   - layer `--test-list`
   - 覆盖检查
   - 新 node 测试脚本入口

## Test Plan

### 1A 验证
1. manifest 静态验证：
   - 记录数等于 45
   - 只包含 `tests/e2e/*.spec.js`
   - 每个 spec 恰好一个 `primaryLayer`
   - 没有迁出的 node `static-contract` 测试混入 E2E manifest
2. 入口验证：
   - `test:e2e:layer:smoke` 只执行 4 个固定 smoke spec
   - `test:e2e:layer:contract`、`regression`、`feature`、`all` 都能从 manifest 生成并执行
   - 现有 13 条 `test:e2e:*` 脚本继续可用
3. smoke 验证：
   - `scenario_apply_resilience.spec.js` 不在主 smoke 里
   - `test:e2e:smoke` 在 GitHub Actions Ubuntu runner 上墙钟时间不超过 6 分钟
   - `deploy verify` 中全部 E2E smoke 相关步骤合计不超过 8 分钟

### 1B 验证
1. 相关改动路径验证：
   - 构造 perf 相关改动
   - classifier 命中“相关”
   - workflow 执行真实 perf gate
   - required check 名称稳定出现
2. 无关改动路径验证：
   - 构造 perf 无关改动
   - classifier 命中“无关”
   - workflow 走快速完成路径
   - required check 名称同样稳定出现并返回成功

### 1C 验证
1. `scenario_chunk_exact_after_settle_regression.spec.js` 验收：
   - Playwright 文件减少 2 个纯源码 contract 测试
   - 这 2 个测试改由 `test:node:scenario-chunk-contracts` 触达
   - 剩余 Playwright 断言仍覆盖浏览器相关路径
2. `physical_layer_regression.spec.js` 验收：
   - Playwright 文件不再保留源码读取断言链
   - 相关源码 contract 断言改由 `test:node:physical-layer-contracts` 触达
   - 视觉断言继续留在 Playwright 并可独立执行
3. 覆盖验证：
   - 迁出后 E2E manifest 仍只覆盖 45 个 `tests/e2e/*.spec.js`
   - 新 node 测试有明确命名脚本入口
   - layer `--test-list` 与迁出后的归属保持一致

## Assumptions
1. 当前稳定口径固定为：45 个 E2E spec、13 个唯一直接入口、32 个无直接入口。
2. 第一阶段只把 manifest 用于 Playwright E2E；node 侧迁出测试单独管理。
3. 长文件债务已经足够明确，第一阶段只处理两处被点名的假 E2E，其他长文件留到后续阶段。
4. `deploy.yml` 第一阶段继续消费主 smoke 路径，因此 smoke 必须保持轻量、稳定、主路径导向。
5. `scenario_apply_resilience.spec.js` 第一阶段继续保留在非主 smoke 层级。
6. 新增的 `test:node:scenario-chunk-contracts` 和 `test:node:physical-layer-contracts` 属于第一阶段允许引入的最小新入口。
