# 执行 checklist（2026-04-20）

> 每个 Step 一个独立 PR。开工前读 `context.md` + `plan.md`。
> Step 0 是整个计划的强前置，未完成**不得**进入 Step 2/3/5/6。

---

## 前置：P0 hotfix 清理工作区

- [ ] `git status` 检查 `js/bootstrap/startup_boot_overlay.js` 是否有未提交变更
- [ ] 如有未提交的 overlay class 修复，**单独一个 commit** 提交
  - commit title：`fix(boot): restore overlay hide by toggling .hidden class`
  - commit body 说明：`.boot-overlay` 有 `display: flex` 覆盖 `[hidden]` 属性；`.boot-overlay--visible` / `.startup-readonly-banner--visible` 两个 CSS 类不存在，属于拆分时的类名笔误
- [ ] 验证：本地起服、加载一次完整场景、确认 overlay 消失、地图可交互
- [ ] 确认 working tree 干净后再进 Step 0

---

## Step 0 — 建立 perf baseline【B 轨前置，必先做】

**目标**：产出 `docs/perf/baseline_2026-04-20.md`，作为后续所有 PR 的性能参考线。

**PR title**：`feat(perf): add perf_probe + baseline measurement`

**参考文件**：同目录 `step0_perf_probe_skeleton.md`（代码骨架 + 精确打点位置）

**动作清单**：

- [ ] 新建 `js/core/perf_probe.js`（按 `step0_perf_probe_skeleton.md` 第 2 节代码）
- [ ] 在以下位置插入打点调用（按 skeleton 第 3 节精确行号）：
  - [ ] `js/main.js` — `boot:start`、`boot:ready`
  - [ ] `js/bootstrap/startup_data_pipeline.js` — `boot:topology-loaded`
  - [ ] `js/core/scenario_manager.js` — `boot:scenario-applied` / `scenario:apply:start` / `scenario:apply:end`
  - [ ] `js/core/map_renderer.js` — `render:start` / `render:end`（累加型）
  - [ ] `js/core/map_renderer.js` — `refresh:scenario-apply:start/end`（refreshMapDataForScenarioApply 入出口）
  - [ ] `js/core/map_renderer.js` — `refresh:color:start/end`
  - [ ] `js/core/map_renderer.js` — `rebuild:political-collections:start/end`
  - [ ] `js/core/map_renderer.js` — `rebuild:static-meshes:start/end`
- [ ] 新建 `tools/perf/run_baseline.py`（或 `.mjs`）：自动启动 dev server → 用 Playwright 或 puppeteer 加载三档场景 → 收集 performance entry → 输出 markdown
- [ ] 选定三档场景 ID（向用户确认）：
  - 空场景：___
  - 中等场景：___
  - 最大场景：___（**必须等用户指定**）
- [ ] 每档场景本地跑 5 次，取中位数
- [ ] 产出 `docs/perf/baseline_2026-04-20.md`：
  - 每档场景的：总启动耗时 / 首次可交互耗时 / 切换场景耗时 / 每个 `refresh:*` 的耗时中位数 / render 次数 + 累计耗时
  - render pass 预算达成率（60fps = 16ms/frame）

**验收标准**：

- perf_probe.js 在 `globalThis.performance` 不存在时降级为 no-op（Node 环境兼容）
- baseline 文档存在并包含三档完整数据
- 数据重复性：同一场景相邻两次差异 < 10%

**回滚**：`git revert` PR。perf_probe 是纯新增，回滚零风险。

---

## Step 1 — 关闭 Batch 5 尾巴【A 轨】

**目标**：定性 `strategic_overlay_editing` e2e 启动就绪超时，更新 task.md 历史记录。

**PR title**：`chore(test): triage strategic_overlay_editing e2e timeout`

**动作清单**：

- [ ] 本地跑 `strategic_overlay_editing` e2e 3 次（isolated，单独一个文件）
- [ ] CI 上跑同样 3 次
- [ ] 分类：
  - 3/3 同错：新回归 → 开 bug 定位 PR（本 Step 结束，开新 Step）
  - 混合成败：抖动 → 加 retry、写入 known issues、关闭
- [ ] 更新 `docs/active/further_split/task.md` 第 71 行打勾 + 结论注释

**验收标准**：
- `task.md:71` 状态从"待定"变为"已定性"（勾选 + 文字结论）

**回滚**：不涉及代码改动，如果定位 PR 失败单独回滚那个 PR

---

## Step 2 — 合并 scenario 双 render 为单 render【B1.1】

**前置**：Step 0 完成，baseline 已有

**目标**：消除 `scenario_post_apply_effects.js` 一次 scenario apply 触发两次完整 render 的浪费。

**PR title**：`perf(scenario): coalesce double render per scenario apply`

**动作清单**：

- [ ] 阅读 `js/core/scenario_post_apply_effects.js:248-271` 理解现有流程
- [ ] 修改调用：`refreshMapDataForScenarioApply({ suppressRender: true })`
- [ ] 确认末尾 `syncCountryUi({ renderNow })` 是唯一最终渲染入口
- [ ] 如果 `rebuildPresetState` 和 `refreshScenarioShellOverlays` 之间有依赖"刚才 render 的结果"——识别并修复（可能需要显式 sync 调用）
- [ ] 本地验证：
  - 切换 3 个不同 scenario 各 2 次
  - 视觉无回归（边界、颜色、special zone、operational line 都正确）
  - 场景切换后 hit-test 正常（鼠标悬停高亮）
- [ ] 跑 baseline 重测中等场景，对比 Step 0 数据

**验收标准**：

- 中等场景 scenario 切换耗时对比 baseline 减少 ≥ 40ms（一次 render 的量）
- 总启动耗时对比 baseline 减少 ≥ 40ms
- 无视觉回归
- e2e smoke 绿

**回滚**：`git revert`。如回滚，在 `plan.md §10 踩坑记录` 追加失败原因

---

## Step 3 — color map 浅拷改增量【B1.2】

**前置**：Step 0 完成

**目标**：消除 `refreshColorState` 路径上的 O(countries) 浅拷贝。

**PR title**：`perf(color): replace full-map clones with incremental updates`

**动作清单**：

- [ ] 精确定位三处：
  - [ ] `js/core/map_renderer.js:4996` — `state.countryBaseColors = { ...state.sovereignBaseColors }`
  - [ ] `js/core/map_renderer.js:8015` — 类似 spread
  - [ ] `js/core/map_renderer.js:19346` — 类似 spread
- [ ] 对每处判断：
  - 是否有下游代码依赖"target 是副本"的语义？`grep -n countryBaseColors js/` 确认读者
  - 如果有，用 `Map` 实例替代 plain object（可选）或按需增量写（首选）
- [ ] 改造为增量：遍历 source 的 key，只对发生变化或新增的 key 覆盖 target
- [ ] 本地验证：颜色显示、sovereignty 切换、palette 切换、legend 正确
- [ ] 跑 baseline 重测

**验收标准**：

- `refresh:color` 耗时对比 baseline 减少 ≥ 30%（或确认老瓶颈不在此处，文档记录后保持）
- 视觉无回归（颜色、图例、悬停、palette preview）

**回滚**：`git revert`

---

## Step 4 — runtime_hooks.js surface 化【A 轨 A2】

**前置**：无（可与 Step 2/3/5 并行开 PR）

**目标**：不删 `runtime_hooks.js`，把 60 个扁平 `*Fn` 按类别分组为 4 个 surface。

**PR title**：`refactor(runtime-hooks): group flat Fn pointers into typed surfaces`

**动作清单**：

- [ ] 改写 `js/core/runtime_hooks.js`：
  - 保留 `createDefaultRuntimeHooks()` 函数签名不变
  - 内部返回值改为 4 个 sub-object：
    ```js
    return {
      ui: createDefaultUiRuntimeHooks(),
      command: createDefaultCommandRuntimeHooks(),
      data: createDefaultDataRuntimeHooks(),
      render: createDefaultRenderRuntimeHooks(),
    };
    ```
- [ ] 定义四个子工厂，按以下归类（参考 runtime_hooks.js 当前 60 个 Fn 的名字，按语义归类）：
  - **ui**：所有 `update*UIFn`、`render*Fn`（UI 更新回调）
  - **command**：`toggle*Fn`、`run*Fn`、所有"动作型"回调
  - **data**：`ensure*Fn`（数据加载/就绪型）
  - **render**：`refresh*Fn`、`recompute*Fn`、`renderNowFn`（渲染/失效型）
- [ ] **关键**：`state.js` 里的 `...createDefaultRuntimeHooks()` 扁平展开**改成** `runtimeHooks: createDefaultRuntimeHooks()` 保持整棵树
- [ ] 全仓 rename write site：
  - `grep -rn "state\.\(update\|refresh\|recompute\|toggle\|run\|ensure\|render\)\w*Fn" js/` 列出所有 write/read 点
  - 写法改为 `state.runtimeHooks.ui.updateHistory` / `state.runtimeHooks.render.refreshColor` 等
- [ ] 验证：所有原来的回调链仍然触发（undo/redo、场景切换、palette 切换）

**验收标准**：

- `runtime_hooks.js` 顶层扁平 `*Fn` 从 60 个减到 0（全部在 4 个子 surface 内）
- 运行时行为完全一致（无功能回归）
- `grep -rn "state\.\w*Fn" js/` 全仓 0 匹配（旧扁平形式清零）
- e2e smoke 绿

**回滚**：`git revert`。纯结构性改动，行为零变化，回滚零风险

---

## Step 5 — CI perf smoke 门【B2】

**前置**：Step 0 完成（baseline 存在）

**目标**：给 CI 加一个 perf smoke job，防止后续 PR 让性能变差。

**PR title**：`ci(perf): add perf smoke gate against baseline`

**动作清单**：

- [ ] `.github/workflows/` 下新建或扩展 workflow
- [ ] Job 步骤：
  1. 启动 dev server
  2. Playwright 加载中等场景
  3. 收集 `perf_probe` 数据
  4. 对比 `docs/perf/baseline_2026-04-20.md` 中等场景数据
  5. 如果总启动耗时 > baseline × 1.15，fail
- [ ] job 加 `timeout-minutes: 10`（兜底）
- [ ] 在 README 或 CONTRIBUTING 提及此 gate（但不超范围新建大篇文档）

**验收标准**：
- 在 main 当前 HEAD 跑此 job 绿
- 人为加一个 sleep 500ms 到 render 路径测试门能正确 fail（然后 revert 测试代码）

**回滚**：`git revert`

---

## Step 6 — refreshMapDataForScenarioApply 审查【B1.3，条件触发】

**前置**：Step 0 完成，且 baseline 显示此函数占场景切换耗时 > 30%

**目标**：识别六件套重建中哪些可以 cached skip。

**PR title**：`perf(renderer): gate scenario-apply refresh steps on dirty flags`

**⚠️ 高风险**：缓存跳过条件写错会导致视觉不更新。只有 baseline 证明值得才做。

**动作清单**：

- [ ] 阅读 `js/core/map_renderer.js:22069-22125` 的六件套：
  1. `ensureLayerDataFromTopology`
  2. `rebuildPoliticalLandCollections`
  3. `rebuildRuntimeDerivedState({ buildSpatial: true })`
  4. `invalidateRenderPasses(×8)`
  5. `rebuildStaticMeshes`
  6. `invalidateBorderCache`
- [ ] 对每一步，识别触发条件：
  - topology 未变 → 步骤 1/3 可跳
  - scenario chunk 切换但 topology 相同 → 步骤 3 的 spatial index 可跳
  - 仅颜色变化 → 步骤 2/3/5 全可跳（这属于 refreshColorState 路径，不应走此函数）
- [ ] 每一步加 dirty flag gate
- [ ] **必须**：每个 gate 前后都有 e2e 测试覆盖
- [ ] 跑 baseline 重测，确认总耗时下降且无视觉回归

**验收标准**：
- 场景切换（同 topology）耗时对比 baseline 减少 ≥ 20%
- 场景切换（跨 topology）耗时持平或更好
- 所有视觉元素切换后正确刷新（边界、颜色、overlay、hit-test）

**回滚**：`git revert`。这是本计划最可能回滚的 Step，不要叠加 hotfix

---

## Step 7 — map_renderer/public.js 公共 API 冻结【A3】

**前置**：Step 4 完成（避免两次大 rename）

**目标**：新建 `js/core/map_renderer/public.js` 作为 map_renderer.js 的稳定对外接口层。

**PR title**：`refactor(renderer): introduce public.js facade for external API`

**动作清单**：

- [ ] 新建目录 `js/core/map_renderer/`
- [ ] 新建 `js/core/map_renderer/public.js`
- [ ] re-export 以下 ≤ 25 个稳定公共 API（从 map_renderer.js 79 个 export 中筛选）：
  - 生命周期：`initMap`, `render`, `setMapData`, `buildInteractionInfrastructureAfterStartup`
  - 场景刷新：`refreshColorState`, `refreshMapDataForScenarioApply`, `refreshMapDataForScenarioChunkPromotion`
  - 静态重建：`rebuildStaticMeshes`, `invalidateBorderCache`
  - 图例：`renderLegend`
  - 常量：`RENDER_PASS_NAMES`
  - 视口：`setDebugMode`, `getZoomPercent`, `resetZoomToFit`, `zoomByStep`
  - （其余按实际外部依赖补充，保持 ≤ 25）
- [ ] 为 map_renderer.js 其余 55+ 个 export 添加 `@internal` JSDoc 注释
- [ ] **不动 map_renderer.js 的行数和内部结构**
- [ ] 不迁移 importer（留到 Step 8）

**验收标准**：
- `public.js` 存在，re-export ≤ 25 项
- `map_renderer.js` 行数不变（或仅因 JSDoc 注释微增）
- e2e smoke 绿（没改任何运行时行为）

**回滚**：`rm js/core/map_renderer/public.js` + revert JSDoc commit

---

## Step 8 — 外部 importer 迁移到 public.js【A3 续】

**前置**：Step 7 完成

**目标**：12 个外部 importer 逐步切换到 `map_renderer/public.js`。

**PR 策略**：每迁 2-3 个 importer 一个 PR，共约 4-5 个 PR。

**PR title 模板**：`refactor(imports): migrate <module> to map_renderer/public`

**12 个 importer 清单**（逐个勾）：

- [ ] `js/main.js`
- [ ] `js/ui/sidebar.js`
- [ ] `js/ui/toolbar.js`
- [ ] `js/ui/shortcuts.js`
- [ ] `js/ui/dev_workspace.js`
- [ ] `js/ui/dev_workspace/district_editor_controller.js`
- [ ] `js/ui/dev_workspace/scenario_tag_creator_controller.js`
- [ ] `js/ui/dev_workspace/scenario_text_editors_controller.js`
- [ ] `js/core/logic.js`
- [ ] `js/core/scenario_ownership_editor.js`
- [ ] `js/core/scenario/scenario_renderer_bridge.js`
- [ ] `js/bootstrap/deferred_detail_promotion.js`

**每 importer 的动作**：

1. 把 `from "./map_renderer.js"` 或相对路径改成 `from "./map_renderer/public.js"`
2. 如发现 importer 用到了某个 **`@internal`** 标记的函数 → **停下来问用户**是否应该把它提升为 public（不要自行决定）
3. 跑该模块相关 e2e + smoke

**验收标准**：
- `grep -rn "from.*map_renderer.js['\"]" js/` 只剩 `js/core/map_renderer/public.js` 自己 import
- 所有 importer 走 public.js
- e2e smoke 绿

**回滚**：每个迁移 PR 独立回滚

---

## 整体完工闸

Step 0-8 全部完成，且：

- [ ] `docs/perf/baseline_2026-04-20.md` 存在 + 三档完整
- [ ] B1.1 / B1.2 完成后 baseline 重测显示改善
- [ ] `runtime_hooks.js` surface 化完成
- [ ] `map_renderer/public.js` 存在，12 个 importer 已全迁（Step 8）
- [ ] CI perf smoke gate 启用
- [ ] 无任何红线（`context.md §4`）被踩过
- [ ] `plan.md §10` 踩坑记录已按实际追加

到达完工闸后，**停下来等用户决定**下一轮目标（可能是 Tier 2-4 里的某项，或继续拆 map_renderer 内部，或新方向）。**不要自作主张开新方向**。
