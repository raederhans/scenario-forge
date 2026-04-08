# MapCreator 本地改动进度留档

日期：2026-03-28

## 1. 本轮目标

本轮按“先立 seam，再做替换”的保守路线推进，优先处理三类问题：

1. 验证链失真
2. 构建与场景产物契约散落
3. 前端高爆炸半径入口缺少显式边界

本轮不进入以下高风险动作：

- 不做 `data/` 目录级物理重排
- 不做前端深层模块大拆
- 不做 Worker / OffscreenCanvas 落地

## 2. 已落地改动

### 2.1 基线与契约层

- 新增共享契约层：`map_builder/contracts.py`
- 新增本轮基线文档：`docs/BUILD_AND_SCENARIO_CONTRACT_BASELINE_2026-03-28.md`
- `init_map_data.py` 改为读取显式阶段契约，而不是继续散落维护产物约定
- `tools/patch_tno_1962_bundle.py` 收敛了 checkpoint / publish / drift / strict 所需产物定义
- `tools/check_scenario_contracts.py` 改为复用共享契约，而不是继续脚本内硬编码

### 2.2 验证链与环境前提

- Playwright 改为由 `playwright.config.cjs` 统一接管 `webServer` 和 `baseURL`
- 新增 `tests/e2e/support/playwright-app.js`，统一 E2E 访问入口与 server 环境变量
- 多个 spec 移除对 `.runtime/dev/active_server.json` 和旧地址猜测的直接依赖
- `package.json` 增加：
  - `playwright:install:chromium`
  - `test:e2e:smoke`
  - `test:e2e:scenario-resilience`
- `.github/workflows/deploy.yml` 已加入 `verify` 闸门，先跑：
  - Python 单测
  - 高价值 smoke E2E

### 2.3 dev server 卫生修复

- `tools/dev_server.py --help` 不再启动服务，也不再污染 `.runtime/dev/active_server.json`
- 读取元数据前补了活性校验逻辑
- 新增对浏览器自动打开行为的显式环境开关
- 服务端增加了更稳的连接错误处理，避免测试期被 `BrokenPipe` 一类错误放大

### 2.4 前端止血边界

- 新增渲染边界：`js/core/render_boundary.js`
- 新增场景事务命令边界：`js/core/scenario_dispatcher.js`
- `js/main.js`、`js/core/scenario_manager.js`、`js/ui/sidebar.js`、`js/ui/toolbar.js` 已接入这两层
- 高风险场景事务不再继续依赖分散的直接写入口
- 渲染触发和渲染执行已开始分离

### 2.5 回归测试修复

- `tests/e2e/scenario_apply_resilience.spec.js` 已改为围绕新的场景事务边界验证
- 处理了 smoke 串行运行时的启动竞态：
  - 默认 `tno_1962` 启动尚未空闲时，后续切场景命令会误复用上一轮 promise
  - 现已在测试 helper 中显式等待 `scenarioApplyInFlight` 清空后再发下一次命令
- 该修复避免了“独立跑能过，smoke 串行时偶发失败”的假绿状态

## 3. 已验证结果

### 3.1 本地命令

```text
python -m unittest discover -s tests -q
=> Ran 81 tests
=> OK

npm run test:e2e:scenario-resilience
=> 3 passed

npm run test:e2e:smoke
=> 4 passed
```

### 3.2 dev server 元数据污染检查

```text
python tools/dev_server.py --help
=> active_server.json 前后时间戳不变
```

## 4. 对照审计后的当前状态

### 4.1 已明显缓解

- E2E 环境前提分散，已改为统一入口
- `deploy` 无验证闸门，已补 `verify`
- `tools/dev_server.py --help` 污染运行时元数据，已修复
- 构建/场景产物契约散落在脚本内部，已开始收束到共享契约层

### 4.2 已部分缓解，但仍未完成

- 前端状态边界：已立第一批 seam，但 `state` 仍然巨大，写入口仍未完全收口
- Python 主入口职责：已开始收编契约，但 `init_map_data.py` 仍然偏重，尚未彻底降为纯编排
- `data/` 生命周期边界：规则已经先立，但目录物理形态未动

### 4.3 仍然打开的问题

- `map_renderer.js`、`sidebar.js`、`toolbar.js`、`scenario_manager.js` 仍然体量过大
- `data/` 仍然混放权威输入、人工规则、派生产物、运行时产物
- 严格契约检查仍未能进入硬门禁

## 5. 当前真实阻塞

当前最重要的未闭环项不是代码 seam，而是既有 TNO 数据本身。

以下命令仍会失败：

```text
python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962
```

当前失败集中在：

- `owners/controllers` feature keyset 不一致
- `owners/cores` feature keyset 不一致
- `runtime_topology` 与 feature maps 的严格对应关系不一致
- `geo_locale_patch` 仍有大量 collision 候选需要人工处理

这说明：

- Phase 2 的“契约显式化”已经落地
- 但 strict contract 还不能直接升为硬门禁
- 下一阶段要优先清历史数据一致性，而不是继续抽象新层

## 6. 本轮收尾判断

这轮改动已经把最危险的三类问题先止血：

- 验证链不再依赖陈旧运行时元数据
- 场景与构建契约开始有单一来源
- 前端高风险事务开始有显式边界

本轮不建议继续扩大重构面。下一轮应优先清 strict contract 对应的历史数据问题，并继续用 seam 方式缩小入口职责。
