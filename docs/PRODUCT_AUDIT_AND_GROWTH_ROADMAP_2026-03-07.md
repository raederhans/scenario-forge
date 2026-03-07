# 产品审计与增长路线图

**日期：** 2026-03-07  
**状态：** Draft  
**面向对象：** 产品 / 设计 / 工程  
**相关文档：** `docs/ROADMAP.md`、`docs/ARCH_SYSTEM_REFERENCE.md`、`docs/SOVEREIGNTY_AUDIT_REPORT_2026-03-06.md`、`docs/RFC_GLOBAL_MIGRATION.md`

## 1. 核心结论

Map Creator 不应继续主要被描述为一个 `HOI4 1936/1939` 地图工具，而应重新定位为一个**面向架空历史与政治世界观创作的场景化地图工作台**。

这份产品路线的核心决策是：

- 保留 `HOI4` 作为当前最成熟的内容适配器和生态桥梁。
- 将产品叙事扩展到更广义的架空历史创作、政治归属编辑、作品展示导出与可复用场景包。
- 在接下来的两个阶段里，优先投入创作者生产效率，而不是平台外延扩张。
- 将全球数据迁移视为底层能力建设，而不是下一阶段的主宣传卖点。

本文件与 `docs/ROADMAP.md` 的关系如下：

- `docs/ROADMAP.md` 继续作为工程路线图。
- 本文件定义产品叙事、核心用户优先级以及内容增长方向。

## 2. 现状审计

## 2.1 已成熟的产品资产

### 资产 A：Hybrid 地图编辑器已经具备产品形态

当前应用已经具备很强的地图创作编辑面：

- 交互式 `fill / eraser / eyedropper / brush` 工作流
- 历史记录、快速色板、参考图描图与快照导出
- 多种上下文图层与边界样式
- 基于 Canvas + SVG 的混合渲染与稳定交互处理

这已经不是一个原型级编辑器，而是一个有明显生产力价值的创作界面。

主要依据：

- `index.html`
- `js/core/map_renderer.js`
- `js/ui/toolbar.js`
- `js/ui/sidebar.js`

### 资产 B：主权系统 + 动态边界才是真正差异化能力

这个产品最强的非通用能力，不是基础涂色，而是它能明确区分：

- 视觉颜色
- 政治归属
- controller / frontline 状态
- 动态边界重算

这使它天然适合架空历史创作、剧本编辑以及政治版图推演。

主要依据：

- `js/core/sovereignty_manager.js`
- `js/core/scenario_manager.js`
- `docs/SOVEREIGNTY_AUDIT_REPORT_2026-03-06.md`

### 资产 C：Scenario 载入与编辑已经形成内容引擎

当前仓库实际上已经拥有一套完整的 Scenario 内容链路：

- scenario registry
- 按场景拆分的 manifest
- owner / controller / core 数据载荷
- 审计结果载荷
- releasable-country 叠加能力

截至 2026-03-07，产品内已有两个正式场景：

- `HOI4 1936`
- `HOI4 1939`

主要依据：

- `data/scenarios/index.json`
- `data/scenarios/hoi4_1936/manifest.json`
- `data/scenarios/hoi4_1939/manifest.json`
- `js/core/scenario_manager.js`
- `js/core/releasable_manager.js`

### 资产 D：Palette Pack 已经在扮演“世界观风格包”

虽然当前产品语言仍使用 “palette source”，但底层资产模型实际上已经具备“风格包 / 世界观包”的意义。

当前内置包包括：

- `HOI4 Vanilla`
- `Kaiserreich`
- `The New Order`
- `Red Flood`

这为产品从“地图涂色工具”向“世界观创作工具”过渡提供了很好的桥梁。

主要依据：

- `data/palettes/index.json`
- `docs/COUNTRY_PALETTE_ASSETS.md`
- `js/core/palette_manager.js`

## 2.2 当前的主要约束

### 约束 A：交互界面过重

当前几个关键 UI 文件已经演变成大体量、多职责控制中心：

- `index.html`：1075 行
- `css/style.css`：2845 行
- `js/ui/toolbar.js`：3008 行
- `js/ui/sidebar.js`：3677 行
- `js/core/map_renderer.js`：6330 行
- `js/core/state.js`：1014 行
- `js/core/scenario_manager.js`：1158 行

这意味着当前结构仍可持续迭代，但继续堆功能的成本已经明显升高。

### 约束 B：Scenario 模式的认知成本仍然很高

产品虽然已经具备很强的 Scenario 语义，但用户需要理解过多内部概念：

- `Visual` 与 `Sovereignty`
- active sovereign
- scenario actions
- releasable core territory
- controller / frontline mode

这些复杂性在内部设计上是合理的，但对创作者来说还没有被收束成一个清晰的作者工作流。

主要依据：

- `qa/QA-051_full_app_ui_interaction_audit_2026-03-04.md`

### 约束 C：内容构建器仍然强绑定 HOI4

当前 scenario 编译器已经很强，但绑定关系也非常明确：

- `tools/build_hoi4_scenario.py`
- `scenario_builder/hoi4/*`
- 当前 scenario manifest 仍以 `bookmark_date`、`featured_tags` 与 HOI4 风格 tag 体系为中心

这意味着内容引擎已经足够强，但还不能自然地迁移成更宽泛的世界观内容系统。

### 约束 D：全球覆盖仍属于基础设施债

仓库已经明确承认，要支持真正的全球高细节，需要：

- 去欧洲化的数据管线假设
- manifest + chunk loading
- 新的运行时加载策略

这项工作很重要，但和 Scenario 创作效率、内容包装、作品导出相比，并不是当前最直接的用户价值杠杆。

主要依据：

- `docs/RFC_GLOBAL_MIGRATION.md`
- `docs/RESEARCH_GLOBAL_DATA.md`

### 约束 E：治理与自动化验证仍偏薄

当前仓库已经形成了很强的 markdown QA 文化，但自动化治理相对较轻：

- QA 文档很多
- GitHub workflow 很少
- 回归安全仍然主要依赖流程纪律，而不是系统化自动化

这不会阻塞产品方向，但会限制后续提速。

## 2.3 对当前产品形态的战略判断

这个产品最强的身份已经很清楚：

- 它不是通用 GIS 工具。
- 它不只是自由涂色地图编辑器。
- 它本质上是一个**具备场景语义的政治地图创作环境**。

因此，最高杠杆的产品策略应该是：

1. 先简化用户在 scenario 工作流中的意图表达
2. 再扩展能够复用现有引擎的内容包
3. 然后强化作品输出与发布能力
4. 最后才进一步泛化底层引擎

## 3. 产品定位

## 3.1 产品陈述

Map Creator 是一个面向架空历史与政治世界观创作的场景化地图工作台。它允许创作者载入一个世界状态，改写归属与控制关系，重新组织视觉呈现，并导出可复用的 scenario 驱动作品，用于叙事、mod 规划和展示发布。

## 3.2 核心用户

接下来阶段的核心用户包括：

- 架空历史爱好者
- 政治地图创作者
- 大战略游戏与 mod 创作者
- 剧本策划与 QA 作者
- 需要结构化领土归属表达、而不仅仅是涂色功能的世界观作者

重要产品立场：

- `HOI4` 用户是非常重要的一批早期用户
- 但他们不是唯一用户
- 产品也不应被局限在 `HOI4` 原始历史时间段之内

## 3.3 接下来两个阶段的非目标

以下方向不应成为近期优先级：

- 通用 GIS / 数据分析工作流
- 后端优先的协作系统
- 实时多人编辑
- 移动端优先
- 完整的游戏模拟逻辑

接下来仍然聚焦在：**创作、编辑、打包和展示政治场景地图**。

## 4. 公共接口策略

目标是在不破坏现有资产的前提下，扩大产品叙事和内容能力。

## 4.1 Scenario Manifest

保留当前契约兼容：

- `owners_url`
- `controllers_url`
- `cores_url`
- `audit_url`
- 当前 baseline hash 机制

建议做法不是替换它，而是在其外层规划一层可选的 vNext 元数据。

建议新增的可选字段：

| 区块 | 作用 | 兼容规则 |
|---|---|---|
| `source_adapter` | 声明该 pack 来源于 `hoi4`、未来 custom pack 或其他适配器 | 仅可选，不强制 |
| `pack_meta` | pack 身份信息、主题标签、展示分组 | 仅可选，不强制 |
| `timeline_meta` | 时代标签、时间线类型、非 HOI4 风格日期标签 | 仅可选，不强制 |
| `presentation_meta` | 推荐 palette、legend 默认值、导出默认值 | 仅可选，不强制 |

建议解释方式：

- 现有 `HOI4` 字段继续有效
- 未来的非 HOI4 pack 可以不提供这些字段
- loader 应把 HOI4 特有字段视为 adapter 元数据，而不是产品的普适真理

## 4.2 Project JSON

旧项目导入导出必须继续兼容。

建议新增的可选字段：

- `scenarioContext`
- `baseScenarioId`
- `basePackId`
- `baseBaselineHash`
- `changeSummary`
- `exportPresetId`

这些字段的意义在于：

- 支持差异保存与恢复
- 支持更安全的 scenario rebase
- 支持导出结果可重复复现

## 4.3 Palette Registry

保留当前 registry 格式，但在产品层重写其含义：

- 从：`HOI4 palette source`
- 到：`设定 / 世界观 / 视觉风格包`

建议新增的可选元数据：

- `theme_tags`
- `universe_tags`
- `era_tags`
- `marketing_label`

这样产品就能把 palette 展示为创作语境包，而不只是 mod 调色来源。

## 4.4 Releasable Catalog

保留当前 wire 兼容，但修改产品层表述：

- 从：`releasable catalog`
- 到：`政治实体规则包`

建议新增的可选元数据：

- `entity_kind`
- `activation_mode`
- `source_adapter`
- `presentation_label`

这样做的好处是：现有数据继续可用，但概念层不再长期被 HOI4 术语锁死。

## 5. 优先级路线图

## 5.1 P0：创作者效率与理解成本收束

目标窗口：未来 30 天

这部分优先级最高，因为它直接提升当前已有强引擎的创作效率，而不需要等待全球数据能力完成。

| 项目 | 为什么现在做 | 主要依赖 | 契约影响 | 成功信号 |
|---|---|---|---|---|
| Scenario Quick Start 收束 | Scenario 能力已强，但第一次使用成本太高 | UI / state | 无 | 第一次使用 scenario 的流程变得自解释 |
| Visual vs Political 工作流降复杂 | 当前双轨模型在技术上成立，但认知成本高 | UI / state | 无 | 误操作变少，左右栏来回跳转显著减少 |
| 项目差异保存与恢复 | 创作者需要干净地保存基于 scenario 的改动 | project import / export | `project JSON` 扩展 | 用户能基于场景反复迭代，而不是每次保存整份大状态 |
| 作品导出预设 | 当前截图导出可用，但仍过于通用 | export flow | 可选 `project JSON` 元数据 | 能稳定导出宣传图、海报图、报告图 |
| 关键模块拆分与稳定性治理 | 当前大文件结构会拖慢后续所有功能 | JS 架构 | 无 | scenario/editor 的后续改动成本下降 |

### P0 决策说明

P0 的目标应该是让作者工作流更顺，而不是扩大平台边界。

在 UI 语言上，也应该明确重写内部概念：

- `Visual` -> 更偏外观意图的编辑
- `Sovereignty` -> 更偏政治归属意图的编辑

最终具体文案可以再定，但用户看到的应当是“创作意图”，而不是“内部实现机制”。

## 5.2 P1：内容生产与 Scenario Pack 增长

目标窗口：未来 90 天

P1 的目标，是让产品开始具有“内容系统”气质，而不仅是一个很强的编辑器。

| 项目 | 为什么现在做 | 主要依赖 | 契约影响 | 成功信号 |
|---|---|---|---|---|
| Scenario Pack 浏览与切换器 | 当前 scenario 更像应用内部资产，而不是可复用内容单元 | scenario UI + metadata | `scenario manifest` 元数据层 | pack 变得可发现、可分组、可品牌化 |
| 规则包 / 边界变体可视化 | 当前边界规则很强，但对作者不透明 | UI + releasable / rule metadata | 可选 rule metadata | 作者能安全查看和比较政治变体 |
| 叙事注释与图例联动 | 世界观创作需要故事语境，不只是边界 | legend / project state | 可选 project metadata | 地图本身就具备展示能力，不必完全依赖外部工具 |
| 批量宣传图 / 图册导出 | 创作者往往需要一组输出，而不止一张图 | export tooling | 可选 export preset metadata | 一个 scenario 能产出整套展示包 |
| 创作者模板工程 | 降低从空白工程开始的门槛 | 内容整理 + metadata | 可选 pack metadata | 用户可以从主题模板出发，而不是每次从零开始 |

### P1 决策说明

P1 的目标是把产品推进为一个“可复用内容平台”。

这一步最重要的变化是：

- 从应用内部状态
- 走向可打包、可浏览、可复用的 scenario-pack 资产

## 5.3 P2：平台扩展

目标窗口：长期

这些方向很重要，但在接下来的几个阶段里，不应高于创作者效率与内容资产建设。

| 项目 | 为什么放后面 | 主要依赖 | 契约影响 | 成功信号 |
|---|---|---|---|---|
| 全球分块数据加载 | 对全球覆盖至关重要，但不是最快提升创作者价值的杠杆 | pipeline + runtime loader | topology manifest 演进 | 全球高细节加载稳定，不拖垮启动体验 |
| Pack 分享 / 发布格式 | 有价值，但前提是 pack 模型先稳定 | scenario-pack 模型 | pack manifest 约定 | pack 能在仓库外安全流通 |
| 非 HOI4 适配器 | 战略上重要，但应建立在 pack 抽象成熟后 | adapter 架构 | `source_adapter` 语义 | 产品能自然接入非 HOI4 世界，而不是强行伪装成 HOI4 |
| 轻量发布站 / 档案馆 | 在内容量足够后很有意义 | export + pack packaging | 初期可无 | 创作者能发布 scenario 页面与作品档案 |

## 6. 推荐的剧本包与内容主题

以下推荐按“复用现有资产的效率”排序，目标是扩大产品内容广度，但不让产品陷入“只会做 HOI4 时间点”的印象。

| 优先级 | 主题 / Pack | 为什么适合现在做 | 资产复用程度 | 主要新增工作 |
|---|---|---|---|---|
| 1 | `HOI4 Vanilla` 扩展时间点 | 最容易利用现有 compiler、rule 和 QA 体系扩展内容深度 | 很高 | 新 scenario rules、audit 和策划节点 |
| 2 | `Kaiserreich` 核心包 | 已有 palette 身份，且具备明显架空历史吸引力 | 高 | pack 级 scenario 数据和 tag / owner 映射 |
| 3 | `TNO` 区域包 | 视觉辨识度高，适合强化世界观表达 | 高 | scenario-pack structuring 与 controller/frontline 展示增强 |
| 4 | `Red Flood` 展示包 | 风格强烈，适合结合宣传图与设定图输出 | 高 | scenario authoring 打磨与 narrative preset |
| 5 | 一战后架空裂变线 | 能拓宽产品叙事，又能利用当前欧洲区域强项 | 中高 | manual rule pack 与更通用的 scenario metadata |
| 6 | 冷战热战线 | 很适合体现 owners / controllers / frontline 分离的价值 | 中 | controller 导向 scenario 与叙事说明增强 |
| 7 | 去殖民化碎片化世界 | 天然适合政治地图叙事 | 中 | 更广地理覆盖与更多规则资产 |
| 8 | 帝国复辟 / 区域联邦包 | 很适合架空历史沙盘表达 | 中 | 更强模板化能力与 scenario-pack 组合能力 |

### 内容策略指导

近期内容路线应优先选择以下类型：

- 能复用当前政治归属语义
- 能复用当前 palette 或与现有 palette pack 相近
- 能从 releasable 与 boundary-variant 逻辑中受益
- 能明显拓宽产品世界观，但又不需要重做一套引擎

不应在下一阶段优先投入那些必须依赖全新引擎概念、才能成立的宇宙型内容。

## 7. 其他高杠杆衍生项目

这里只推荐那些与当前仓库强耦合、并且能放大现有引擎价值的项目。

| 项目 | 作用 | 为什么值得做 | 主要依赖 |
|---|---|---|---|
| Scenario Builder 工作台 | 把当前 CLI / compiler 流程变成更适合创作者使用的内容生产链 | 这是把内部内容生产能力产品化的最高杠杆 | 当前 scenario compiler 与 manual-rule 流程 |
| 政治边界规则审计器 | 把当前重 QA 的人工审核流程正式化 | 与现有 releasable / boundary-variant 工作流高度契合 | rule metadata + reporting |
| 批量海报 / 图册导出器 | 从单一 scenario 批量生成展示图 | 能显著放大创作者成果，而不需要新增地图逻辑 | export preset 与 scenario metadata |
| Scenario Pack 校验与发布工具链 | 让 pack 更容易验证与分享 | 是 pack 模型成熟后的自然延伸 | manifest meta layer 与校验规则 |

### 明确低优先级的衍生方向

以下方向不应优先启动：

- 实时协作后端
- 用户账户系统
- 浏览器多人编辑
- 通用 GIS import / export 市场

这些方向会在 scenario-pack 模型还不成熟时，过早稀释产品焦点。

## 8. 依赖关系图

这一节的目标，是避免未来实现时再次出现方向性二次决策。

## 8.1 仅需 UI / State 变更

这些功能理论上不需要改动 scenario wire format：

- Scenario Quick Start 收束
- 模式文案与工作流降复杂
- 更清晰的 context bar 与引导
- 导出 preset 的 UI 外壳
- 模块拆分与 state 清理

## 8.2 需要扩展 Project JSON

这些建议应一起设计：

- 项目差异保存 / 恢复
- 基于 baseline 的重新打开流程
- 导出 preset 持久化
- 基于 scenario 的变更摘要

## 8.3 需要扩展 Scenario Manifest

以下能力依赖前面提到的 vNext 元数据层：

- Scenario Pack 浏览器
- 非 HOI4 pack 的展示能力
- 不依赖 bookmark 语义的年代 / 时间线标签
- pack 级品牌化与内容分组

## 8.4 需要扩展 Data Pipeline / Runtime Loader

以下能力依赖更重的底层基础设施：

- 全球分块政治数据
- 更广地理范围的新内容包
- 更大规模的世界级 context-pack 加载

## 9. 验证场景

所有路线图中的工作，都应至少对以下用户旅程进行验证。

## 9.1 第一次使用 Scenario 的新用户

目标：

- 载入一个 scenario
- 理解当前编辑模式
- 完成一次归属编辑
- 导出一份可读结果

失败信号：

- 用户仍然需要额外解释才能理解 `active sovereign`、`visual` 或 `scenario action`

## 9.2 回归的重度用户

目标：

- 重新打开一个已有 scenario 项目
- 对比 baseline
- 在没有数据漂移的前提下继续编辑

失败信号：

- 用户无法判断哪些是 pack 自带内容，哪些是自己的后续改动

## 9.3 非 HOI4 架空包试运行

目标：

- 能表达一个沿用当前地图资产、但不依赖 HOI4 原生时间语义的 scenario

失败信号：

- 产品只能通过“伪装成另一个 HOI4 bookmark”来表达内容

## 9.4 Releasable / 政治实体规则作者

目标：

- 检查规则覆盖情况
- 预览政治实体变体
- 有信心地应用并验证领土变化

失败信号：

- 作者仍需要通过原始 JSON 和临时 QA markdown 才能理解规则真实含义

## 9.5 重展示导向的创作者

目标：

- 从一个 scenario 生成多种导出样式
- 包含 legend、注释或品牌化视觉 preset

失败信号：

- 创作者每次都必须依赖外部设计工具做二次整理

## 10. 30 天 / 90 天 / 长期执行顺序

| 时间范围 | 交付重点 | 暂不扩展到 |
|---|---|---|
| 30 天 | scenario quick start、模式收束、导出预设、项目差异设计、模块拆分 | 云端功能、后端系统、全球数据承诺 |
| 90 天 | scenario-pack 浏览、规则可视化、叙事注释、批量导出、创作者模板 | 过早做成完全泛化的适配器生态 |
| 长期 | 全球分块加载、非 HOI4 adapter、可移植 pack 发布、轻量发布 / 档案面 | 泛 GIS 平台 ambitions |

## 11. 最终产品建议

Map Creator 的下一阶段，不应该是：

- “更多按钮”
- “更通用的世界地图工具”
- “只会切换 HOI4 日期的浏览器”

它应当成为一个**以创作者为中心的架空历史 Scenario Studio**，具备：

- 清晰的政治编辑工作流
- 可复用的 scenario packs
- 强输出能力与展示能力
- 在保留 HOI4 兼容性的同时，逐步抽象出更通用的 adapter 能力

这条路线最符合当前仓库已经具备的强项，也最有机会把现有内部能力逐步推向更完整的创作平台。

## 12. 假设

- 核心用户包含架空历史爱好者和政治世界观创作者，而不仅仅是 HOI4 玩家。
- 近期产品仍然以本地优先、离线可用为主。
- 现有 `scenario / sovereignty / palette / releasable` 资产应被保留并抽象，而不是重做一套新引擎。
- `docs/ROADMAP.md` 继续是主工程路线图，本文件承担产品与增长策略文档的角色。
