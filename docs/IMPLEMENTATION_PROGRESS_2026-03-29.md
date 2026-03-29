# A/B 进度留档

日期：2026-03-29

## 1. 来源与范围

本份留档基于以下现有文档与当前工作树状态整理：

- `docs/CODEBASE_AUDIT_2026-03-28.md`
- `docs/MAINLINE_A_PROGRESS_2026-03-28.md`
- `docs/IMPLEMENTATION_PROGRESS_2026-03-28.md`
- `docs/BUILD_AND_SCENARIO_CONTRACT_BASELINE_2026-03-28.md`
- 当前未提交改动与对应测试

本轮只做三件事：

1. 留档主线 A 已完成部分
2. 留档主线 B 已完成部分
3. 明确当前未提交改动属于哪条线，以及接下来应怎么继续

本轮不回头重写旧文档，也不把本地 Codex 运行状态改动计入项目进度。

## 2. 主线 A 已完成内容

主线 A 的主干目标已经完成，当前状态应记为“已收口进入可交付阶段，但仍存在收敛项”，而不是“还在进行中”。

### 2.1 契约与构建基线已立住

- 共享契约层已经建立，并进入主路径：`map_builder/contracts.py`
- 构建阶段与场景产物不再只靠入口脚本内部硬编码维持
- `init_map_data.py`、`tools/patch_tno_1962_bundle.py`、`tools/check_scenario_contracts.py` 已开始复用共享契约

### 2.2 strict contract 已并入默认验证链

- TNO strict contract 已进入现有 `verify` 闸门
- `RU_ARCTIC_FB_*` 这类 runtime-only shell fragment 对 feature maps 的污染已被隔离
- `geo_locale` 审查面已收缩为：
  - manual override
  - 自动安全复制
  - reviewed exceptions
  - strict 剩余报错

### 2.3 dev server 与 E2E 启动稳定性已收口

- Playwright 现在由统一 `webServer` / `baseURL` 接管
- `tests/e2e/support/playwright-app.js` 已成为统一测试入口
- `tools/dev_server.py --help` 不再污染 `.runtime/dev/active_server.json`
- smoke E2E 的端口与启动竞态问题已做过收口

### 2.4 基本验收链已经成形

当前 A 的“已落地能力”不应再只按脚本列举，而应按验收能力理解：

- Python 单测已进入默认验证链
- strict contract 已进入默认验证链
- smoke E2E 已进入默认验证链
- 本地 dev server 与 Playwright 的前提关系已经统一

## 3. 主线 B 已完成内容

主线 B 不是“还没开始”，而是已经完成了第一批高风险入口收口，但还没有走到“前端写入口全面归拢”的阶段。

### 3.1 第一批边界已经落地

- 渲染边界已落地：`js/core/render_boundary.js`
- 场景事务分发边界已落地：`js/core/scenario_dispatcher.js`
- 交互漏斗已落地：`js/core/interaction_funnel.js`

### 3.2 第一批接线已经进入主路径

- `js/main.js` 已通过 dispatcher 应用场景 bundle
- `js/ui/sidebar.js` 的项目导入已经走 `importProjectThroughFunnel(...)`
- `js/core/map_renderer.js` 的地图 `click` / `dblclick` 已通过 funnel 分发
- `tests/e2e/interaction_funnel_contract.spec.js` 已覆盖第一批入口契约

### 3.3 当前可以明确记为“已收口”的入口

- 场景应用入口：默认场景与缓存场景应用已通过 dispatcher 进入主路径
- 项目导入入口：侧栏上传已通过 funnel 收口
- 地图交互入口：`click` / `dblclick` 已通过 funnel 收口
- 渲染 flush 边界：场景事务后的显式 flush 已开始收束到 render boundary

## 4. 当前未提交改动的正确归类

当前工作树里的未提交改动，主轴不属于 B，而属于主线 A 收口后的稳定性补强与发布安全加固。

### 4.1 应记为 A 收敛项的未提交改动

- `init_map_data.py`
  - palette source root 的跨平台候选路径解析
  - strict 缺失源路径时给出明确的候选路径提示
- `map_builder/geo/local_canonicalization.py`
  - 几何裁剪过程显式化
  - clip intersection 失败时报出 `country_code` 与 `feature_id`
- `tools/patch_tno_1962_bundle.py`
  - 发布前阻止“live dev server 正在服务当前 workspace”时继续 publish
- `tools/scenario_chunk_assets.py`
  - scenario chunk 写入被占用时给出明确错误，而不是原始 `PermissionError`
- `tests/test_tno_bundle_builder.py`
- `tests/test_init_map_data_palette_paths.py`
- `tests/test_local_canonicalization.py`
- `tests/test_scenario_chunk_assets.py`
  - 以上测试都在为 A 的收敛项补回归保护

### 4.2 不应误记为 B 推进的内容

- 当前未提交改动没有继续推进 `interaction_funnel`、`render_boundary`、`scenario_dispatcher` 的新接线
- 当前未提交改动没有新增前端入口 funnel 化
- `tests/e2e/main_shell_i18n.spec.js` 的小改动只是现有 UI 文案断言同步，不构成 B 推进
- `docs/AI_BROWSER_MCP_EDGE.md` 与 `ops/browser-mcp/README.md` 的改动属于工具链说明更新，不计入 A/B 主线功能推进

## 5. 当前阶段判断

- 主线 A：主干完成，但仍有收敛项
- 主线 B：处于前半到中段，第一批 seam / funnel 已完成，但还没全量收口

更准确地说：

- A 现在不该继续扩大战线，而应把当前工作树里的 Python / 发布链改动收完并验证
- B 现在不该做大拆，而应继续沿着现有 seam 把剩余高风险入口收口

## 6. B 剩余范围盘点

在继续推进 B 之前，当前仓库状态已经能明确区分三类入口。

### 6.1 已收口

- 场景切换中的 bundle 应用主入口
- 侧栏项目导入入口
- 地图 `click` / `dblclick` 交互入口

### 6.2 半收口

- 工具栏动作
  - 已有 `resetScenarioToBaselineCommand(...)` 接入 dispatcher
  - 但工具栏其他动作仍大量混用直接状态写入与旧渲染触发
- 场景事务内部渲染
  - `scenario_manager.js` 已开始用 `flushRenderBoundary(...)`
  - 但场景事务 owner 仍然集中在 `scenario_manager.js` 这个重文件内
- 主入口渲染触发
  - `main.js` 已绑定 render boundary
  - 但仍存在多处直接调用 `state.renderNowFn()`

### 6.3 未收口或明显未完成

- 侧栏动作中仍有多处直接 `state.renderNowFn()` 调用
- `map_renderer.js` 中仍有多处直接渲染触发和状态写入
- `scenario_manager.js` 仍同时承担场景事务、状态重写、UI 同步和部分渲染触发
- `toolbar.js`、`sidebar.js`、`map_renderer.js`、`scenario_manager.js` 仍是大体量中心文件

### 6.4 剩余入口按行为分组

- 场景切换
  - bundle 应用主入口已收口
  - view mode / clear active scenario / 其他 UI 驱动的场景动作仍需继续统一
- 导入恢复
  - 导入入口已收口
  - 导入后的 UI 刷新与后续恢复链路仍未完全摆脱旧渲染触发
- 工具栏动作
  - 仅部分走 dispatcher，其余仍需盘点
- 侧栏动作
  - 仍存在多处直接状态写入与直接 render 触发
- 地图交互
  - `click` / `dblclick` 已收口
  - 其他交互路径仍在 `map_renderer.js` 重文件内部
- 直接 render 触发
  - 仍大量存在于 `main.js`、`sidebar.js`、`map_renderer.js`

## 7. 推荐推进顺序

### 7.1 先继续主线 B，但只做剩余入口收口

下一轮先盘点并收掉还没走统一入口的高风险路径，重点只看：

- `js/core/map_renderer.js`
- `js/ui/sidebar.js`
- `js/ui/toolbar.js`
- `js/core/scenario_manager.js`

推进原则保持不变：

- 场景事务走 dispatcher
- 地图交互走 funnel
- 渲染触发走 render boundary

这一轮不做：

- `data/` 重排
- 前端大拆
- Worker / OffscreenCanvas

### 7.2 A 并行收敛，但只收当前工作树里的那批

优先完成当前未提交的 A 收敛项：

- palette 路径解析
- local canonicalization 几何处理
- bundle publish 与 live dev server 冲突保护
- scenario chunk 写入占用报错
- 对应 Python 测试补齐

### 7.3 收敛后再统一验证

完成当前 A 收敛项后，按固定顺序复跑：

```text
python -m unittest discover -s tests -q
python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962
npm run test:e2e:smoke
```

如果 strict 仍出现残留 mismatch，后续应把它单列为“数据一致性收敛项”，不要混进 B。

## 8. 这份留档的结论

到 2026-03-29 为止，仓库状态应这样理解：

- A 已经完成主干目标，当前主要是稳定性与发布安全收敛
- B 已经完成第一批入口收口，下一步应继续缩小剩余高风险入口
- 当前未提交改动主要属于 A，不应误记成 B
- 下一轮最稳的路线是“B 优先，A 并行收敛”，并继续坚持小步 seam 收口，而不是扩大重构面
