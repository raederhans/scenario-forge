# HOI4 Map Maker 功能借鉴评估总览

## 目标

把 `HOI4 Fantasy World Map Maker` 里最值得借鉴的 5 个功能方向，转成适合 `Scenario Forge` 的落地计划。

本组文档只处理三件事：

1. 这个功能在对方工具里为什么成立
2. 它在我们项目里值不值得做
3. 它应该怎样以最短路径接到现有架构里

## 外部参考来源

1. GitHub README  
   <https://github.com/AmonStreeling/hoi4-mod-maker/blob/main/README.md>
2. Steam Workshop 页面  
   <https://steamcommunity.com/sharedfiles/filedetails/?id=3707251866>

## 当前项目里的直接落点

- `js/core/file_manager.js`
- `js/core/history_manager.js`
- `js/core/interaction_funnel.js`
- `js/ui/sidebar.js`
- `js/ui/toolbar.js`
- `index.html`
- `docs/EXPORT_QA_ACCEPTANCE_SCRIPT.md`
- `qa/QA-093_feature_gap_analysis_2026-03-22.md`

## 五个方向的综合评估

| 方向 | 参考价值 | 接入难度 | 当前项目适配度 | 建议顺序 | 核心理由 |
| --- | --- | --- | --- | --- | --- |
| 项目打包文件 | 很高 | 中 | 很高 | 1 | 直接补齐当前 project file 的资源缺口 |
| Project Health / 导出前检查 | 很高 | 中 | 很高 | 2 | 我们已经有 Diagnostics 和 Export workbench，缺的是产品化入口 |
| HOI4 donor 导入 | 很高 | 高 | 高 | 3 | 能把 scenario-first 工作台变成更强的 mod 创作入口 |
| 启动页 + contextual hint | 高 | 中 | 很高 | 4 | 直接提升冷启动和第一次成功率 |
| Quick Init 批量初始化 | 中高 | 中 | 高 | 5 | 能显著减少新项目和新 scenario 的空白期 |

## 总体判断

### 1. 最适合先做的是“闭环补完”

`Scenario Forge` 已经有：

- scenario baseline
- project save/load
- guide
- reference image
- export workbench
- diagnostics

所以当前最短路径不是去追对方的“全地图生成器”路线，而是先把我们自己的创作闭环补完整。

### 2. 最强的借鉴点是“用户感知到的确定性”

对方工具最有产品力量的地方，不只是功能多，而是它让用户感觉：

- 我能开始
- 我知道下一步做什么
- 我知道哪里有问题
- 我知道导出后能不能用

这套体验正好补我们当前最容易卡住用户的地方。

### 3. 当前项目更适合走“scenario-first 增强版”

对方的核心是“从零生成完整 HOI4 地图 MOD”。  
我们的核心是“在现成全球地图和 scenario 数据上做编辑、叙事、呈现和导出”。

所以迁移原则应该是：

- 吸收它的 workflow
- 吸收它的确定性
- 吸收它的项目组织方式
- 保留我们自己的 scenario-first 架构

## 文档清单

1. `01_PROJECT_BUNDLE_PLAN.md`
2. `02_PROJECT_HEALTH_AND_VALIDATION_PLAN.md`
3. `03_HOI4_DONOR_IMPORT_PLAN.md`
4. `04_ONBOARDING_AND_CONTEXTUAL_HINT_PLAN.md`
5. `05_QUICK_INIT_PLAN.md`

## 执行建议

建议按下面顺序推进：

1. 项目打包文件
2. Project Health / 导出前检查
3. 启动页 + contextual hint
4. Quick Init
5. HOI4 donor 导入

这个顺序能先把已有工作台做稳，再把更重的外部导入接进来。

## 完成信号

- 五个方向都有独立的实现计划
- 每个计划都明确了 current shipped、target migration、接口、阶段和验收
- 后续执行可以直接按文档拆开发任务
