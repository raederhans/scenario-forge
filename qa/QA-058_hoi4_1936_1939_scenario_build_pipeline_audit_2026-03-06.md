# QA-058 — HOI4 1936/1939 剧本构建管线代码审计

**日期**: 2026-03-06
**范围**: 两个剧本（hoi4_1936、hoi4_1939）的数据文件、Python 构建管线、JS 运行时加载逻辑、以及最新双击涂色简化
**审计方式**: 静态代码审计 — 数据 JSON 结构对比 + Python 构建管线全链路 + JS scenario_manager 运行时 + 最新 working tree diff
**基线版本**: `main` 分支 `0899714`（simplify double click）

---

## 0) 审计结论（Executive Summary）

整体架构设计良好：Python 构建管线从 HOI4 游戏文件编译出完整的 JSON bundle，JS 运行时仅负责加载和渲染，不含规则引擎。但审计发现 **3 处代码错配**、**3 处硬编码可维护性问题**、**4 处数据/代码冗余**，以及 **1 处双击逻辑简化的遗留清理项**。所有问题均不影响当前功能正确性，但影响长期可维护性和未来剧本扩展。

| 严重度 | 数量 | 说明 |
|--------|------|------|
| P1 代码错配 | 3 | 重复函数、版本不一致、cores 数据丢失 |
| P2 硬编码 | 3 | 场景特判、区域ID、白俄罗斯拓扑 |
| P3 冗余/清理 | 4 | audit 版本、delta 静默跳过、空 controller 文件、targets ID 前缀 |
| P4 已完成改进 | 1 | 双击涂色逻辑简化（已在 working tree 中完成） |

---

## 1) 架构概览

```
HOI4 游戏文件 (Steam)
        |
        v
  tools/build_hoi4_scenario.py        <-- CLI 入口
        |
        v
  scenario_builder/hoi4/
    parser.py       解析 HOI4 states/bookmarks/country_tags
    crosswalk.py    feature→owner 分配（4级优先链）
    compiler.py     编译 bundle（manifest/owners/controllers/cores/countries/audit）
    models.py       数据模型
    audit.py        源图集报告
        |
        v
  data/scenarios/hoi4_{1936,1939}/     <-- 预编译 JSON bundle
    manifest.json / owners.by_feature.json / controllers.by_feature.json
    cores.by_feature.json / countries.json / audit.json
        |
        v
  js/core/scenario_manager.js          <-- 运行时加载
  js/core/map_renderer.js              <-- 渲染 + 交互
```

**1939 使用增量架构**：构建时同时加载 `hoi4_1936.manual.json`（43 条基础规则）+ `hoi4_1939.manual.json`（14 条增量规则），合并后编译为独立的完整 bundle。运行时不感知增量关系，两个剧本地位等同。

---

## 2) 数据结构对比

### 2.1 核心数量对比

| 维度 | 1936 | 1939 | 差异原因 |
|------|------|------|----------|
| feature 数 | 11,326 | 11,326 | 相同拓扑 |
| 国家数 | 96 | 92 | 奥地利/捷克/埃塞/阿尔巴尼亚被吞并，新增 BOM/SLO |
| 手动规则 | 43 | 14（增量） | 1939 仅描述 1936→1939 变化 |
| 区域检查 | 13（全通过） | 0（已禁用） | 1939 构建时跳过 |
| 白俄混合特征 | 35 | 0 | 1939 清除 |

### 2.2 关键领土变化（1936→1939）

| 区域 | 1936 所有者 | 1939 所有者 | 规则 |
|------|-----------|-----------|------|
| 奥地利 AT001-AT035 | AUS | GER | 1939_germany_annexes_austria (P900) |
| 苏台德 CZ_ADM2_... | CZE | GER | germany_sudetenland_1939 (P901) |
| 波西米亚-摩拉维亚 | CZE | BOM (新) | bohemia_moravia_protectorate_1939 (P902) |
| 斯洛伐克 SK_ADM2_... | CZE | SLO (新) / HUN | 1939_slovakia_puppet_state (P903) |
| 扎奥尔齐 | CZE | POL | 1939_poland_zaolzie (P905) |
| 阿尔巴尼亚 AL011-AL035 | ALB | ITA | 1939_italy_albania (P910) |
| 埃塞俄比亚 ET001-ET010 | ETH | ITA | 1939_italy_ethiopia (P911) |
| 梅梅尔 LT023 | LIT | GER | 1939_germany_memel (P907) |
| 哈塔伊 SYR-134 | SYR | TUR | 1939_turkey_hatay (P912) |

---

## 3) P1 — 代码错配（建议修复）

### 3.1 重复的规则选择函数

**位置**:
- [crosswalk.py:90-113](scenario_builder/hoi4/crosswalk.py#L90-L113) — `_select_rule_feature_ids()` 用于 owner 分配
- [compiler.py:1046-1071](scenario_builder/hoi4/compiler.py#L1046-L1071) — `_select_rule_target_ids()` 用于 controller 分配

**差异**:
| 行为 | crosswalk 版本 | compiler 版本 |
|------|---------------|--------------|
| include_feature_ids 验证 | 仅检查 `if feature_id`（非空） | 额外检查 `feature_id in feature_by_id`（存在性） |
| 属性访问方式 | 直接 `rule.xxx` | 防御性 `getattr(rule, "xxx", []) or []` |
| 最终过滤 | `selected - excluded` | `{... if fid in feature_by_id and fid not in excluded}` |

**风险**: owner 规则可能匹配到不存在的 feature ID（crosswalk 不检查存在性），而 controller 规则会静默跳过。修改一个函数时另一个不会同步。

**建议**: 保留 compiler 版本的严格逻辑（带存在性检查），统一为 `crosswalk.py` 中的单一函数，compiler 导入使用。

### 3.2 手动规则 version 字段不一致

**位置**:
- `data/scenario-rules/hoi4_1936.manual.json` — `"version": 2`
- `data/scenario-rules/hoi4_1939.manual.json` — `"version": 1`
- [parser.py:387-417](scenario_builder/hoi4/parser.py#L387-L417) — `load_manual_rules()` 完全忽略 version 字段

**影响**: 当前无实际功能影响（version 未被读取），但违反数据契约一致性。如未来添加 version 校验会导致 1939 规则被拒绝。

**建议**: 将 1939 的 version 统一为 `2`；在 `load_manual_rules()` 中添加 `if payload.get("version", 0) < 2: warnings.warn(...)`.

### 3.3 cores.by_feature 未使用 HOI4 游戏的 core 数据

**位置**: [compiler.py:1187-1197](scenario_builder/hoi4/compiler.py#L1187-L1197)

```python
# 当前逻辑 — cores 只有 owner tag
"cores": {
    feature.feature_id: [assignments[feature.feature_id].owner_tag]
    for feature in runtime_features
    if feature.feature_id in assignments
},
```

**问题**: HOI4 state 文件中有丰富的 `add_core_of = TAG` 数据（如波兰对 Kresy 地区的 core 声称、法国对阿尔萨斯的 core），`parser.py:parse_states()` 已解析为 `StateRecord.core_tags`，但在编译时被完全丢弃，cores 仅填入 owner tag。

**影响**: `cores.by_feature.json` 中的 core 信息是不完整的——只反映"谁拥有"，不反映"谁声称"。如果前端未来需要展示 core 争议区域，数据不支持。

**建议**: 通过 province→feature 映射将 HOI4 state 的 core_tags 合并到 cores 输出中。需要在 crosswalk 流程中传递 province-to-feature 映射表。

---

## 4) P2 — 硬编码与可维护性（建议改进）

### 4.1 三处硬编码 `scenario_id == "hoi4_1936"` 判断

**位置**: [compiler.py:1328](scenario_builder/hoi4/compiler.py#L1328), [compiler.py:1353](scenario_builder/hoi4/compiler.py#L1353), [compiler.py:1434](scenario_builder/hoi4/compiler.py#L1434)

```python
enable_region_checks = bool(diagnostics.get("enable_region_checks", scenario_id == "hoi4_1936"))
enforce_scenario_extensions = bool(diagnostics.get("enforce_scenario_extensions", scenario_id == "hoi4_1936"))
enforce_region_checks = bool(diagnostics.get("enforce_region_checks", scenario_id == "hoi4_1936"))
```

**问题**: 这三个开关的 fallback 值通过场景 ID 字符串比较决定。添加第三个剧本（如 `hoi4_1944`）时，所有校验默认关闭，且不会有任何警告。

**建议**: 这些开关已在 1939 的 `state_delta_coverage` 中有 `enable_region_checks` 字段。将此模式推广为标准：所有剧本在 manual.json 顶层显式声明这些开关值，compiler 移除 `scenario_id == "hoi4_1936"` fallback，缺失时报错而非静默默认。

### 4.2 CRITICAL_REGION_IDS 硬编码

**位置**: [compiler.py:18-32](scenario_builder/hoi4/compiler.py#L18-L32)

```python
CRITICAL_REGION_IDS = [
    "europe_germany_poland_1936",
    "europe_east_prussia",
    # ... 13 个区域 ID
]
```

**问题**: 区域名称带 `_1936` 后缀（如 `europe_germany_poland_1936`），对 1939 不适用但仍会被评估（如果 enable_region_checks=True）。添加新剧本需修改 Python 源码而非配置文件。

**建议**: 移入各自 manual.json 的 `critical_region_ids` 顶层字段。

### 4.3 白俄罗斯拓扑验证完全硬编码

**位置**: [compiler.py:845-885](scenario_builder/hoi4/compiler.py#L845-L885)

feature 数量范围 `range(35, 38)` 和必须出现的 feature ID 全部写死在源码中。

**建议**: 移入配置文件或 manual.json 的 `topology_checks` 字段。

---

## 5) P3 — 数据冗余与代码清理

### 5.1 audit.json 版本不一致

- `audit.py:build_report_json()` → `"version": 2`
- `compiler.py:1397` 审计 payload → `"version": 1`
- `check_hoi4_scenario_bundle.py` 不校验 audit 版本

**建议**: 统一为 `version: 2`。

### 5.2 Delta 处理中静默跳过缺失状态

**位置**: [build_hoi4_scenario.py:170-174](tools/build_hoi4_scenario.py#L170-L174)

```python
if not baseline_record or not target_record:
    continue  # 只存在于一个时间线的 state — 无日志
if not baseline_owner or not target_owner or baseline_owner == target_owner:
    continue  # 无 owner 或无变化 — 无日志
```

**建议**: 添加 `logging.debug()` 记录被跳过的 state 及原因，便于构建问题排查。

### 5.3 1939 controller.manual.json 空规则文件

文件存在但 `rules: []`，带 QA-054 注释说明"有意清空"。expectation 文件要求 `controllers_url` 存在。

**现状可接受**。建议在 manifest 中添加 `controller_parity: true` 字段，明确表达 "owner 和 controller 完全一致" 的语义，而非依赖空文件推断。

### 5.4 targets 文件中 feature ID 缺少前缀

**位置**: `data/scenario-rules/targets/hoi4_1939_cz_sk_targets.json`

targets 使用裸 ID（如 `57006924B56764577868008`），manual rules 中手动拼接前缀（`CZ_ADM2_57006924B56764577868008`）。

**风险**: 前缀拼接逻辑分散在手动规则编写中，容易出错。

**建议**: targets 文件中直接使用完整前缀 ID。

---

## 6) P4 — 双击涂色逻辑简化（已完成）

### 6.1 改动概述

当前 working tree 中 [map_renderer.js](js/core/map_renderer.js) 的双击涂色逻辑已大幅简化：

**Before（旧架构）**:
- 使用 `PARENT_FILL_DOUBLE_CLICK_MS = 260` 定时器
- `scheduleSingleSubdivisionFill()` → 延迟 260ms 执行单格填色
- `consumePendingParentFillClick()` → 260ms 内再次点击则升级为批量填色
- `state.pendingMapClickAction` 状态管理
- 复杂的条件匹配（同一 feature、同色、同工具、同模式、时间窗口内）

**After（新架构）**:
- 利用浏览器原生 `dblclick` 事件（`event.detail >= 2`）
- `handleClick()` 中 `clickCount >= 2` 时直接 `return`（跳过单格填色）
- `handleDoubleClick()` 调用 `executeDoubleClickBatchFill()`
- 先尝试 parent-group 填色，fallback 到 country 填色
- 移除 `state.pendingMapClickAction` 状态字段

**改进点**:
- 删除约 80 行复杂的定时器+状态机代码
- 消除 260ms 单击延迟（用户体验改善）
- 不再需要跨点击事件的状态同步

### 6.2 新增 GB 分组候选函数

```javascript
function isBritishConstituentGroupingCandidate(candidate) {
  // 要求 hierarchy 来源、coverage 达标、至少 4 个分组
  // 必须包含 England, Scotland, Wales, Northern_Ireland
}
```

在 `resolveCountryParentGroupingCandidate()` 中为 GB 添加了专用的 constituent countries 分组规则（`forcedRule: "gb_constituent_countries"`），优先于通用的 `GB_PARENT_MIN_GROUPS` 逻辑。

### 6.3 遗留清理建议

以下函数已被删除，确认无其他引用：
- `cancelPendingMapClickAction()` — 已删除
- `scheduleSingleSubdivisionFill()` — 已删除
- `consumePendingParentFillClick()` — 已删除
- `executePendingMapClickAction()` — 已删除

`state.pendingMapClickAction` 已从 [state.js](js/core/state.js) 中移除。

**状态**: 清理完整，无遗留引用。

---

## 7) 修复建议汇总

| # | 问题 | 修复方式 | 影响文件 | 优先级 |
|---|------|---------|---------|--------|
| 1 | 重复规则选择函数 | 统一为 crosswalk.py 单一函数 | crosswalk.py, compiler.py | P1 |
| 2 | 手动规则 version 不一致 | 统一 version: 2 + 添加校验 | hoi4_1939.manual.json, parser.py | P1 |
| 3 | cores 丢失游戏 core 数据 | 合并 state core_tags 到输出 | compiler.py | P1 |
| 4 | 硬编码场景特判 | 移入 manual.json 配置 | compiler.py, manual.json×2 | P2 |
| 5 | 硬编码区域 ID | 移入配置文件 | compiler.py, manual.json | P2 |
| 6 | 硬编码白俄拓扑 | 移入配置 | compiler.py | P2 |
| 7 | audit 版本不一致 | 统一 version: 2 | compiler.py | P3 |
| 8 | delta 静默跳过 | 添加 debug 日志 | build_hoi4_scenario.py | P3 |
| 9 | controller 空文件语义 | 添加 controller_parity 字段 | manifest 生成逻辑 | P3 |
| 10 | targets ID 无前缀 | 使用完整前缀 ID | hoi4_1939_cz_sk_targets.json | P3 |

---

## 8) 验证方式

修复后应执行以下验证：

1. **构建回归测试**: 分别构建 1936 和 1939，对比 owners.by_feature.json 和 controllers.by_feature.json 确认无变化（cores 除外）
2. **Expectation 校验**: `python tools/check_hoi4_scenario_bundle.py --scenario-id hoi4_{1936,1939}`
3. **前端冒烟测试**: 加载两个剧本，切换 ownership/frontline 视图，确认渲染无异常
4. **双击测试**: 验证单击填色无延迟、双击批量填色正常工作（parent-group 和 country 级别）
