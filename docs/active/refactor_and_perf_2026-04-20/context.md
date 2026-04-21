# 执行前必读：现状快照 + 红线（2026-04-20）

> **给执行这份计划的 agent**：开工前**必须**完整读完这份文档。如果跳过，大概率会重蹈之前几轮 agent 的覆辙——在已废弃的方向上写代码、踩今天才修好的 bug。

---

## 1. 项目一句话概括

`mapcreator` 是一个用**原生 ESM + Canvas + SVG 混合渲染**的地图编辑器。没有打包器、没有 TypeScript、没有 React。所有源码在 `js/` 下按 `core/` / `ui/` / `bootstrap/` 分层。Python 工具链在 `tools/` 和 `map_builder/`。部署通过 GitHub Pages 从 `dist/` 静态托管。

## 2. 2026-04-20 文件规模（必须知道的数字）

| 文件 | 行数 | 备注 |
|---|---|---|
| `js/core/map_renderer.js` | **22,230** | 本项目最大单文件，79 个 named export，742 处 `state.foo =` 写入（占全仓 47%） |
| `js/core/state.js` | 429 | **单例门面**，不是 Proxy，不是 slice 聚合 |
| `js/core/state_defaults.js` | 1,807 | 默认值工厂 |
| `js/core/runtime_hooks.js` | 99 | 60 个扁平 `*Fn` 函数指针 |
| `js/core/scenario_manager.js` | 1,015 | |
| `js/core/scenario_resources.js` | 900 | |
| `js/ui/sidebar.js` | 5,531 | |
| `js/ui/toolbar.js` | 3,384 | |
| `js/main.js` | 802 | bootstrap 入口 |

全仓 123 个 JS 文件，共约 106,370 行。20 个文件超过 1000 行。

## 3. 已完成的重构（Batch 1-5，**不要重做**）

来自 `docs/active/further_split/` 的既有 `plan.md` + `task.md`：

### Batch 1-2：scenario owner 抽取
- `js/core/scenario/lifecycle_runtime.js` (371 行) — 生命周期重置/清理
- `js/core/scenario/presentation_runtime.js` (212 行) — 显示层刷新
- `js/core/scenario/bundle_runtime.js` (503 行) — bundle 缓存编排
- `js/core/scenario/chunk_runtime.js` (1,185 行) — chunk 加载运行时
- `js/core/scenario/bundle_loader.js` (1,069 行)
- `js/core/scenario/startup_hydration.js` (823 行)
- `js/core/scenario/scenario_renderer_bridge.js` (27 行) — scenario → map_renderer 的薄桥

### Batch 3：state 默认值工厂抽离
- `js/core/state/border_cache_state.js` (45 行)
- `js/core/state/dev_state.js` (62 行)
- `js/core/state/history_state.js` (4 行)
- `js/core/state/renderer_runtime_state.js` (120 行)
- `js/core/state/scenario_runtime_state.js` (138 行)
- `js/core/state/spatial_index_state.js` (33 行)
- `js/core/state/strategic_overlay_state.js` (95 行)

### Batch 4-5：renderer owner 抽取
- `js/core/renderer/strategic_overlay_runtime_owner.js` (1,006 行)
- `js/core/renderer/border_mesh_owner.js` (674 行)
- `js/core/renderer/border_draw_owner.js` (582 行)
- `js/core/renderer/political_collection_owner.js` (505 行)
- `js/core/renderer/spatial_index_runtime_owner.js` (398 行)
- `js/core/renderer/interaction_border_snapshot_owner.js` (148 行)
- 加上 helper：`strategic_overlay_helpers.js`、`context_layer_resolver.js`、`facility_surface.js`、`asset_url_policy.js`、`urban_city_policy.js`

**这些 owner 的模式**：工厂 `createXxxOwner({ state, constants, helpers })` → 通过 helper callback 通知 map_renderer（renderNow、captureHistoryState 等）→ **直接对 `state.foo` 写入**（不经过任何中介层）。后续任何新拆分**必须沿用这个模式**，不要另发明 pub-sub / Proxy / slice getter/setter。

## 4. ⛔ 红线：**以下方向已废弃，不要执行**

### 4.1 旧版 "state.js 大拆分" 蓝图——**彻底废弃**

`C:\Users\raede\.claude\plans\commit-pr-shiny-summit.md` 和更早的讨论里提到过：
- 把 state.js 拆成 8 个 slice (bootSlice, contentSlice, scenarioSlice, colorSlice, viewSlice, cacheSlice, uiSlice, devSlice)
- 引入 `js/core/state/bus.js` 事件总线
- 用 Proxy facade 做迁移期兼容层
- 删除 `runtime_hooks.js`，把 60 个 Fn 改成 `bus.emit(...)`
- ESLint 自定义规则 `no-direct-state-mutation`

**全部不做**。用户已经两次明确这个方向被降级（`docs/active/further_split/STATE_JS_SLICE_SPLIT_PLAN_2026-04-20.md` 里也写了："不再把大规模 8 slices + Proxy + bus 写成眼前执行清单"）。

### 4.2 其他禁止项

| 禁止动作 | 理由 |
|---|---|
| ❌ 拆分 `map_renderer.js` 本身 | 本计划不碰行数，只冻结公共 API 面（见 plan.md §A3） |
| ❌ 为 map_renderer 再抽新 owner | 现有 6 个已足够，继续抽会稀释责任不收敛 |
| ❌ 引入打包器 (Vite/esbuild/rollup) | 引入复杂度 > 当前收益 |
| ❌ 重写 Canvas 绘制层 | 范围过大，本计划不动 |
| ❌ OffscreenCanvas / WebGPU / Worker 化 | 远期话题，本计划外 |
| ❌ 改 topology 数据格式 | 消费者太多 |
| ❌ 动 `state.js` 顶层字段归类 | 保持单例门面不变 |
| ❌ 改 render pass cache 存储结构 | 高风险，本计划外 |
| ❌ 触碰 Tier 2-4（UI 解耦、纯函数层、构建链、git 清仓、文档补全） | 本计划外 |
| ❌ 自动执行 `git push` / `gh pr create` | 用户要求只生成 commit；push/PR 由用户手动发起 |

## 5. 今天（2026-04-20）已完成的 P0 hotfix

**文件**：`js/bootstrap/startup_boot_overlay.js`

**改动**：两处 — 第 214-221 行（overlay `.hidden` class toggle 修复）、第 249-255 行（readonly banner 死代码清理）

**为什么要知道**：这是**未提交的 working-tree 变更**。执行 agent 开工前应：
1. `git status` 确认是否还在工作区
2. 如果还在，先**单独一个 commit 提交**（不与本计划的 Step 混在一起）
3. commit title 示例：`fix(boot): restore overlay hide by toggling .hidden class`
4. 提交后再开始 Step 0

## 6. 用户明确的意图（**决策时的判官**）

以下是用户在本轮对话中原话级别的意图，遇到模糊决策时用这些作判断依据：

1. **"拆分是为了增强项目稳定性、可维护性"** → 任何增加复杂度但不增加稳定性的改动都应放弃
2. **"拆分不引入新的性能负担"** → 每个 PR 必须 perf-neutral（见 plan.md §B2 的 ±5% 门）
3. **"有助于之后修复性能问题（打下基础，这次能修当然最好，不能也不急）"** → 优先做"地基"而非"一次性性能冲刺"
4. **"性能负担之前就已经很重"** → 不要把老账当新债归因到拆分
5. **"估计是放手让那个 agent 做了太多东西，搞得方向乱了"** → **不要扩大范围**。本计划 §6 只列了 Step 0-8，超出范围的工作**必须停下来问用户**，不要自己决定

## 7. 执行纪律

1. **一 Step 一 PR**，commit message 英文（项目既有 commit 风格混用，但用户倾向英文）
2. **不跳步**：Step 0 是所有 B 系列的强前置，没 baseline 不做 B1/B2/B3
3. **每步结束跑 baseline 对比**：Step 0 之后任何动 `map_renderer.js` / `scenario_*.js` / `bootstrap/*` 的 PR 必须重跑一次 baseline，结果贴到 PR 说明里
4. **回滚优先于 hotfix**：任何 Step 出现 e2e / 视觉 / 性能回归 → `git revert` 对应 PR，不叠加补丁；回滚后在 plan.md §10 踩坑记录追加一条
5. **遇到以下情况停下来找用户**：
   - 发现本计划某个 Step 在实际执行中会扩散到超过 10 个文件
   - 发现某个 `@internal` API 其实被外部模块依赖
   - 性能修复后对比 baseline 变差而非变好
   - 发现红线列表里某项其实不得不碰
6. **不要擅自更新 `docs/active/further_split/plan.md` 或 `task.md`**——那两份文件是 Batch 1-5 的历史记录，本计划在 `refactor_and_perf_2026-04-20/` 这个独立目录里

## 8. 工程链速查

- 启动本地 dev：Windows 下 `start_dev.bat`，CI/Linux 下尚无对应 shell 脚本（已知问题，本计划不修）
- 跑 e2e smoke：`npm run test:e2e:smoke`（是否存在需要 `package.json` 里核对）
- 跑 Python 测试：`python -m pytest tests/`
- build 产物：`build_data.bat` 产出 `dist/`
- 启动页：`index.html` 是入口，载入 `js/main.js`

## 9. 下一步（你真正要做的事）

读完本文件后，按顺序打开：

1. **`plan.md`**（同目录）——理解两轨四原则六目标
2. **`task.md`**（同目录）——可勾选的执行 checklist
3. **`step0_perf_probe_skeleton.md`**（同目录）——Step 0 的具体代码骨架，照着写

然后从 `task.md` 的 **Step 0** 开始。不跳、不抢进度、每步等 verification 通过再进下一步。

如果在任一环节意图与本文件冲突，**停下来问用户**，不要自作主张。
