# QA-046 — HOI4 1936 剧本数据、载入与 UI 审计

**Date:** 2026-03-04  
**Scope:** HOI4 1936 剧本离线编译链、前端运行时载入、地图呈现、剧本相关 UI 与后续优化路线  
**Method:** 静态代码审计 + 资产结构审计 + 浏览器快速巡检 + 手工重放 “选择 HOI4 1936 -> Apply Scenario -> 检查 Inspector/Legend”  
**Deliverable Type:** 只读型、指导性 QA 审计文档，不修改代码、不重建场景资产、不修复 UI  

## Evidence Index

- 浏览器 smoke 报告: [ai-browser-mcp-smoketest.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/reports/generated/browser/ai-browser-mcp-smoketest.md)
- 剧本应用后截图: [hoi4_scenario_applied.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/output/playwright/hoi4_scenario_applied.png)
- 浏览器巡检截图: [route-home-quick-20260303-193718.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/.mcp-artifacts/screenshots/route-home-quick-20260303-193718.png)
- 浏览器巡检截图: [section-left_sidebar-quick-20260303-193718.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/.mcp-artifacts/screenshots/section-left_sidebar-quick-20260303-193718.png)
- 浏览器巡检截图: [section-right_sidebar-quick-20260303-193718.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/.mcp-artifacts/screenshots/section-right_sidebar-quick-20260303-193718.png)
- 手工重放 DOM 快照: [page-2026-03-04T00-43-33-113Z.yml](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/page-2026-03-04T00-43-33-113Z.yml)
- 手工重放 DOM 快照: [page-2026-03-04T00-44-58-778Z.yml](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/page-2026-03-04T00-44-58-778Z.yml)
- 手工重放 Console: [console-2026-03-04T00-43-34-287Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/console-2026-03-04T00-43-34-287Z.log)
- 手工重放 Network: [network-2026-03-04T00-43-35-516Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/network-2026-03-04T00-43-35-516Z.log)
- 场景生成覆盖报告: [coverage_report.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/reports/generated/scenarios/hoi4_1936/coverage_report.md)
- 东亚边界专项报告: [029_east_asia_boundary_deviation_analysis.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa_reports/029_east_asia_boundary_deviation_analysis.md)

## Audit Inputs

### Builder / Data

- [parser.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/parser.py)
- [models.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/models.py)
- [crosswalk.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/crosswalk.py)
- [compiler.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/compiler.py)
- [audit.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/audit.py)
- [build_hoi4_scenario.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/build_hoi4_scenario.py)

### Runtime / UI

- [main.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/main.js)
- [scenario_manager.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js)
- [sidebar.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js)
- [file_manager.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/file_manager.js)
- [map_renderer.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/map_renderer.js)
- [state.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/state.js)

### Scenario Assets

- [index.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/index.json)
- [manifest.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/hoi4_1936/manifest.json)
- [countries.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/hoi4_1936/countries.json)
- [owners.by_feature.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/hoi4_1936/owners.by_feature.json)
- [cores.by_feature.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/hoi4_1936/cores.by_feature.json)
- [audit.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/hoi4_1936/audit.json)
- [hoi4_1936.manual.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenario-rules/hoi4_1936.manual.json)

## Executive Summary

当前 HOI4 1936 接入已经完成了从 HOI4 原始文件到前端可消费资产、再到运行时切换底图主权颜色的完整闭环。就“数据能否产出、页面能否加载、地图能否切换”这三个最低要求而言，答案是肯定的。

但从“剧本作为一个可长期扩展的产品功能”来看，当前状态仍然属于 **数据可用、展示可见、交互闭环不完整**。核心问题不在于剧本无法显示，而在于现有 UI 与编辑资产仍以 ISO-2 / 现代国家为中心建模，而 HOI4 scenario runtime 进入页面后切换成了 `GER / ENG / RAJ / PRC / MAN` 等 tag 体系。这个桥没有补齐，直接导致了 Inspector 分组退化、预设与层级失联、自动选中缺失、图例语义错误等一批“看起来接上了，但用起来断层”的问题。

结论上，本次接入已经具备继续演进的基础，但在进入第二个 scenario 或第二套 mod palette 之前，至少需要先完成以下 4 类补强：

1. 统一 scenario tag 与现有 UI lookup key 的桥接层。
2. 把 audit 资产从“构建报告”与“前端即时展示”两个用途上拆开。
3. 明确 scenario baseline 的导入导出契约。
4. 将 scenario 元数据从“能显示”提升到“能驱动 UI 和未来扩展”。

## What Works Today

- `data/scenarios/index.json`、`manifest.json`、`countries.json`、`owners.by_feature.json`、`cores.by_feature.json`、`audit.json` 已形成完整的前端消费资产集。
- 前端首次加载后，scenario registry 可异步填入 `HOI4 1936` 选项，运行时入口位于 [scenario_manager.js:44](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L44) 和 [scenario_manager.js:63](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L63)。
- 点击 `Apply Scenario` 后，地图能切换到 1936 剧本主权底色，左侧状态文案显示 `98 owners · 11192 features`。
- `manifest.summary` 与 `audit.summary` 中的关键计数能与 UI 对应上：
  - owner_count = 98
  - feature_count = 11192
  - approx_existing_geometry = 976
  - synthetic_owner_feature_count = 18
  - geometry_blocker_count = 0
- `audit.json` 中存在 13 个 `critical_regions`，且当前均为 `pass`。
- 运行时场景应用不会修改 topology 数据本体，而是接管 `state.sovereigntyByFeatureId`、`state.sovereignBaseColors`、`state.countryNames` 等运行时状态，这一点在架构上是正确的。
- `owners.by_feature.json` 提供完整 baseline，可直接支撑 `Reset To Scenario` 语义。
- 浏览器手工重放中，场景相关资源 HTTP 均返回 `200 OK`，未出现 scenario asset load failure。
- App route 的运行时 console 噪音只有 `favicon.ico` 404。Quick smoke 报告里出现的 `$(...).ready is not a function` 来自 `/data/ne_10m_admin_1_states_provinces.README.html` 第三方页面，不属于首页地图应用本身。

## Data Pipeline Audit

### Builder Flow

当前 HOI4 1936 builder 的主链路是：

`HOI4 source root`  
-> [parser.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/parser.py)  
-> [crosswalk.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/crosswalk.py)  
-> [compiler.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/compiler.py)  
-> `data/scenarios/hoi4_1936/*`  
-> [audit.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/audit.py) coverage report

入口命令在 [build_hoi4_scenario.py](/mnt/c/Users/raede/Desktop/dev/mapcreator/tools/build_hoi4_scenario.py)。

### Asset Contract

| Asset | Current Role | Frontend Consumer | Comment |
|---|---|---|---|
| `index.json` | registry | `scenario_manager.js` | 只负责列出 scenario 与 manifest_url |
| `manifest.json` | 轻量入口 + summary | `scenario_manager.js` | 结构清晰，已经带有 summary |
| `countries.json` | owner-level registry | `scenario_manager.js` / `sidebar.js` | 驱动名称、颜色、meta、feature_count |
| `owners.by_feature.json` | feature -> owner baseline | `scenario_manager.js` | 是 reset 的关键资产 |
| `cores.by_feature.json` | feature -> core tags | `scenario_manager.js` | 当前 UI 基本未消费 |
| `audit.json` | 深度构建审计与 region checks | `scenario_manager.js` | 目前前端只读极少部分 |

### Current Strengths

- 解析、交叉映射、编译、报告四层职责基本分离，没有把 scenario 逻辑硬塞进 `init_map_data.py` 主流程。
- `countries / owners / cores / audit / manifest` 的职责边界清楚，便于单独观察某一层出错。
- `ScenarioCountryRecord` 已经带出 `display_name / color_hex / feature_count / quality / base_iso2 / continent / subregion / scenario_only / synthetic_owner`，比只输出 `owner -> color` 丰富得多。
- `audit.json` 保留了 `critical_regions` 与 `region_checks`，为后续历史正确性专项提供了制度化入口。

### Current Limitations

- `country registry` 仍然是面向“单一 tag 元数据”的结构，不足以表达一个 owner 由多条 rule 共同生成的事实。
- `base_iso2` 同时承担了“来源溯源”和“UI lookup fallback”的潜在职责，但这两个职责并不稳定地一致。
- `cores.by_feature.json` 已产出，但当前前端没有形成与 core 相关的可见 UI 或交互语义，属于前后端 contract 未闭环。

## Runtime Load Audit

### Current Runtime Sequence

1. [main.js](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/main.js) 启动时先加载 topology、palette、hierarchy、locales、runtime political topology。
2. `initScenarioManager()` 在首屏渲染后异步调用 registry 加载逻辑，初始状态可见 `Scenario = None`，稍后才出现 `HOI4 1936`。
3. 选择 scenario 后，`loadScenarioBundle()` 按 `manifest_url` 拉取 manifest，并并行拉取 `countries + owners + cores + audit`。代码位于 [scenario_manager.js:63](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L63) 到 [scenario_manager.js:95](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L95)。
4. `applyScenarioBundle()` 在应用前会强制促发 detail topology promotion，避免在 coarse-only 模式下把 scenario 绑定到低细节层。代码位于 [scenario_manager.js:185](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L185)。
5. 场景应用时，运行时状态被整体接管：
   - `activeScenarioId`
   - `activeScenarioManifest`
   - `scenarioCountriesByTag`
   - `scenarioFixedOwnerColors`
   - `scenarioAudit`
   - `scenarioBaselineOwnersByFeatureId`
   - `scenarioBaselineCoresByFeatureId`
   - `countryNames`
   - `sovereigntyByFeatureId`
   - `sovereignBaseColors`
   - `countryBaseColors`
   - `activeSovereignCode`
6. 随后触发：
   - `refreshColorState()`
   - `recomputeDynamicBordersNow()`
   - `syncCountryUi()`

### Runtime Strengths

- scenario state takeover 是显式的，不依赖隐式 side-effect。
- `scenarioBundleCacheById` 避免重复拉同一 scenario bundle。
- `clearActiveScenario()` 会恢复 canonical 模式，说明 scenario 模式是可进入、可退出的状态机，而不是单向替换。
- `formatScenarioStatusText()` 直接从 `manifest.summary` 取 `owner_count / feature_count`，这一点是合理的。代码位于 [scenario_manager.js:351](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L351)。

### Runtime Weak Spots

- `loadScenarioBundle()` 对 `audit.json` 采用 eager load，但首页场景卡片只用到极少数字段。
- `applyScenarioBundle()` 硬编码 palette source，没有消费 manifest 的 `palette_id`。
- `activeSovereignCode` 被同步了，但 Inspector selection 没有同步，导致“左侧已知当前主权，右侧仍空态”的割裂。

## UI / Interaction Audit

### Left Sidebar: Scenario Card

Scenario 卡片当前具备最小必需功能：

- 选择 scenario
- Apply
- Reset To Scenario
- Clear Scenario
- 状态摘要
- audit hint

但层级上仍偏弱。首屏最显眼的仍是按钮，而不是“当前 scenario 处于什么状态”。在 scenario 已应用时，`Apply Scenario` 仍保留为主要 CTA，容易和 `Reset To Scenario` 产生语义重叠。

### Center Map: Visual Feedback

应用 scenario 后，地图能正确切到 HOI4 1936 主权底色，这一点在 [hoi4_scenario_applied.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/output/playwright/hoi4_scenario_applied.png) 中已明确可见。颜色替换不是局部 patch，而是全球范围切换，说明 `owners.by_feature.json` 的消费是完整的。

但同一时刻，地图左下 legend 自动出现 `Category 1..15`，它在视觉上像一个成功生成的 legend，实际上却没有提供任何 scenario 语义。这会误导用户，以为 legend 已经表达了 1936 阵营信息。

### Right Sidebar: Country Inspector

这是当前剧本模式最明显的断层区域。

- 剧本应用后，Country Inspector 首屏退化为 `Other (98)`，丢失原有的洲/分区组织能力。
- 搜索 `Germany` 并进入明细后，UI 能显示 `Base ISO: DE`、`manual_reviewed`、`521 features`，说明 scenario metadata 已经被成功送达 UI。
- 但同一个明细区块下又出现 `No country groups / No country presets`，表明 scenario tag 与现有 hierarchy/preset 体系没有桥接。

### Dock / Legend / Active Sovereign

- 左侧 `Active Sovereign = Germany (GER)` 可以证明 default_country 已被 scenario 应用。
- 但右侧没有自动跳到 `Germany`，意味着“当前主权”与“当前 Inspector 选中项”是两套孤立状态。
- 这在 scenario 模式尤其显眼，因为剧本应用本身就是一次全局态切换，用户合理预期是 UI 会一起聚焦到当前 active owner。

## Positive Findings

- 资产拆分清楚，`manifest / countries / owners / cores / audit` 的边界明确。
- 运行时场景接管是显式状态切换，没有偷偷修改 topology。
- `owners.by_feature.json` baseline 结构天然支持 reset。
- `critical_regions` 与 `region_checks` 已形成制度化输出，而不是只靠人工比对截图。
- 浏览器手工重放中，scenario 所需静态资源与 JSON 资源全部 `200 OK`，链路可重复。
- 东亚正确性问题已经有单独的深挖文档 [029_east_asia_boundary_deviation_analysis.md](/mnt/c/Users/raede/Desktop/dev/mapcreator/qa_reports/029_east_asia_boundary_deviation_analysis.md)，说明“视觉/UI 审计”和“历史边界正确性审计”已经可以拆题处理。

## Findings

### P1-1 Inspector 分组在剧本模式下退化成 `Other (98)`

**Symptom**  
应用 `HOI4 1936` 后，右侧 Country Inspector 失去原有 continent/subregion 分组，只剩一个 `Other (98)` 入口。

**Evidence**

- Console: app route 未出现 scenario load failure；手工重放只有 favicon 404，见 [console-2026-03-04T00-43-34-287Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/console-2026-03-04T00-43-34-287Z.log)
- Network: scenario 相关 JSON 资源全部 `200 OK`，见 [network-2026-03-04T00-43-35-516Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/network-2026-03-04T00-43-35-516Z.log)
- Screenshot: [hoi4_scenario_applied.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/output/playwright/hoi4_scenario_applied.png)
- Reproduction:
  1. 打开首页并等待 `HOI4 1936` 出现在 Scenario dropdown。
  2. 选择 `HOI4 1936` 并点击 `Apply Scenario`。
  3. 观察右侧 Country Inspector，首屏只显示 `Other (98)`。
- Minimal Patch Direction:
  - 为 scenario mode 引入统一的 `uiGroupingCode = base_iso2 || tag`
  - continent/subregion 分组不要再直接用 `entry.code`
- Code:
  - 分组逻辑: [sidebar.js:310](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js#L310)
  - 分组 lookup: [sidebar.js:325](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js#L325)

**Root Cause**  
`buildCountryColorTree()` 仍调用 `getCountryGroupingMeta(entry.code)`。scenario mode 下 `entry.code` 是 `GER / ENG / RAJ / PRC / MAN` 这类 HOI4 owner tag，而 `countryGroupMetaByCode` 使用的是现代国家 ISO-2。lookup miss 后全部回落到 `continent_other`。

**User Impact**  
一旦进入 scenario mode，Inspector 的信息架构几乎失效。98 个国家被压扁进单一分组，搜索成本和浏览成本显著上升，也削弱了 scenario metadata 已经具备的 continent/subregion 信息价值。

**Follow-up Direction**  
把 scenario UI 统一建立在一个稳定桥接键上，而不是直接把 tag 当作一切 lookup 的 key。这个桥接键应当被复用到分组、预设、层级、搜索排序和默认展开逻辑。

### P1-2 Scenario 国家缺失 groups / presets

**Symptom**  
在剧本模式中搜索并选中 `Germany (GER)` 后，Inspector 明细能显示 `Base ISO: DE`，但下方仍显示 `No country groups / No country presets`。

**Evidence**

- Console: app route 无 scenario load failure；仅有 favicon 404，见 [console-2026-03-04T00-43-34-287Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/console-2026-03-04T00-43-34-287Z.log)
- Network: `countries.json`、`hierarchy.json`、`hoi4_1936` scenario bundle 全部 `200 OK`，见 [network-2026-03-04T00-43-35-516Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/network-2026-03-04T00-43-35-516Z.log)
- Screenshot: [hoi4_scenario_applied.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/output/playwright/hoi4_scenario_applied.png)
- Reproduction:
  1. 应用 `HOI4 1936`。
  2. 在右侧搜索框输入 `Germany`。
  3. 点击 `Germany (GER)`。
  4. 观察 Inspector 明细：`Base ISO: DE` 存在，但 groups/presets 均为空。
- Minimal Patch Direction:
  - 新增 scenario-aware lookup key：
    - `inspectorDataCode`
    - `groupLookupCode`
    - `presetLookupCode`
  - 优先级使用 `base_iso2`，没有时再 fallback 到 tag。
- Code:
  - state 组装: [sidebar.js:763](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js#L763)
  - preset lookup: [sidebar.js:773](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js#L773)
  - group / preset 渲染: [sidebar.js:979](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js#L979)
  - hierarchy lookup helper: [sidebar.js:247](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js#L247)

**Root Cause**  
当前 Inspector 明细构造里：

- `presets: state.presetsState[entry.code]`
- `hierarchyGroups: getHierarchyGroupsForCode(entry.code)`

这里的 `entry.code` 是 HOI4 tag，不是 `DE / GB / CN` 这类现有编辑资产的主键。结果是 scenario metadata 已经知道 `GER` 对应 `base_iso2 = DE`，但 UI 没有使用这层桥接。

**User Impact**  
剧本模式等于切断了现有“国家 -> 分组 -> 预设 -> 批量着色”工作流。用户虽然能看到 scenario country，但不能复用已存在的编辑资产，这会显著降低剧本模式的实用价值。

**Follow-up Direction**  
需要把“显示用 code”和“lookup 用 code”明确区分，否则后续所有 scenario-only owner 都会持续出现同类断层。

### P1-3 运行时忽略 manifest.palette_id，硬编码切到 `hoi4_vanilla`

**Symptom**  
Scenario apply 过程中，palette source 始终被强制切到 `hoi4_vanilla`，而不是消费 manifest 声明的 `palette_id`。

**Evidence**

- Console: 未出现 palette load failure。
- Network: `manifest.json` 已成功返回，并包含 `palette_id = hoi4_vanilla`。
- Screenshot: 当前只有一个场景，因此表面上看不出错误；该问题属于扩展性阻断。
- Reproduction:
  1. 阅读当前 `manifest.json`。
  2. 查看 scenario apply 代码。
  3. 对比两者，发现 runtime 未使用 manifest 字段。
- Minimal Patch Direction:
  - `applyScenarioBundle()` 改为优先读取 `bundle.manifest.palette_id`
  - 缺省时再 fallback 到 `hoi4_vanilla`
- Code:
  - 硬编码位置: [scenario_manager.js:197](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L197)
  - manifest palette_id: [manifest.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/hoi4_1936/manifest.json)

**Root Cause**  
`applyScenarioBundle()` 中直接调用：

```js
await setActivePaletteSource("hoi4_vanilla", ...)
```

而不是读取 scenario manifest 的 `palette_id`。这在只有一个 vanilla 场景时恰好不出错，但它把 scenario 扩展能力提前锁死了。

**User Impact**  
当前影响不显性，但一旦加入第二个 scenario 或基于 mod palette 的 scenario，runtime 会出现“manifest 声明一套 palette，UI 实际套另一套”的结构性错配。

**Follow-up Direction**  
场景应用必须由 manifest 驱动，而不是 runtime 硬编码。否则 scenario asset contract 只是“看起来存在”，不是“真正被执行”。

### P1-4 `audit.json` 过重且前端 eager load，不符合 UI 使用量级

**Symptom**  
`loadScenarioBundle()` 会在 apply 之前并行拉取完整 `audit.json`，但首页 UI 只展示 `Approximate / Synthetic / Blockers` 三个数字。

**Evidence**

- Console: scenario apply 未因大文件失败，但无错误不代表没有不必要成本。
- Network: `audit.json` 在 apply 流程中被立即请求，见 [network-2026-03-04T00-43-35-516Z.log](/mnt/c/Users/raede/Desktop/dev/mapcreator/.playwright-cli/network-2026-03-04T00-43-35-516Z.log)
- Screenshot: 左侧 Scenario 卡片只展示三段 summary 文案，见 [hoi4_scenario_applied.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/output/playwright/hoi4_scenario_applied.png)
- Reproduction:
  1. 应用 `HOI4 1936`。
  2. 检查 network log。
  3. 发现 `audit.json` 与 `countries / owners / cores` 同批加载。
- Minimal Patch Direction:
  - 优先使用 `manifest.summary`
  - 将 `audit.json` 改为 lazy load
  - 或拆为 `audit.summary.json` 与 `audit.full.json`
- Size:
  - `audit.json` = 2,652,272 bytes
  - `owners.by_feature.json` = 391,183 bytes
  - `cores.by_feature.json` = 547,870 bytes
- Code:
  - 并行加载: [scenario_manager.js:79](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L79)
  - status text 读取 manifest.summary: [scenario_manager.js:351](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L351)

**Root Cause**  
前端 UI 实际只需要一个轻量 summary，但 runtime 在 apply 之前仍 eager 拉取完整构建审计。更关键的是，`manifest.summary` 已经包含大部分左侧 UI 所需计数，因此当前做法并非“没有 summary 只能拉 full audit”，而是“已有轻量 summary 却仍然拉 full audit”。

**User Impact**  
这会直接抬高 scenario 首次应用时的 I/O 体积，也把构建期深度报告和运行时轻量展示耦合在一起。当前只有一个 scenario 时问题尚可接受，但放大到多场景后会成为稳定的性能负担。

**Follow-up Direction**  
应把 `audit.json` 从“首页场景卡片依赖”降级成“深度诊断页依赖”。如果未来要在 UI 里展示更多历史正确性信息，再单独设计 drill-down，而不是默认预取整份审计。

### P1-5 剧本应用后未自动选中 Active Sovereign，用户状态感弱

**Symptom**  
应用剧本后左侧显示 `Active Sovereign = Germany (GER)`，但右侧 Inspector 仍停留在空态，需要用户手动搜索 Germany 才能进入明细。

**Evidence**

- Console: 无场景载入报错。
- Network: scenario 资源全部 `200 OK`。
- Screenshot: [hoi4_scenario_applied.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/output/playwright/hoi4_scenario_applied.png)
- Reproduction:
  1. 应用 `HOI4 1936`。
  2. 观察左侧 `Active Sovereign = Germany (GER)`。
  3. 观察右侧仍显示 `Select a country to edit` 空态。
- Minimal Patch Direction:
  - `applyScenarioBundle()` 完成后，同步 `selectedInspectorCountryCode = activeSovereignCode`
  - 自动展开对应 continent/subregion
- Code:
  - 设置 active sovereign: [scenario_manager.js:228](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L228)
  - Inspector 选中逻辑: [sidebar.js:814](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/ui/sidebar.js#L814)

**Root Cause**  
runtime 在 scenario apply 时只更新了 `state.activeSovereignCode`，没有同步 Inspector 相关状态，如 `selectedInspectorCountryCode`、`inspectorHighlightCountryCode`、`expandedInspectorContinents`。

**User Impact**  
用户明明刚完成一次全局态切换，页面却不给出相应的聚焦结果。场景卡片和 Inspector 之间的断层会让用户怀疑是否真正“进入了剧本模式”。

**Follow-up Direction**  
scenario apply 完成后，页面应自动把“当前 default_country/active owner”提升为右侧的当前上下文，而不是等待用户二次搜索。

### P1-6 剧本上色后地图图例出现 `Category 1..15`，但不具备场景语义

**Symptom**  
剧本应用后地图左下 legend 自动出现，但文案是 `Category 1..15`，无法表达任何国家、阵营或 owner 语义。

**Evidence**

- Console: 无 legend runtime error。
- Network: 不涉及额外资源失败。
- Screenshot: [hoi4_scenario_applied.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/output/playwright/hoi4_scenario_applied.png)
- Reproduction:
  1. 打开首页。
  2. 应用 `HOI4 1936`。
  3. 观察地图左下 legend，标签自动变成 `Category N`。
- Minimal Patch Direction:
  - 剧本模式默认隐藏 legend，除非用户显式开启
  - 或将 owner tag / display_name 自动映射为 legend label
  - 或仅在用户进行后续自定义编辑后再展示 legend
- Code:
  - legend 默认 fallback 文案: [map_renderer.js:4199](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/map_renderer.js#L4199)
  - `Category ${index + 1}` fallback: [map_renderer.js:4231](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/map_renderer.js#L4231)

**Root Cause**  
当前 legend 是颜色驱动型组件，不知道这些颜色在 scenario mode 下代表什么 owner。没有 label map 时，渲染器自动回落到 `Category N`。这对自由涂色模式是可接受的兜底，但对 scenario baseline 来说是错误语义。

**User Impact**  
用户会被一个“看起来可用但实际无意义”的 legend 误导。它不仅没有帮助理解剧本状态，反而在视觉上占据地图空间并输出错误语义。

**Follow-up Direction**  
scenario baseline 应被视为一种“系统底图状态”，不是“用户刚刚创建了一组可命名分类”。legend 是否显示，应该由 mode 决定，而不是仅由颜色存在与否决定。

### P2-1 Scenario UI 信息层级不合理

**Symptom**  
Scenario 卡片里按钮比状态摘要更突出；scenario 已应用后 `Apply Scenario` 仍然保持主要操作感，与 `Reset To Scenario` 语义重叠。

**Evidence**

- Console: 无相关错误。
- Network: 无相关失败。
- Screenshot: [hoi4_scenario_applied.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/output/playwright/hoi4_scenario_applied.png)
- Reproduction:
  1. 应用 `HOI4 1936`。
  2. 观察左侧 Scenario 卡片。
  3. 状态摘要位于按钮后方，`Apply Scenario` 仍保留为首个动作。
- Minimal Patch Direction:
  - 将当前状态摘要上移
  - 重新定义按钮语义：
    - Apply
    - Reset Changes To Baseline
    - Exit Scenario
- Code:
  - 控件渲染: [scenario_manager.js:367](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L367)

**Root Cause**  
当前 Scenario 卡片仍沿用“选择 + 应用”的初始态布局，没有在“scenario 已激活”后切换为“状态 + 维护动作”的布局。

**User Impact**  
功能能用，但状态认知成本偏高。用户很难一眼分辨“当前是否已处于剧本模式”、“Apply 是否会重载”、“Reset 与 Clear 分别意味着什么”。

**Follow-up Direction**  
Scenario 卡片应当具备双态布局：未激活时强调选择与进入，激活后强调当前状态与维护动作。

### P2-2 导入导出只保存 baselineHash/version，但未做回读校验

**Symptom**  
project export 会保存 `scenario.id / version / baselineHash`，但 import 阶段没有对这些值和当前 manifest 做差异校验。

**Evidence**

- Console: 未出现错误，但这类问题只有在资产变化后才显性暴露。
- Network: 与 import path 无关。
- Screenshot: 不适用。
- Reproduction:
  1. 检查 export payload。
  2. 检查 import parse 逻辑。
  3. 发现字段被保留但没有被真正用于校验。
- Minimal Patch Direction:
  - import 时比对 `scenario.id + version + baselineHash`
  - 不一致时提示用户并要求确认迁移
- Code:
  - export 写入: [file_manager.js:40](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/file_manager.js#L40)
  - import 读取: [file_manager.js:140](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/file_manager.js#L140)

**Root Cause**  
当前 `project.scenario` 的 schema 已具备校验所需字段，但 import 逻辑只做了解析和透传，没有与当前 scenario asset 做任何兼容性判断。

**User Impact**  
一旦 `owners.by_feature.json` 或 baseline 资产重建，旧项目可能被静默套到新 baseline 上。用户看到的是“项目成功导入”，实际语义却可能已经漂移。

**Follow-up Direction**  
baselineHash 不应只作为被动记录字段，而应成为 import 安全检查的一部分。

### P2-3 编译阶段对同一 owner 只保留最后一条 rule 元数据

**Symptom**  
编译 country registry 时，同一 owner 如果有多条 manual rule，只会保留最后一条 rule 作为国家层 meta 来源。

**Evidence**

- Console: 不适用。
- Network: 不适用。
- Screenshot: 不适用。
- Reproduction:
  1. 阅读 compiler 编译逻辑。
  2. 观察 `rule_lookup_by_owner[rule.owner_tag] = rule`。
  3. 发现同一 owner 的多条 rule 会被最后一条覆盖。
- Minimal Patch Direction:
  - 按 owner 聚合 rule 列表
  - 明确“主 rule”选择规则，或保留聚合后的多来源摘要
- Code:
  - 覆盖逻辑: [compiler.py:1052](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/compiler.py#L1052)
  - registry 消费 rule: [crosswalk.py:252](/mnt/c/Users/raede/Desktop/dev/mapcreator/scenario_builder/hoi4/crosswalk.py#L252)

**Root Cause**  
`rule_lookup_by_owner` 采用单值字典模型，而不是 owner -> rules[]。这意味着 display override、notes、source_type、historical_fidelity 等国家级说明天然只能继承最后一次写入。

**User Impact**  
当前多数 owner 还未因为多 rule metadata 冲突而出错，但这是 builder contract 的结构性上限。随着更多历史修正进入 manual rules，这个问题会越来越常见。

**Follow-up Direction**  
把 “feature assignment” 和 “country-level narrative/meta synthesis” 分成两步。前者允许多 rule 叠加，后者显式决定如何生成国家说明。

### P2-4 `base_iso2` 语义不稳定，既像溯源字段又像 UI 桥接键

**Symptom**  
当前 `base_iso2` 同时被用于描述来源，又被 UI 暗中视作 lookup fallback 候选。但这两个语义并不总是一致。

**Evidence**

- Console: 不适用。
- Network: 不适用。
- Screenshot: 不直接可见，但可由 `Germany` 明细中的 `Base ISO: DE` 与 scenario-only owner 的配置对比看出。
- Reproduction:
  1. 查看 [countries.json](/mnt/c/Users/raede/Desktop/dev/mapcreator/data/scenarios/hoi4_1936/countries.json)。
  2. 对比 `GER` 与 `AST`：
     - `GER`: `base_iso2 = DE`
     - `AST`: `display_name = Australia`，但 `base_iso2 = PG`
  3. 发现 `base_iso2` 有时像 UI 归属，有时更像生成来源。
- Minimal Patch Direction:
  - 将“溯源来源字段”和“UI lookup 桥接字段”拆开
  - 建议未来使用：
    - `source_iso2`
    - `ui_base_code` 或 `lookup_iso2`
- Data Example:
  - `CN` 同时映射出 15 个 HOI4 owner tag
  - `AST` 展示名为 Australia，但 `base_iso2 = PG`

**Root Cause**  
当前 `base_iso2` 是 crosswalk/builder 折中产物，能提供有价值的来源线索，但并没有被正式定义为“可稳定驱动 UI lookup 的唯一键”。

**User Impact**  
只要 UI 持续把 `base_iso2` 当“看起来能用”的万能桥接键，就会在 scenario-only owner、殖民地、依附国、近似映射国家上不断碰到边界条件。

**Follow-up Direction**  
builder 层应该明确区分：

- 这个 owner 的几何和 metadata 主要从哪里来
- UI 在 scenario mode 下应该把它接到哪个已有编辑资产上

### P3-1 Scenario registry 首帧为空，缺少显式 loading state

**Symptom**  
首页初次打开时，Scenario dropdown 先只显示 `None`，稍后异步填入 `HOI4 1936`。这不是功能错误，但会让首次体验看起来像“没有剧本”。

**Evidence**

- Console: 无错误。
- Network: registry 请求成功。
- Screenshot: 首轮 quick smoke 首页截图 [route-home-quick-20260303-193718.png](/mnt/c/Users/raede/Desktop/dev/mapcreator/.mcp-artifacts/screenshots/route-home-quick-20260303-193718.png)
- Reproduction:
  1. 冷启动首页。
  2. 立即查看 Scenario dropdown，仅见 `None`。
  3. 等待 registry 加载完成，`HOI4 1936` 才出现。
- Minimal Patch Direction:
  - 显式显示 `Loading scenarios...`
  - 或在初次渲染前预置 skeleton / disabled select
- Code:
  - registry async init: [scenario_manager.js:44](/mnt/c/Users/raede/Desktop/dev/mapcreator/js/core/scenario_manager.js#L44)

**Root Cause**  
Scenario registry 是懒加载且不阻塞初始 UI 渲染，因此 first paint 时 dropdown 仍处于空壳状态。

**User Impact**  
优先级低，但会直接影响首次认知，尤其是在 demo 或录屏环境中看起来像“剧本没接上”。

**Follow-up Direction**  
这类问题适合作为 UI polish 收尾项，不应优先于 P1/P2 的 contract 问题。

## Important Changes Or Additions To Public APIs / Interfaces / Types

本次任务本身没有修改任何公共 API、类型或资产契约。  
**Actual changes in this QA task: None.**

但后续实现应明确收敛到以下接口级目标：

- `scenario country view model` 新增稳定桥接键，建议命名：
  - `ui_base_code`
  - 或 `lookup_iso2`
- `manifest` 应成为首页 summary 的主来源，而不是让首页依赖完整 `audit.json`
- `audit` 建议拆分为：
  - `audit.summary.json`
  - `audit.full.json`
- `project.scenario` 应正式包含并验证：
  - `id`
  - `version`
  - `baselineHash`
- `country registry` 不应再依赖“owner -> single rule”模型，而应能表达多 rule 聚合

## Optimization Roadmap

### Immediate

1. 修复 scenario-aware lookup bridge
   - 先解决 Inspector 分组、groups、presets 三个问题
   - 这是用户感知最强、实现收益最高的一组
2. scenario apply 后同步 Inspector 选中态
   - 让 `activeSovereignCode` 与右侧上下文对齐
3. 调整 scenario legend 语义
   - 至少先避免 baseline 场景显示 `Category N`
4. 让首页 summary 优先读取 `manifest.summary`
   - 取消 `audit.json` 对首页文案的硬依赖

### Short-term

1. 让 runtime 消费 `manifest.palette_id`
2. 调整 Scenario 卡片的信息层级与按钮语义
3. 为 project import 增加 baseline hash/version 校验
4. 评估 `cores.by_feature.json` 是否需要 UI 出口

### Structural

1. 拆分 `base_iso2` 语义
   - `source_iso2`
   - `ui_base_code`
2. 将 country registry 的 rule 元数据升级为聚合模型
3. 拆分 scenario audit 资产的轻量层与深度层
4. 为 future scenarios / mod scenarios 定义统一 manifest contract

## Test Cases And Scenarios

后续修复应至少重跑以下场景：

1. 冷启动页面，等待 scenario registry 异步填入 `HOI4 1936`
2. 选择 `HOI4 1936` 并点击 `Apply Scenario`
3. 确认左侧显示：
   - `98 owners`
   - `11192 features`
   - `Approximate: 976`
   - `Synthetic: 18`
   - `Blockers: 0`
4. 确认地图切换为剧本底色
5. 确认右侧首屏不再退化为 `Other (98)`
6. 搜索 `Germany`，打开 Germany 明细
7. 确认明细显示 `Base ISO: DE` 且可读到 groups/presets
8. 确认剧本 baseline 下 legend 不再显示 `Category 1..15`
9. 检查 console/network：
   - 允许 favicon 404 级别噪音
   - 不允许 scenario JSON load failure
10. 导出项目后，在 baseline 不变与 baseline 改变两种情况下分别导入，确认行为符合预期

## Acceptance Criteria For Follow-up

- 未读过代码的人能够在 10 分钟内理解 HOI4 1936 的数据流和 UI 接入方式
- 所有高优先级问题都能直接定位到实现文件
- 每个问题都有明确的最小修复方向，不留下实现决策空白
- 文档明确区分：
  - 当前 bug
  - 设计债
  - 扩展性风险
- 浏览器证据在引用时保持以下顺序：
  - Console
  - Network
  - Screenshot
  - Reproduction
  - Minimal Patch Direction
- 不重复东亚专项报告正文，只把它作为“已知正确性风险案例”

## Final Assessment

HOI4 1936 剧本功能现在已经不是“能不能接上”的问题，而是“接上之后，现有 UI 和编辑资产有没有一起完成身份切换”的问题。当前答案是否定的。

数据层已经明显走在 UI 契约层前面。builder 已经产出了比 UI 更丰富的 scenario metadata，前端也已经能把地图切换到正确的 baseline；真正缺失的是一层稳定、明确、可复用的 scenario bridge。只要这层桥接完成，现有 Inspector、预设、层级、导入导出和 future scenario 扩展都可以顺着同一条 contract 收敛。反之，如果继续在 tag 与 ISO-2 之间做临时兼容，后续每加一个 scenario 都会重复制造同类断层。
