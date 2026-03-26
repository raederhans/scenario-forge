# QA-091: TNO 1962 Bundle 数据层审计

**日期:** 2026-03-19
**状态:** 审计完成，含可执行优化方案
**范围:** Bundle 构建管线、数据文件结构、冗余分析、稳定性评估
**关联:** QA-090（加载性能审计）

---

## 一、Bundle 总览

**总大小:** ~22.4 MB（11 个已发布文件）
**构建工具:** `patch_tno_1962_bundle.py`（6,440 行 Python）
**Feature 数量:** 13,230 个政治几何体（含 927 个 HGO Atlantropa 地块）

| 文件 | 大小 | 占比 | 用途 |
|------|------|------|------|
| runtime_topology.topo.json | 15,531 KB | 69.2% | 拓扑几何（arcs + 6 object layers） |
| audit.json | 2,560 KB | 11.4% | 构建审计诊断数据 |
| relief_overlays.geojson | 1,434 KB | 6.4% | 地形浮雕（25 个 Atlantropa overlay） |
| geo_locale_patch.json | 1,434 KB | 6.4% | 地块名称本地化（en + zh） |
| cores.by_feature.json | 440 KB | 2.0% | 核心州映射 |
| owners.by_feature.json | 385 KB | 1.7% | 所有权映射 |
| controllers.by_feature.json | 385 KB | 1.7% | 控制者映射 |
| countries.json | 179 KB | 0.8% | 182 个国家元数据 |
| city_overrides.json | 110 KB | 0.5% | 城市/首都覆盖 |
| capital_hints.json | 109 KB | 0.5% | 首都提示 |
| water_regions.geojson | 18 KB | 0.1% | 水域区域（刚果湖） |
| special_regions.geojson | 42 B | ~0% | 空占位文件 |
| manifest.json | 3 KB | ~0% | 元数据清单 |

---

## 二、runtime_topology.topo.json 深度分析（15,531 KB）

这是整个 Bundle 的绝对重心，占总大小的 **69%**。

### 2.1 内部结构分解

| 组件 | 大小 | 占拓扑文件比 |
|------|------|-------------|
| **arcs（共享弧段数组）** | **9,914 KB** | **63%** |
| political（13,230 个几何体） | 6,023 KB | 38% |
| &emsp;→ 其中 properties | 3,589 KB | 23% |
| &emsp;→ 其中 arc references | 1,224 KB | 8% |
| land_mask | 650 KB | 4% |
| land | 650 KB | 4% |
| context_land_mask | 572 KB | 4% |
| scenario_water | 1 KB | ~0% |
| scenario_special_land | 0 KB | ~0% |

**关键发现：`land_mask` 和 `land` 的 arc references 完全相同（666,243 bytes），是冗余的。**

### 2.2 Properties 冗余分析（3,589 KB）

每个 geometry 的 properties 对象结构如下：
```json
{
  "id": "AFG-1741",            // 必需 — feature ID
  "name": "Badghis",           // 必需 — 显示名称
  "cntr_code": "AF",           // 必需 — 国家代码
  "admin1_group": "",          // 66% 为空字符串
  "detail_tier": "",           // 70% 为空字符串
  "__source": "detail",        // 4 种值：detail(12267), hgo_donor(927), primary(32), ru_override(4)
  "scenario_id": null,         // 92% 为 null（仅 927 个 HGO 地块非空）
  "region_group": null,        // 92% 为 null
  "atl_surface_kind": null,    // 92% 为 null
  "interactive": null,         // 92% 为 null
  "render_as_base_geography": null  // 92% 为 null
}
```

**精确冗余量化：**

| 冗余类型 | 精确字节数 | 说明 |
|---------|-----------|------|
| 5 个 null 字段 × 12,303 几何体 | **1,369 KB** | `scenario_id`, `region_group`, `atl_surface_kind`, `interactive`, `render_as_base_geography` |
| 2 个空字符串字段 | **309 KB** | `admin1_group`(66%), `detail_tier`(70%) |
| **合计可节省** | **1,678 KB** | 占拓扑文件的 10.8% |

**927 个 HGO Atlantropa 地块**是唯一使用 `scenario_id`、`atl_surface_kind`、`interactive`、`render_as_base_geography` 的对象。这 5 个字段只对 7% 的几何体有意义，却对 100% 的几何体都序列化了。

### 2.3 `__source` 字段分析

| 值 | 数量 | 含义 |
|----|------|------|
| `detail` | 12,267 | 来自高精度拓扑 |
| `hgo_donor` | 927 | Atlantropa HGO 捐赠几何 |
| `primary` | 32 | 来自主拓扑（低精度补漏） |
| `ru_override` | 4 | 俄罗斯特殊覆盖 |

`__source` 字段在运行时被 `getPoliticalFeatureCollection()` 赋值（`map_renderer.js:2097`），但拓扑中已经携带了。**这是双重冗余** — 构建时写入、运行时又覆盖。

### 2.4 `land_mask` vs `land` 重复

```
land_mask arc refs: 666,243 bytes
land arc refs:      666,243 bytes  ← 完全相同
```

两个 object layer 引用了完全相同的 arc 集合，浪费 **~650 KB**。JS 端在 `map_renderer.js:4101-4110` 按优先级尝试：先 `context_land_mask` → `land_mask` → `land`。如果 `land_mask` 存在则 `land` 不会被使用。

### 2.5 量化精度

```json
"transform": {
  "scale": [0.00036000036, 0.00017358227358],
  "translate": [-180.0, -89.9825]
}
```

量化到约 10,000 × 10,000 网格（每 0.036° 经度 / 0.017° 纬度一个格点）。对于 NUTS-3 级别的政治地块来说这是合理的精度，**无需进一步降低**。

---

## 三、所有权数据分析

### 3.1 owners.by_feature.json vs controllers.by_feature.json

| 指标 | 值 |
|------|-----|
| Owner 条目 | 13,230 |
| Controller 条目 | 13,230 |
| **值不同的条目** | **1,185（9%）** |
| **值相同的条目** | **12,045（91%）** |
| 当前两文件合计大小 | 770 KB |
| Delta 编码 controller 大小 | **45 KB** |

**91% 的 controller 值与 owner 相同。** 如果改为 delta 编码（仅存储与 owner 不同的 controller），controllers 文件可从 385 KB 降至 45 KB，**节省 340 KB**。

### 3.2 Owner 分组分析

按 owner 分组格式（`{tag: [featureId, ...]}` 而非 `{featureId: tag}`）：

| 格式 | 大小 |
|------|------|
| 当前（featureId → tag 平铺） | 410 KB |
| 分组格式（tag → [featureIds]） | 321 KB |
| **节省** | **89 KB (21%)** |

前 10 大 owner：USA(909), GER(839), RKM(805), CHI(709), RAJ(512), ATL(465), RKU(422), SOV(405), MAN(347), CAN(343)

### 3.3 cores.by_feature.json 格式缺陷

**确认存在序列化 bug：** cores 值被存为 Python `repr()` 字符串而非 JSON 数组。

```json
// 当前（错误格式）
"AFG-1741": "['AFG']"           // ← Python 字符串
"AZE-1676": "['SOV', 'RKK']"   // ← Python 字符串

// 应该是
"AFG-1741": ["AFG"]             // ← JSON 数组
"AZE-1676": ["SOV", "RKK"]     // ← JSON 数组
```

**统计：**
- 13,164 条为字符串格式（99.5%）
- 66 条为正确的列表格式（0.5%）
- 格式修复可节省 ~14 KB（不大，但修复了格式不一致问题）

**稳定性风险：** JS 消费端目前将 cores 作为 opaque 值存入 `state.scenarioBaselineCoresByFeatureId`，但如果未来需要解析核心列表（如判断"某地块是否为某国核心"），字符串格式会导致 bug。这是一个**潜伏的定时炸弹**。

---

## 四、geo_locale_patch.json 冗余分析（1,434 KB）

| 指标 | 值 |
|------|-----|
| 总条目数 | 11,364 |
| EN 名称与 topology 完全一致 | **11,300 (99.4%)** |
| EN 名称与 topology 不同 | 64 (0.6%) |
| 仅保留 zh + 64 个差异 EN 后大小 | **~398 KB** |
| **可节省** | **~1,002 KB (70%)** |

99.4% 的英文名称与 runtime_topology 中的 `properties.name` 完全重复。只有 64 个地块的 EN 名有场景特定覆盖。

---

## 五、countries.json 字段冗余（179 KB）

182 个国家，每个国家 29 个字段。

**完全冗余的字段：**

| 字段 | 冗余原因 |
|------|---------|
| `base_iso2` = `lookup_iso2` = `provenance_iso2` | **182/182 (100%) 三者完全相同**，只需保留一个 |
| `source_types` 数组 | **182/182 (100%) 只有一个元素**，与 `source_type` 重复 |
| `historical_fidelity_summary` 数组 | **182/182 (100%) 只有一个元素**，与 `historical_fidelity` 重复 |
| `continent_label` / `subregion_label` | 可从 `continent_id` / `subregion_id` 派生 |
| `controller_feature_count` | **158/182 (87%) 与 `feature_count` 相同** |
| `notes` | 43/182 为空字符串，占 14 KB（最大单字段） |

**按字段大小排名：**
- `notes`: 14 KB（大量冗余文本）
- `regional_presets`: 11 KB
- `historical_fidelity_summary`: 8 KB（100% 可删除）
- `primary_rule_source`: 8 KB
- `rule_sources`: 7 KB
- `source_types`: 6 KB（100% 可删除）

---

## 六、audit.json 评估（2,560 KB）

audit.json 是纯诊断数据，包含：
- 构建摘要统计
- 每个 feature 的质量审计记录（来源、置信度、blocker 标记等）
- 地理完整性检查结果

**运行时用途：** 仅用于开发者调试面板（"审计"UI tab），普通用户永远不会用到。

**当前加载方式：** 虽然 manifest 中有 `audit_url`，但查看 `loadScenarioBundle()` 的 Promise.all 列表（`scenario_manager.js:1287-1322`），audit 并不在首批加载队列中。它通过 optional layer 机制延迟加载。

**结论：** audit.json 的加载已经是延迟的，不影响首屏性能。但作为 Bundle 总大小的 11%，如果需要减小部署/分发体积，可考虑：
- 移至独立的调试包（debug artifact）
- 在 manifest 中用 `debug_only: true` 标记

---

## 七、其他文件评估

### 7.1 capital_hints.json + city_overrides.json

两个文件有**高度重叠**的数据结构：
- `capital_hints.json`：153 条首都提示，含完整城市元数据（city_id, city_name, name_ascii, population 等）
- `city_overrides.json`：含 `capitals_by_tag`（简洁的 tag → city_id 映射）+ `capital_city_hints`（结构同上）

**建议合并为单文件**，统一为 `capitals.json`，节省 ~50 KB。

### 7.2 special_regions.geojson

空文件（`{"type":"FeatureCollection","features":[]}`），仅 42 字节。可在 JS 端生成默认空集合而非加载文件。

### 7.3 relief_overlays.geojson（1,434 KB）

25 个 Atlantropa 浮雕覆盖层。使用 GeoJSON 格式（非 TopoJSON）。

**优化潜力：** 将其转为 TopoJSON 格式可利用 arc 共享，预计节省 30-40%（约 430-570 KB）。当前 `tno_1962` 已将这些覆盖层改为默认开启（`scenario_relief_overlays_default: true`），因为它们属于基础地理表达。若未来复用到默认关闭的场景，再讨论按需加载或更轻量的传输格式更合适。

---

## 八、构建管线（patch_tno_1962_bundle.py）评估

### 8.1 构建流程

```
1. 加载基线数据
   ├─ 读取 runtime_political topology
   ├─ 加载 feature migration map（ID 迁移映射）
   └─ 加载国家元数据 + feature 分配

2. 应用区域规则包（4 个）
   ├─ tno_1962.russia_ownership.manual.json   (25 KB, ~30 国)
   ├─ tno_1962.east_asia_ownership.manual.json (18 KB, ~15 国)
   ├─ tno_1962.south_asia_ownership.manual.json (1.4 KB, 1 国)
   └─ tno_1962.africa_ownership.manual.json    (3.4 KB, 1 国)

3. 构建 HGO Atlantropa 几何
   ├─ 从 HGO mod 导入 donor geometry
   ├─ 构建 salt_flat_land / sea 分类
   └─ 生成 927 个合成地块

4. 重建拓扑
   ├─ 合并 political features（12,303 基线 + 927 HGO）
   ├─ 构建 water regions / special regions
   ├─ 构建 land_mask / context_land_mask / land
   └─ TopoJSON 编码（arc 共享 + 量化）

5. 构建本地化
   ├─ geo_locale_patch（EN + ZH 名称）
   ├─ city_overrides + capital_hints
   └─ geo_name_overrides（手动修正 6 KB）

6. 输出 11 个 JSON 文件
```

### 8.2 稳定性问题

1. **Cores 序列化 bug（已确认）：** Python `repr()` 输出被直接写入 JSON，导致 `"['AFG']"` 字符串而非 `["AFG"]` 数组。需在 `patch_tno_1962_bundle.py` 中修复。

2. **land_mask / land 重复：** 构建时生成了两个完全相同的 object layer。代码中可能有"如果 land_mask 不存在则 fallback 到 land"的历史逻辑，但现在两者总是相同的。

3. **Properties null 字段未清理：** 构建管线对所有 13,230 个几何体都写入了完整的 11 个 property 字段，即使 92% 的几何体有 5 个 null 字段。应在序列化前 strip 掉 null/空值。

4. **`__source` 双重写入：** 构建管线在 topology 中写入 `__source`，但 JS 运行时在 `getPoliticalFeatureCollection()` 中又会覆盖它。构建端的值仅用于调试。

---

## 九、综合优化方案

### 第一优先级：低风险、高回报

| 优化 | 预计节省 | 复杂度 | 修改位置 |
|------|---------|--------|---------|
| Strip topology null 字段（仅输出非 null/非空值） | **1,678 KB** | 低 | `patch_tno_1962_bundle.py` |
| 去除 geo_locale_patch 中冗余的 EN 名称 | **~1,000 KB** | 低 | `patch_tno_1962_bundle.py` + `i18n.js` 需确认 fallback |
| 删除重复的 `land` object layer（保留 `land_mask`） | **~650 KB** | 低 | `patch_tno_1962_bundle.py` + 确认 JS fallback 链 |
| Controller delta 编码（仅存与 owner 不同的条目） | **~340 KB** | 低 | `patch_tno_1962_bundle.py` + `scenario_manager.js` 加载逻辑 |
| **小计** | **~3,668 KB (16%)** | | |

### 第二优先级：中等复杂度

| 优化 | 预计节省 | 复杂度 | 修改位置 |
|------|---------|--------|---------|
| Owner 分组格式（tag → [featureIds]） | **89 KB** | 中 | 两端（构建 + 消费） |
| 修复 cores 序列化为正确 JSON 数组 | **14 KB** + 稳定性 | 低 | `patch_tno_1962_bundle.py` |
| 合并 capital_hints + city_overrides | **~50 KB** | 低 | 两端 |
| 精简 countries.json 冗余字段 | **~40 KB** | 中 | 两端 |
| 删除空 special_regions.geojson | ~0 | 低 | JS fallback |
| **小计** | **~193 KB + 稳定性** | | |

### 第三优先级：结构性优化

| 优化 | 预计节省 | 复杂度 | 说明 |
|------|---------|--------|------|
| Relief overlays 转 TopoJSON | **~500 KB** | 中 | 默认关闭，非首屏 |
| Audit.json 移至独立调试包 | **~2,560 KB** | 中 | 需修改 manifest 结构 |
| `__source` 从 topology properties 中移除 | **~200 KB** | 低 | JS 端已覆盖此值 |

### 总体预期

| 阶段 | 累计节省 | Bundle 大小 |
|------|---------|------------|
| 当前 | — | 22.4 MB |
| 第一优先级完成 | ~3.7 MB | **~18.7 MB (-16%)** |
| 第二优先级完成 | ~3.9 MB | **~18.5 MB (-18%)** |
| 第三优先级完成 | ~7.1 MB | **~15.3 MB (-32%)** |

---

## 十、稳定性改进建议

### 10.1 立即修复

1. **Cores 格式 bug** — 修改 `patch_tno_1962_bundle.py` 中的 cores 序列化，确保输出标准 JSON 数组而非 Python `repr()` 字符串。同时更新 JS 消费端添加格式检测/兼容。

2. **去除 land/land_mask 重复** — 在构建管线中只输出 `land_mask`，删除 `land` object。JS 端 `map_renderer.js:4101-4110` 已有 fallback 链，不会影响功能。

### 10.2 数据一致性

3. **Owner/Controller 键集验证** — 当前两文件有 13,230 个完全相同的键。构建管线应在输出前断言键集一致性，避免未来修改引入孤立条目。

4. **Properties schema 收敛** — 对 HGO 专有字段（`scenario_id`, `atl_surface_kind`, `interactive`, `render_as_base_geography`）采用"仅在有值时写入"策略，而非全局写入 null。JS 端读取时用 `?? null` 默认值。

### 10.3 构建管线健壮性

5. **Manifest 中增加 file size 校验** — 在 manifest.json 中记录每个文件的预期大小（bytes），JS 加载后可做 sanity check（如果实际大小偏差 >10% 则 warn）。

6. **版本化 Bundle 格式** — manifest 中已有 `version: 2`，但各数据文件的 `version: 1` 从未递增。建议在格式变更时递增版本号，JS 端按版本分支解析逻辑。
