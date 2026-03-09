# QA-072 HOI4 Runtime Ocean Mismatch And RU Far East Fill Fix

**日期**: 2026-03-08  
**状态**: 已实现；`HOI4 1936` / `HOI4 1939` 已完成 live browser runtime 与截图回归；`TNO 1962` 完成 smoke apply 回归  
**范围**: `HOI4 1936` / `HOI4 1939` 的 runtime political 海洋错配与俄远东细化区缺色  
**约束**: runtime / renderer-only；不改 `data/scenarios/hoi4_1936/*`；不改 `data/scenarios/hoi4_1939/*`

---

## 0) 结论摘要

这次问题最终分成两段修复：

1. 海洋错色：
   - 根因仍是 runtime political merged background 出现异常全局面。
   - 继续保留 [map_renderer.js](../js/core/map_renderer.js) 里的 HOI4 专用 suspicious merge guard。
2. 俄远东缺色：
   - 之前放在 [map_renderer.js](../js/core/map_renderer.js) 的 display fallback 不够，因为缺失 owner 的 `RU_RAY_*` 细化块会先在 `ensureSovereigntyState()` 里被 seed 成 live `RU`。
   - 本次把修复挪到 [scenario_manager.js](../js/core/scenario_manager.js) 的 scenario owner 初始化阶段，让这些块直接以 runtime `SOV` 进入 `state.scenarioBaselineOwnersByFeatureId` 和 `state.sovereigntyByFeatureId`。

live browser 验证结果：

- `hoi4_1936` / `hoi4_1939` 的 sample `RU_RAY_*` feature 现在都是
  - `baselineOwner = SOV`
  - `liveOwner = SOV`
  - `color = #7d0d18`
- 两个剧本里 `sovBackfillCount = 157`
- 两个剧本里 `unresolvedRuColorCount = 0`
- 之前的 console warning `owner=RU fill=#f0f0f0 group=157` 已消失

---

## 1) Evidence Order

### 1.1 Console

新 console 证据：

- [tmp_pw/qa072/hoi4_postfix_console_warning.txt](../tmp_pw/qa072/hoi4_postfix_console_warning.txt)
- [tmp_pw/qa072/hoi4_postfix_console_error.txt](../tmp_pw/qa072/hoi4_postfix_console_error.txt)
- [console-2026-03-09T02-05-13-393Z.log](../.playwright-cli/console-2026-03-09T02-05-13-393Z.log)
- [console-2026-03-09T02-05-13-410Z.log](../.playwright-cli/console-2026-03-09T02-05-13-410Z.log)

结论：

- 仍有一个非根因错误：
  - `favicon.ico` `404`
- 仍有预期内 warning：
  - `hoi4_1936` 的 `SOV` suspicious merge
  - `hoi4_1939` 的 `SOV` / `HUN` / `SLO` suspicious merge
- 已不再出现：
  - `owner=RU fill=#f0f0f0 group=157`

这说明海洋 guard 继续生效，同时 Far East 的 `RU` 未着色组已经不再走旧路径。

### 1.2 Network

新 network 证据：

- [tmp_pw/qa072/hoi4_postfix_network.txt](../tmp_pw/qa072/hoi4_postfix_network.txt)
- [network-2026-03-09T02-05-13-400Z.log](../.playwright-cli/network-2026-03-09T02-05-13-400Z.log)

结论：

- `hoi4_1936` / `hoi4_1939` 的 `manifest / countries / owners / controllers / cores` 均为 `200 OK`
- 没有新的 scenario bundle 4xx/5xx
- 页面侧唯一 4xx 仍是 `favicon.ico`

### 1.3 Screenshots

新的修复后截图：

- `HOI4 1936` 世界视图：
  - [hoi4_1936_world_after_far_east_fix.png](../tmp_pw/qa072/hoi4_1936_world_after_far_east_fix.png)
- `HOI4 1936` 远东局部：
  - [hoi4_1936_far_east_after_backfill.png](../tmp_pw/qa072/hoi4_1936_far_east_after_backfill.png)
- `HOI4 1939` 远东局部：
  - [hoi4_1939_far_east_after_backfill.png](../tmp_pw/qa072/hoi4_1939_far_east_after_backfill.png)

修复前参考图：

- [hoi4_1936_far_east_check.png](../tmp_pw/qa072/hoi4_1936_far_east_check.png)
- [hoi4_1939_far_east_check.png](../tmp_pw/qa072/hoi4_1939_far_east_check.png)
- [hoi4_1936-overview.png](../tmp_pw/scenario_ocean_diag/hoi4_1936-overview.png)
- [hoi4_1939-overview.png](../tmp_pw/scenario_ocean_diag/hoi4_1939-overview.png)

### 1.4 Reproduction

1. 打开 `http://127.0.0.1:8000/?render_profile=full`
2. 加载 `HOI4 1936`
3. 移动到远东约 `135E, 47N`
4. 修复前可见 `RU_RAY_*` 细化块为米色/缺色
5. 加载 `HOI4 1939`
6. 同一区域重复观察
7. 修复后，两剧本里的同一批碎片都应显示为 `SOV` 红色

### 1.5 Minimal Patch Direction

- 保留 [map_renderer.js](../js/core/map_renderer.js) 的 HOI4 海洋 merge guard
- 把 `RU -> SOV` 修复从 display fallback 挪到 [scenario_manager.js](../js/core/scenario_manager.js) 的 runtime owner 初始化
- 删除 [map_renderer.js](../js/core/map_renderer.js) 里已经无效的 HOI4 display-only fallback

---

## 2) 根因分析

### 2.1 为什么之前的显示层回退没有生效

关键点不在 palette，而在 ownership 初始化顺序：

1. 场景 bundle 里这批 `RU_RAY_*` feature 没有显式 owner/controller
2. `applyScenarioBundle()` 把显式 owner 写进 `state.sovereigntyByFeatureId`
3. 随后 `ensureSovereigntyState()` 会对缺失 feature 用 canonical country 做 seed
4. 于是这些 feature 变成 live `RU`
5. 之前的 display fallback 只在“没有 explicit owner/controller”时触发
6. 由于 live owner 已经被 seed 成 `RU`，display fallback 永远不会再把它们转成 `SOV`

所以正确修复层级必须前移到 runtime owner 初始化，而不是继续堆在颜色解析上。

### 2.2 为什么海洋修复仍然单独保留

live console 仍显示以下 HOI4 merged group 会扩张成可疑全局面：

- `hoi4_1936`:
  - `SOV`
- `hoi4_1939`:
  - `SOV`
  - `HUN`
  - `SLO`

因此海洋 guard 仍然需要保留；它解决的是异常 merged background，不是 Far East owner 缺失。

---

## 3) 实现内容

### 3.1 `scenario_manager.js`

新增 HOI4 专用 helper：

- `canonicalScenarioCountryCode()`
- `extractScenarioCountryCodeFromId()`
- `getScenarioRuntimeGeometryCountryCode()`
- `shouldApplyHoi4FarEastSovietBackfill()`
- `hasExplicitScenarioAssignment()`
- `buildHoi4FarEastSovietOwnerBackfill()`

具体行为：

- 仅在 `hoi4_1936` / `hoi4_1939` 启用
- 遍历 runtime political geometries
- 只处理 canonical country 为 `RU` 的 feature
- 只处理同时缺失 explicit owner 和 explicit controller 的 feature
- 这些 feature 的 baseline owner / live owner 统一回填为 `SOV`
- 不改 `controllers`
- 不改显式 `TAN` / 显式 `SOV` / 任何已有 owner/controller

落点：

- [scenario_manager.js](../js/core/scenario_manager.js)

### 3.2 `map_renderer.js`

保留：

- HOI4 专用 suspicious merged background guard

移除：

- 已无效的 `getScenarioImplicitDisplayOwnerCode()` 路径

现在 owner 颜色解析重新走正常路径：

- `state.sovereigntyByFeatureId -> getDisplayOwnerCode() -> state.sovereignBaseColors`

落点：

- [map_renderer.js](../js/core/map_renderer.js)

---

## 4) 验证结果

### 4.1 Live Browser Runtime Check

证据：

- [hoi4_far_east_runtime_after_backfill.txt](../tmp_pw/qa072/hoi4_far_east_runtime_after_backfill.txt)
- [hoi4_far_east_runtime_after_backfill.json](../tmp_pw/qa072/hoi4_far_east_runtime_after_backfill.json)

结果：

- `hoi4_1936`
  - 5 个 sample `RU_RAY_*` 全部 `baselineOwner = SOV`
  - 5 个 sample 全部 `liveOwner = SOV`
  - 5 个 sample 全部 `color = #7d0d18`
  - `sovBackfillCount = 157`
  - `unresolvedRuColorCount = 0`
- `hoi4_1939`
  - 同上

### 4.2 Visual Regression

修复后 Far East 截图显示：

- `hoi4_1936` 的远东细化区已回到苏联红
- `hoi4_1939` 的远东细化区已回到苏联红

对照：

- 修复前 [hoi4_1936_far_east_check.png](../tmp_pw/qa072/hoi4_1936_far_east_check.png)
- 修复后 [hoi4_1936_far_east_after_backfill.png](../tmp_pw/qa072/hoi4_1936_far_east_after_backfill.png)
- 修复前 [hoi4_1939_far_east_check.png](../tmp_pw/qa072/hoi4_1939_far_east_check.png)
- 修复后 [hoi4_1939_far_east_after_backfill.png](../tmp_pw/qa072/hoi4_1939_far_east_after_backfill.png)

### 4.3 Ocean Regression

`1936` 世界视图证据：

- [hoi4_1936_world_after_far_east_fix.png](../tmp_pw/qa072/hoi4_1936_world_after_far_east_fix.png)

结合 console warning 可确认：

- 海洋 guard 仍然在工作
- `1936` 外海没有回退成 `RU` 或其他未着色全局面

### 4.4 TNO 1962 Smoke

证据：

- [tno_1962_smoke_after_far_east_fix.txt](../tmp_pw/qa072/tno_1962_smoke_after_far_east_fix.txt)
- [tno_1962_smoke_after_far_east_fix.json](../tmp_pw/qa072/tno_1962_smoke_after_far_east_fix.json)

本轮只做 smoke apply：

- `scenarioId = tno_1962`
- `runtimeFeatureCount = 12281`
- 场景可正常应用

说明：

- 这证明 HOI4 专用 owner backfill 没有把 `TNO 1962` 直接打崩
- 这不是一次完整的 seam 视觉回归；`QA-071` 的原始截图仍然是该问题的主证据

---

## 5) 变更范围

本次实际修改：

- [scenario_manager.js](../js/core/scenario_manager.js)
- [map_renderer.js](../js/core/map_renderer.js)

未修改：

- `data/scenarios/hoi4_1936/*`
- `data/scenarios/hoi4_1939/*`
- `data/scenarios/tno_1962/*`

---

## 6) 最终判断

本次第二阶段修复已经把 HOI4 Far East 问题修到正确层级：

- 不再依赖 display-only hack
- runtime owner 从 baseline 开始就是 `SOV`
- shell overlay / ownership / frontline / color resolution 都会看到同一份修正后的 owner 状态

对于用户报告的两个现象：

1. `1936` 海洋颜色错配：
   - 已由第一阶段 merge guard 修复，仍保持有效
2. `1936 / 1939` 俄远东细化区未重新上色：
   - 已由本阶段 runtime owner backfill 修复，并完成 live browser 验证
