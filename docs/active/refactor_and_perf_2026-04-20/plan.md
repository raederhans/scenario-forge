# 重构续作 + 性能基线整合计划（2026-04-20）

## 0. 本计划的位置

这是在 `docs/active/further_split/` 既有 `plan.md` + `task.md` 基础上**续写 Batch 5 之后的下一程**，同时**纳入性能轨道**作为并行第二条线。

**不替换**既有 plan.md / task.md — Batch 1-5 的记录保留。本文件是 Batch 6 起的新蓝图。

---

## 1. 写作前提（必读，划定边界）

用户在重新拟定这次计划时给出两条强校准，影响所有后续判断：

1. **性能债是老账，不是拆分负债**。拆分可能有少量叠加开销，但性能重从很久前就存在。不能把"卡顿"当作"拆分的后果"来倒推回滚
2. **拆分的目标是稳定性 + 可维护性**，拆分本身**不应引入新开销**，但**也不指望**通过拆分直接把老账还清；拆分应"打好下一步修性能的地基"

基于此，计划采取**两轨并行**：

- **轨 A：重构续作** — 严格按 `plan.md` 的 3-phase 路线往下走（scenario → state/runtime_hooks → renderer API），不开新战线
- **轨 B：性能基线 + 靶向修复** — 独立于拆分，先建测量，再挑风险最低的老问题修

---

## 2. Ground truth（2026-04-20 真实状态）

### 2.1 已完成（Batch 1-5）

- `js/core/scenario/` 下 9 个文件（lifecycle_runtime / presentation_runtime / bundle_runtime / chunk_runtime / bundle_loader / startup_hydration / scenario_renderer_bridge / shared / pure_helpers）
- `js/core/state/` 下 7 个默认值工厂（border_cache / dev / history / renderer_runtime / scenario_runtime / spatial_index / strategic_overlay）
- `js/core/renderer/` 下 6 个 owner（strategic_overlay_runtime / border_mesh / border_draw / political_collection / spatial_index_runtime / interaction_border_snapshot，合计 3,313 行）
- `state.js` 保持**单例门面**（429 行），**未**拆成 slices，**未**引入 Proxy，**未**引入 bus
- `runtime_hooks.js` 仍存在（99 行），仍被 state.js 导入

### 2.2 仍然存在的结构事实

- `map_renderer.js`：22,230 行 / 79 个 named export / 占全仓 1,587 处 `state.foo =` 写入中的 742 处（47%）
- 有 12 个模块直接 import `map_renderer.js`，其中一半是 UI 层
- 6 个 owner 通过"工厂注入 state + helper callbacks"与 map_renderer 耦合，不是独立代理
- UI ↔ Core 循环依赖（`map_renderer.js` import `ui/toast.js`, `ui/i18n.js`）
- `css/style.css` 里几个 `--visible` modifier 类已被证明是上次 refactor 的笔误，已在今天修完一处（`.boot-overlay--visible`），另一处（`.startup-readonly-banner--visible`）随手清理

### 2.3 Batch 5 悬挂项

- `task.md:71`：`strategic_overlay_editing` e2e 启动就绪超时未定性（新回归 vs 环境抖动）

### 2.4 被**废弃**的旧方向

- "state.js → 8 slices + Proxy facade + bus.js + 删 runtime_hooks.js" 不再执行
- 原 Tier 1 蓝图（commit-pr-shiny-summit.md 五节）作为**历史参考**保留，不做当前待办

---

## 3. 指导原则

1. **承认老账**：性能问题大多先于拆分存在，修与不修是独立决策
2. **测量先于优化**：没有 baseline 就不优化，优化后必须对比 baseline
3. **拆分 perf-neutral**：后续每个拆分 PR 必须证明不比 baseline 差超过 ±5%
4. **3-phase 路线不改**：scenario → state/runtime_hooks → renderer API
5. **大文件不是罪**：`map_renderer.js` 22K 行不是本轮的攻击目标，**API 稳定化**才是——先冻结公共面，再谈后续拆分
6. **小步、可回滚**：每个 Step 独立 PR，失败回滚不叠加
7. **不扩大范围**：Tier 2-4（UI 解耦、纯函数层、打包器、构建链、git 清仓）在本计划之外

---

## 4. 轨道 A：重构续作（沿用 3-phase，不开新战线）

### A1. 关闭 Batch 5 尾巴

- 本地 + CI 各跑 `strategic_overlay_editing` e2e 3 次
- 定性：
  - 若 3 次全失败同样错误 → **新回归**，开定位 PR
  - 若抖动（成功/失败混合） → 环境问题，写入 known issues，e2e 加重试
- 更新 `task.md:71` 打勾

### A2. runtime_hooks.js 分组收敛（**不是**删掉它）

当前：`runtime_hooks.js` 有 60 个扁平 `*Fn` 字段（updateHistoryUIFn、refreshColorStateFn、recomputeDynamicBordersNowFn 等），全部挂在 state 上。

新目标：**结构收敛、语义不改、文件不删**。

```js
// 新结构（示意）
export function createDefaultRuntimeHooks() {
  return {
    ui: createDefaultUiRuntimeHooks(),       // 所有 update*UIFn（~30 个）
    command: createDefaultCommandRuntimeHooks(),  // 所有 run*Fn / toggle*Fn（~15 个）
    data: createDefaultDataRuntimeHooks(),   // ensure* 系（~8 个）
    render: createDefaultRenderRuntimeHooks(), // refresh/recompute/render*（~7 个）
  };
}
```

**好处**：
- state 里不再有 60 个扁平指针，而是 4 组 surface
- write site 从 60 个收敛到 4 个
- 未来要改 subscription 模型时，只需要替换 4 个 surface 的实现，不需要找 60 个 write site

**风险**：消费者要从 `state.updateHistoryUIFn?.()` 改成 `state.ui.hooks.updateHistory?.()`——批量 rename，风险低

**回滚方式**：纯结构性改动，失败直接 revert，行为语义零变化

### A3. map_renderer.js 公共 API 冻结（不减少行数，只明确契约）

**不是**再抽新 owner。现有 6 个 owner 够了，再拆会继续稀释 map_renderer 的责任而不收敛。

**新目标**：在 map_renderer.js 旁边建 `js/core/map_renderer/public.js`（极薄 re-export 层），只列稳定公共 API（预计 15-20 个）：

```js
// public.js（示意）
export {
  initMap,
  render,
  setMapData,
  buildInteractionInfrastructureAfterStartup,
  refreshColorState,
  refreshMapDataForScenarioApply,
  refreshMapDataForScenarioChunkPromotion,
  rebuildStaticMeshes,
  renderLegend,
  // ... 其他公共接口
  RENDER_PASS_NAMES,
} from "../map_renderer.js";
```

**其余 60+ 个 export** 留在 map_renderer.js 顶层但加 `@internal` JSDoc，不列入 public.js。

**外部 importer 逐步迁移**（12 个文件）：
- `main.js` / `sidebar.js` / `toolbar.js` / `shortcuts.js` / dev_workspace 四件套 / `logic.js` / `scenario_ownership_editor.js` / `scenario_renderer_bridge.js` / `deferred_detail_promotion.js`

每个 importer 迁移 = 把 `from "./map_renderer.js"` 改成 `from "./map_renderer/public.js"`，如果发现导入了 `@internal` 项则记录并讨论是否该提升为 public。

**好处**：
- 冻结外部可用的 API 面，未来真要拆 map_renderer 有稳定边界
- 不动 map_renderer 行数，风险为零
- `@internal` 标记让后续 dead-code 清理有据可依

**回滚方式**：public.js 是纯 re-export，可随时删除，importer 改回原路径

---

## 5. 轨道 B：性能基线 + 靶向修复

### B0. 建立 perf baseline（**所有 B 的前置**）

没有 baseline 就没有"变好"的证据，所有优化都是瞎修。

**动作**：
1. 在 `js/core/` 下新建 `perf_probe.js`，导出一个最小的 `mark`/`measure` 包装，基于 `performance.mark` + `performance.measure`
2. 在以下关键边界打点（不动业务逻辑，只加 `perfProbe.mark(...)`）：
   - `boot:start` → `boot:topology-loaded` → `boot:scenario-applied` → `boot:ready`
   - `refreshMapDataForScenarioApply` 入口/出口
   - `refreshColorState` 入口/出口
   - `render()` 每次调用（累加耗时，不是每次记）
   - `rebuildPoliticalLandCollections`、`rebuildStaticMeshes`、`invalidateBorderCache` 各自入/出
3. 选三档代表场景：
   - **空场景**：最小 scenario（基础拓扑 + 2-3 国）
   - **中等场景**：典型使用（默认 scenario）
   - **最大场景**：已知最慢的 scenario（你选一个）
4. 每档本地跑 5 次，取中位数
5. 结果写入 `docs/perf/baseline_2026-04-20.md`，包含：每个 mark 的耗时、总启动耗时、首次可交互耗时、切换场景耗时、缩放/平移 16ms 预算达成率

**这一步不优化任何东西**，只建立"今天的水位"。之后所有 A/B 系列 PR 都要对照这个基线。

### B1. 低风险靶向修复（做得完就做，做不完不卡流程）

修复顺序按**信心度 + 风险比**，不按"多快见效"。每项做完跑一次 baseline 对比。

#### B1.1 双 render per scenario load（高信心，低风险）

**位置**：`js/core/scenario_post_apply_effects.js:248-271`

**现状**：
- Line 251: `refreshMapDataForScenarioApply({ suppressRender: false })` — 立即渲染一次
- Line 266-270: `syncCountryUi({ renderNow })` — 尾部可能再渲染一次
- 默认场景下两次都会跑

**修复**：
- 统一改为 `refreshMapDataForScenarioApply({ suppressRender: true })` + 末尾单一 render
- 风险：需要验证中间步骤（`rebuildPresetState`、`refreshScenarioShellOverlays`）是否有读"上一轮 render 后状态"的隐藏依赖——用 baseline + e2e 验证

**收益**：中等场景加载预计减 50-100ms（一次完整 render 的量）

**是老账**：这个逻辑在拆分之前就是这样，不是回归

#### B1.2 color map 浅拷改增量（中信心，低风险）

**位置**：`map_renderer.js:4996, 8015, 19346`

**现状**：
```js
state.countryBaseColors = { ...state.sovereignBaseColors };
state.featureOverrides = { ...state.visualOverrides };
```
每次 `refreshColorState` 调用都整图浅拷，数据量 O(countries)。

**修复**：
- 换成增量写入：遍历源 map，只对发生变化的 key 覆盖
- 或者直接用 `Map` 实例（而非 plain object），取消浅拷

**风险**：如果有消费者依赖"拷贝副本"的语义（修改 target 不影响 source），要先用 grep 确认没有这种假设

**收益**：refresh 热路径每次节省若干 ms，场景切换频繁时累计

**是老账**

#### B1.3 `refreshMapDataForScenarioApply` 六件套审查（**须等 B0 完成**）

**位置**：`map_renderer.js:22069-22125`

**现状**：每次 scenario apply 都同步跑六步：ensureLayerDataFromTopology / rebuildPoliticalLandCollections / rebuildRuntimeDerivedState(buildSpatial=true) / invalidateRenderPasses(×8 passes) / rebuildStaticMeshes / invalidateBorderCache

**问题**：不是所有场景切换都需要全部重建。比如同一个 topology 下换 scenario chunk，不需要重建 spatial index。

**修复路径**：
- 前提必须有 B0 baseline
- 识别每一步的"何时必须重建"条件（例如"topology revision 未变则跳过 spatial 重建"）
- 用条件 gate 包裹

**风险**：高。这是最容易踩坑的一块——缓存跳过条件写错会导致视觉不更新

**决策**：**做与不做视 B0 baseline 而定**。如果 baseline 显示这一块占启动耗时 > 30%，则做；< 10% 则跳过

### B2. Perf smoke CI 门（配合 A 系列 PR）

- 在 GitHub Actions 里加一个 perf smoke job：启动 dev server → 加载中等场景 → 记录总耗时
- 阈值：不超过 baseline × 1.15（留 15% 抖动余量）
- 所有 A 系列 PR 必须过这个门
- **目标**：保证后续拆分不让性能变差；不强求变好

### B3. 明确不做的性能工作（**Non-goals**）

- ❌ 不引入打包器（Vite/esbuild/rollup）
- ❌ 不重写 canvas 绘制层
- ❌ 不迁移 OffscreenCanvas / WebGPU
- ❌ 不改 topology 数据格式
- ❌ 不做 Worker 化改造（除现有 startup_boot.worker.js 外）
- ❌ 不触碰 render pass cache 的存储结构

这些都是"真正大改"，和本计划"稳定性 + 地基"的目标冲突。

---

## 6. 执行顺序（交错推进）

```
Step 0:  [B0]   建 perf baseline                        前置，必先做
Step 1:  [A1]   关闭 Batch 5 尾巴（e2e 定性）           独立
Step 2:  [B1.1] 双 render 合并                           依赖 Step 0
Step 3:  [B1.2] color spread 改增量                      独立于 Step 2
Step 4:  [A2]   runtime_hooks surface 化                 独立
Step 5:  [B2]   CI perf smoke 门                         依赖 Step 0
Step 6:  [B1.3] refreshMapDataForScenarioApply 审查       强依赖 Step 0 数据；可跳过
Step 7:  [A3]   map_renderer/public.js 白名单            独立
Step 8:  [A3 续] 外部 importer 逐步迁移到 public.js       依赖 Step 7
```

---

## 7. 步骤间边界（互相影响分析）

| 步骤 | 依赖 | 可与谁并行 | 互相影响 |
|---|---|---|---|
| Step 0 | 无 | 无 | 前置。0 未完，B 系列全部卡住 |
| Step 1 | 无 | 其他全部 | 纯诊断/小补丁，不动代码架构 |
| Step 2 | Step 0 | Step 3, 4 | 改 scenario_post_apply_effects 调用形状；与 Step 4（runtime_hooks）无交集 |
| Step 3 | Step 0 | Step 2, 4 | 动 map_renderer.js 三处 color 浅拷；与 Step 2 无交集 |
| Step 4 | 无 | Step 2, 3, 7 | 改 runtime_hooks + 60 个 write site 的 rename；和 A3 无交集 |
| Step 5 | Step 0 | 所有 | CI 配置，不动代码 |
| Step 6 | Step 0 数据 | — | 高风险；必须串行；做之前先 Step 2/3 先拿走低挂果 |
| Step 7 | 无 | Step 4 | 纯新增文件，不动 map_renderer.js 内部 |
| Step 8 | Step 7 | — | 逐 importer 小 PR，每个独立回滚 |

**关键独立性**：
- A 轨 (Step 1, 4, 7, 8) 与 B 轨 (Step 0, 2, 3, 5, 6) **完全正交**，可由不同时段推进
- A 轨内部：A1 → A2 → A3（Step 1 → 4 → 7 → 8）顺序建议但非强制
- B 轨内部：Step 0 是前置；Step 2、3 可并行；Step 6 最后（数据驱动决策）

---

## 8. 成功标准（可验证）

- [ ] `docs/perf/baseline_2026-04-20.md` 存在，三档场景数据完整
- [ ] Batch 5 `task.md:71` 打勾
- [ ] `runtime_hooks.js` 仍存在，但顶层从 60 个扁平 Fn 收敛到 4-5 个 surface
- [ ] `js/core/map_renderer/public.js` 存在，re-export ≤ 25 个稳定 API
- [ ] 至少 6/12 个 importer 迁移到 public.js
- [ ] map_renderer.js 顶层导出的 `@internal` 标记完整
- [ ] B1.1 完成后，中等场景加载耗时对比 baseline 减少 ≥ 40ms
- [ ] B1.2 完成后，refreshColorState 对比 baseline 减少 ≥ 30%（或确认老瓶颈不在这）
- [ ] CI perf smoke job 跑绿，所有 A 轨 PR 都过这个门
- [ ] 没有任何 A/B 轨 PR 让 baseline 变差超过 5%

---

## 9. 回滚策略

- 每个 Step 一个 PR，失败立即 `git revert`，不叠加 hotfix
- B1.3 如果证据不足（baseline 显示占比 < 10%）→ 直接跳过，不强做
- A2 如果某个 `*Fn` 跨域迁移成本过大 → 留在顶层 flat 列表，不强行归类
- A3 public.js 如果发现遗漏必需 export → 迭代补充，不删 map_renderer.js 顶层 export
- 任一 Step 出现视觉回归 → 回滚后在本文件 §10 追加"踩坑记录"

---

## 10. 踩坑记录（执行时追加）

（空 — 执行时追加）

---

## 11. 起点

**第一步明确**：开 Step 0 (B0 baseline) PR。其他什么都别动。先测量。

Step 0 完成并 baseline 提交后，再按 §6 顺序推进。
