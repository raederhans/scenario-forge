# Sovereignty / Visual 双轨系统审计报告（2026-03-06）

## 1. 结论摘要（先给答案）

你现在感知到的“像两套并行系统”，在代码层面确实存在，而且是**有意设计**：

- **Visual 轨（视觉轨）**：只改颜色，不改归属。核心是 `visualOverrides`（按 feature 粒度上色）。
- **Sovereignty 轨（主权轨）**：改归属（owner），颜色只是“owner 的表现层”。核心是 `sovereigntyByFeatureId`（feature -> owner 绑定）。

它们并非完全独立：最终渲染会先看视觉覆盖，再退回 owner 颜色；因此视觉轨会“盖住”主权轨的表现，但不会改 owner 本身。

---

## 2. 系统中的关键概念与“谁控制什么”

### 2.1 数据层对象（State）

当前状态里同时存在下列关键字段：

- 视觉覆盖：`visualOverrides` / `featureOverrides`（兼容镜像）
- 主权归属：`sovereigntyByFeatureId`
- 主权颜色：`sovereignBaseColors` / `countryBaseColors`（兼容镜像）
- 模式开关：`paintMode`（`visual` or `sovereignty`）
- 主权编辑目标：`activeSovereignCode`
- 动态边界状态：`dynamicBordersDirty` 等

这些字段都在统一状态中定义。`featureOverrides` 和 `countryBaseColors` 已经被当作旧命名兼容层保留（新主字段是 `visualOverrides` / `sovereignBaseColors`）。

### 2.2 渲染判定优先级（最关键）

单个 feature 颜色解析顺序是：

1. 先看 `visualOverrides[featureId]`
2. 没有视觉覆盖时，取该 feature 的 owner（`sovereigntyByFeatureId`，否则回退 canonical country）
3. 再看该 owner 的颜色 `sovereignBaseColors[owner]`

这意味着：

- 视觉覆盖是“局部 override”；
- 主权决定“默认归属颜色”和“边界逻辑”；
- 视觉覆盖不会改变 owner。

### 2.3 UI 层的双轨入口

工具栏直接暴露了“Paint Meaning”两种模式（Visual / Sovereignty），并有“Active Sovereign”选择。

- 切换到 `sovereignty` 时，粒度会强制回到 subdivision（防止 country 粒度误用）。
- 选区动作（点击、笔刷、预设、层级组）在 `paintMode` 下分叉执行：
  - visual 模式：写 `visualOverrides`
  - sovereignty 模式：写 `sovereigntyByFeatureId`

所以你在体验上会感到它们像两套系统，是因为从输入、存储到行为都做了分叉。

---

## 3. “主权”到底有什么用

### 3.1 让地图支持“动态政治归属”

`sovereigntyByFeatureId` 提供 feature->owner 的运行时绑定，不必受原始 `cntr_code` 限制。可用于：

- 历史剧本改边界
- 手工改归属（刷主权）
- 以 owner 而非 canonical country 计算颜色和边界

### 3.2 动态边界线（核心收益）

动态边界网格构建时，用的是 owner 对比（邻接 feature 的 owner 不同则画边界），并且会在主权修改后触发重算。

这就是“动态国境线”能力的根基；如果只剩视觉系统，边界只能回到 canonical（静态）逻辑。

### 3.3 场景（Scenario）应用的主干载体

Scenario 载入时，会把 `owners.by_feature.json` 直接灌入 `state.sovereigntyByFeatureId`，并切到 `scenario_owner_only` 边界模式，随后重算动态边界。

换言之：**Scenario 的政治版图落地，本质依赖主权轨。**

### 3.4 预设与层级动作的“语义切换”

同一个“应用预设/层级组”按钮，在不同模式语义不同：

- Visual：上色
- Sovereignty：改 owner

这提高了复用性，但也确实提高了理解成本（同一 UI，有两套语义）。

### 3.5 历史记录 / 导入导出的完整性

项目导入导出、历史回放都保存了主权字段（含兼容迁移），并在主权回放后重建 owner 索引、可触发动态边界重算。

---

## 4. 它现在控制了主 App 和剧本的哪些部分

### 4.1 主 App（编辑器）

主权轨当前控制：

1. **编辑行为分叉**：点击填充、橡皮、笔刷、预设、层级组动作在 sovereignty 模式下写 owner。
2. **Active Sovereign 语义**：作为 sovereignty 模式操作目标。
3. **动态边界**：基于 owner 邻接差异生成并缓存。
4. **颜色回退层**：无视觉覆盖时按 owner 颜色显示。
5. **项目文件结构**：保存 `sovereigntyByFeatureId`、`paintMode`、`activeSovereignCode`、动态边界脏状态。
6. **撤销重做语义**：`affectsSovereignty` 分支会触发额外边界重算与索引修复。

### 4.2 剧本（Scenario）

主权轨在剧本上是“一级公民”：

1. 构建脚本输出 `owners.by_feature.json`（每个 feature 一个 owner tag）。
2. Manifest 明确暴露 `owners_url`，App 加载后写入 `state.sovereigntyByFeatureId`。
3. 应用场景后边界模式切换到 `scenario_owner_only`，以 owner 边界渲染。
4. Reset to baseline 的核心也是恢复 `scenarioBaselineOwnersByFeatureId`。

因此，Scenario 系统不是“附着在视觉覆盖上”的；它和主权轨是强绑定。

---

## 5. 如果移除主权、恢复单一视觉模式，会有什么影响

下面按“功能损失 / 数据影响 / 迁移复杂度”分层说明。

### 5.1 直接功能损失（高确定性）

1. **动态国境线能力消失**（或退化为 canonical 静态国界）。
2. **Scenario 的 owner 政治版图无法按现有语义落地**。
3. **Active Sovereign 与 paintMode=sovereignty 整套 UI/交互失效**。
4. **预设/层级组“改归属”语义消失，只剩“上色”。**

### 5.2 对现有项目文件与兼容的影响

当前项目文件 schema 含多个主权字段。删除主权后要做：

- 导入时忽略/迁移这些字段，保证旧文件不炸；
- 重新定义“scenario 项目”的保存语义（是否还能保存为视觉快照）；
- 清理历史记录中的 sovereignty patch 逻辑。

否则会出现“旧项目加载后看起来不对/边界不对/无法回放”的问题。

### 5.3 对 Scenario 工具链的影响（最大）

你现在的 scenario_builder（脚本侧）以 owner 分配为中心产出 `owners.by_feature.json`、`baseline_hash`、审计指标等。

如果移除主权，需要二选一：

- **A. 保留脚本但降级 app**：app 不再吃 owners，只把 scenario 结果烘焙成视觉颜色（语义严重缩水）；
- **B. 重写 scenario contract**：把 owner 概念完全换成视觉快照（会破坏审计和历史可解释性）。

两条路都不是“删几个字段”级别，是体系迁移。

---

## 6. 你说的“主区域”在这套结构里的位置

你提到“主区域”我判断主要对应两类东西：

1. **Hierarchy groups / parent borders**（结构化区域）
2. **Scenario 下的 parent-owner / releasable 关系**（国家树）

这些不完全等于主权，但会在 sovereignty 模式下改变语义：

- 同一组区域点击，在 visual 是“涂色”，在 sovereignty 是“改归属给主人”。

所以“主区域”的复杂感，很多来自“结构化分组 + 双轨语义叠加”。

---

## 7. 是否建议“完全移除主权”

### 结论

**不建议直接硬删。**

更可行的是“降复杂度而不拆主干”：

1. 默认锁定 Visual 模式（面向普通编辑）；
2. 把 Sovereignty 模式收纳到高级开关；
3. Scenario 激活时自动启用 Sovereignty 语义并显式提示；
4. 在 UI 文案上把概念重命名为：
   - Visual = 视觉涂色
   - Sovereignty = 政治归属（影响边界与剧本）

这样能显著减轻心智负担，同时保住你最难重建的资产（动态边界 + scenario owner contract）。

---

## 8. 最小化改造建议（如果你的真实目标是“简化体验”）

### 阶段 1（低风险）

- 把 paintMode 默认固定为 visual；
- 非 scenario 状态下隐藏 Active Sovereign；
- 预设/层级按钮在 visual-only 文案下展示“涂色”。

### 阶段 2（中风险）

- 将主权编辑入口收纳到“Advanced / Scenario Editing”；
- 增加“当前模式影响范围”提示（是否影响 owner 与边界）。

### 阶段 3（高风险，谨慎）

- 仅当确认不再需要 Scenario owner 语义时，才考虑真正移除主权数据结构。

---

## 9. 诊断依据（我这次审计看了什么）

- 主权状态与迁移：`js/core/sovereignty_manager.js`
- 渲染解析与动态边界：`js/core/map_renderer.js`
- 场景加载/应用/重置：`js/core/scenario_manager.js`
- 工具栏模式切换：`js/ui/toolbar.js`
- 侧栏预设/层级动作分叉：`js/ui/sidebar.js`
- 项目导入导出 contract：`js/core/file_manager.js`
- 历史回放与主权联动：`js/core/history_manager.js`
- 剧本构建脚本与 owners 产物：`tools/build_hoi4_scenario.py`、`scenario_builder/hoi4/compiler.py`

