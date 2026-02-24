# RESEARCH_GLOBAL_DATA

## 0. 结论摘要

本次调研结论：

1. 当前工程虽然在 `data/europe_topology.json` 中已覆盖 91 个国家/地区代码，但相对 Natural Earth Admin-0（有效 ISO_A2=233）仍缺 148 个，缺口主要集中在北美、南美、非洲、大洋洲。
2. US/CA 的“高细节”路线不能简单套同一数据源：
   - 美国：`geoBoundaries ADM2` 非常契合当前处理链（3233 counties，字段结构与现有 China/RU/UA/IN 替换器一致）。
   - 加拿大：`geoBoundaries ADM2` 仅 76 个 `Divisions`，粒度明显粗于“县级”预期；若要县级感知，需单独接入 StatsCan 更细分层（或评估 `geoBoundaries ADM3`，但 5162 单元较重）。
3. 现有后端存在明确“欧洲化”硬编码（`clip_to_europe_bounds`、`LATITUDE_CROP`、NUTS 专用过滤、`EPSG:3035` 回填假设），必须先拆除再做全球入库。
4. 建议先执行“全球国家骨架 + US ADM2 + CA 过渡方案（ADM2=76）”，随后迭代加拿大细粒度方案；同时采用小岛国黑名单减少脏几何干扰。

---

## 1. 调研方法与基线数据

### 1.1 基线来源
- 世界国家基线：Natural Earth Admin-0（50m）
- 现状覆盖：`data/europe_topology.json` 的 `objects.political.geometries[*].properties.cntr_code`
- 配置集合：`map_builder/config.py` 中 `COUNTRY_CODES ∪ SUBDIVISIONS ∪ EXTENSION_COUNTRIES`

### 1.2 实测统计
- Natural Earth Admin-0 有效 ISO_A2 数：`233`
- 配置国家集合（config union）：`59`
- 当前拓扑实际国家数：`91`

差集（相对当前拓扑）分布：
- North America: `38`
- South America: `13`
- Africa: `48`
- Oceania: `24`
- Asia: `5`
- Europe: `11`
- Antarctica: `1`（建议后置）

---

## 2. Task 1: Missing Nations Inventory

## 2.1 主要缺口区域（按洲）

- 北美：加拿大、美国、墨西哥、中美洲与加勒比大部分仍未纳入。
- 南美：基本全缺（阿根廷、巴西、智利、哥伦比亚等）。
- 非洲：几乎全缺。
- 大洋洲：除少数亚洲延展国家外，澳新与太平洋国家基本未纳入。
- 亚洲：剩余主要缺口为印尼、文莱、东帝汶、港澳。
- 欧洲：仍有若干微型/属地国家缺失（如 Andorra、Monaco、Vatican、GB）。

## 2.2 目标国家清单（建议 Phase 12 纳入）

说明：以下清单 = “当前拓扑未覆盖” - “小岛国黑名单” - “南极暂缓”。

### North America (19)
`BZ, CA, CR, CU, DO, SV, GL, GT, HT, HN, JM, MX, NI, PA, PR, PM, BS, TT, US`

### South America (13)
`AR, BO, BR, CL, CO, EC, FK, GY, PY, PE, SR, UY, VE`

### Africa (48)
`AO, BJ, BW, BF, BI, CV, CM, CF, TD, KM, CD, DJ, GQ, ER, ET, GA, GM, GH, GN, GW, CI, KE, LS, LR, MG, MW, ML, MR, MZ, NA, NE, NG, CG, RW, SN, SL, SO, ZA, SS, SD, ST, TG, UG, TZ, EH, ZM, ZW, SZ`

### Oceania (3)
`AU, NZ, PG`

### Asia (5)
`BN, TL, HK, ID, MO`

### Europe (11)
`AX, AD, FO, GR, GG, IM, JE, MC, SM, GB, VA`

## 2.3 小岛国过滤策略（Pacific/Caribbean）

### 推荐规则（双层）
1. **硬规则（主规则）**：按 ISO 黑名单直接忽略（见 2.4）。
2. **软规则（兜底）**：若国家位于 `Caribbean/Melanesia/Micronesia/Polynesia` 且国土面积小于阈值（建议 `120,000 km²`，以 EPSG:6933 粗算），可自动标记为 deferred。

### Hawaii 保留约束
- Hawaii 属 US 子几何，**不要用“岛屿面积过滤”直接裁掉 US 子要素**。
- 过滤应作用于“国家接入名单”，而不是 US 的子区级面。

## 2.4 小岛国黑名单（Phase 12 建议）

### Pacific
`AS, CK, FJ, FM, GU, KI, MH, MP, NC, NF, NR, NU, PF, PN, PW, SB, TK, TO, TV, VU, WF, WS`

### Caribbean
`AG, AI, AW, BB, BL, BM, CW, DM, GD, KN, KY, LC, MF, MS, SX, TC, VC, VG, VI`

---

## 3. Task 2: US & CA Admin-2 深度方案

## 3.1 数据源对比（实测）

| 数据源 | 适用国家 | 文件体量 | 要素数 | 结构兼容性 | 结论 |
|---|---|---:|---:|---|---|
| geoBoundaries ADM2 (US) | US | 10.5 MB (raw GeoJSON), 7.9 MB (simplified), 1.8 MB (TopoJSON) | 3233 | 高（`shapeID/shapeName` 与现有替换器一致） | 推荐 |
| geoBoundaries ADM2 (CA) | CA | 26.2 MB (raw), 18.5 MB (simplified), 5.2 MB (TopoJSON) | 76 | 高（字段兼容）但粒度偏粗 | 过渡可用 |
| geoBoundaries ADM3 (CA) | CA | 42.6 MB (raw), 28.9 MB (simplified), 8.1 MB (TopoJSON) | 5162 | 高，但过重 | 不建议首批直接上 |
| Natural Earth Admin-2 Counties | US(几乎仅 US) | 1.83 MB (zip) | 3224 | 中（字段不同，但可映射） | 轻量备选，仅 US |

关键观察：
- Natural Earth Admin-2 页面明确说明是“mostly for the United States”。对 CA 无实质覆盖。
- geoBoundaries CA ADM2 的 `boundaryCanonical=Divisions`，数量 76，更接近“区域分区”而非县级密度。

## 3.2 美国（US）实施建议

### 推荐源
- 主源：`geoBoundaries USA ADM2`
- 入库格式：优先使用 `simplified GeoJSON`（减轻拓扑构建压力）

### 落地方式
- 新增 `map_builder/processors/us.py`：
  - 标准化输出列：`id, name, cntr_code, geometry`
  - `id` 建议：`US_ADM2_{shapeID}`
  - `cntr_code` 固定 `US`
  - 简化：配置化 `SIMPLIFY_US`，并在 EPSG:4326 下 `preserve_topology=True`

## 3.3 加拿大（CA）实施建议

### 建议分两阶段
- **Phase 12（可交付优先）**：接入 `geoBoundaries CAN ADM2`（76 units）作为过渡。
- **Phase 13（精度升级）**：评估并替换为 StatsCan 更细层（目标接近 Census Divisions 级别）。

### 为什么不直接上 CAN ADM3
- 5162 单元体量接近“地方级”，对当前全局拓扑合并和前端渲染压力较大。
- 建议先建立全球骨架和 US 高细节，再做 CA 细粒度分层加载。

## 3.4 Alaska / Hawaii / 反经线策略

目标：保持地理真实位置，不做 US inset 偏移。

### 风险
- Aleutian 链跨越反经线（±180）附近，Shapely/GeoPandas 在 `clip/overlay/simplify` 某些组合下易出现跨世界包裹异常。

### 推荐处理流程
1. 原始存储保持 `EPSG:4326`。
2. 对“跨经线候选几何”（`maxx-minx > 180`）执行 dateline-safe 预处理：
   - 临时经度归一到 `[0, 360)`；
   - 在 180 经线处分割；
   - 再映射回 `[-180, 180]`；
   - `make_valid()` 清理拓扑。
3. 禁止使用类似 `clip_box(-20, ..., 179.99)` 的半球裁剪方案处理 US。
4. 面积与阈值计算仍使用 `EPSG:6933`，避免高纬面积失真。

---

## 4. Task 3: Clipping & Projection Audit

## 4.1 发现的关键阻塞点

### 欧洲范围裁剪
- `map_builder/geo/utils.py::clip_to_europe_bounds`
- 调用点覆盖：
  - `init_map_data.py` 主流程（nuts/borders/ocean/land/physical 等）
  - `map_builder/io/readers.py::load_rivers/load_urban/load_physical`
  - `map_builder/processors/admin1.py`
  - `map_builder/processors/china.py`

### 纬度裁剪
- `init_map_data.py::LATITUDE_CROP_BOUNDS = (-180, -55, 180, 73)`
- `init_map_data.py::crop_to_latitude_band(...)`
- `init_map_data.py::filter_countries(...)` 还有 `reps.y >= 30` 的额外过滤

### 欧洲数据假设
- `init_map_data.py::build_geodataframe(...)` 中 NUTS 缺 CRS 时强设 `EPSG:3035`
- NUTS 专用过滤逻辑和欧盟前缀处理仍在主线中

### 区域特化逻辑
- `map_builder/processors/russia_ukraine.py` 存在东半球裁剪盒与乌拉尔分割策略，需从全局主流程抽离为可选插件。

## 4.2 全局 CRS / 投影建议

### 推荐基线
- 原始几何存储与拓扑输入：`EPSG:4326`
- 全局面积阈值运算：`EPSG:6933`（当前已使用，适合全球等面积统计）
- 距离/缓冲等米制操作：局部任务可用 `EPSG:3857`，或按需 geodesic 计算

### 前后端一致性建议
- 后端保持 WGS84 输出 + 拓扑量化。
- 前端展示层在 `geoEqualEarth` 与 `geoMercator` 可切换，不影响后端存储 CRS。

---

## 5. De-Europeanization 重构清单（Python）

1. `map_builder/geo/utils.py`
   - `clip_to_europe_bounds` -> `clip_to_bounds(gdf, bounds, label)` 通用化

2. `init_map_data.py`
   - 删除/参数化 `LATITUDE_CROP_BOUNDS` 与 `crop_to_latitude_band`
   - 重写 `filter_countries`（去掉 `reps.y>=30 & reps.x>=-30`）
   - `build_geodataframe` 中移除 NUTS 专用 `EPSG:3035` 假设
   - 将欧洲/NUTS主流程与全球流程拆分成 profile（`EU_PROFILE`, `GLOBAL_PROFILE`）

3. `map_builder/io/readers.py`
   - `load_rivers/load_urban/load_physical` 改为可注入 bounds，而非固定 Europe clip

4. `map_builder/processors/admin1.py`
   - `build_extension_admin1` 移除欧洲裁剪依赖，改按目标国家集合过滤

5. `map_builder/processors/china.py`
   - 去掉 `clip_to_europe_bounds`，改用全局规则或按国家边界裁剪

6. `map_builder/processors/russia_ukraine.py`
   - 将 `clip_box(-20,0,179.99,90)` 和乌拉尔逻辑移至可选策略，不再默认进入全球主线

7. `map_builder/config.py`
   - 新增 `GLOBAL_TARGET_COUNTRIES`, `GLOBAL_EXCLUDE_ISO`, `BUILD_PROFILE`
   - 将 `MAP_BOUNDS` 从固定欧洲值改为 profile-driven

---

## 6. 推荐实施顺序（Phase 12）

1. 先完成“去欧洲化骨架重构”（第 5 节第 1-3 项）。
2. 接入全球国家（按第 2.2 清单，应用黑名单）。
3. 引入 US ADM2（geoBoundaries，优先 simplified）。
4. 引入 CA ADM2（76 divisions，过渡版本）。
5. 验证反经线处理（Alaska/Aleutian）和 Hawaii 保留。
6. 输出 `global_topology` 原型并记录构建时长、arc 数、文件大小。

---

## 7. 参考来源（Primary Sources）

- Natural Earth Admin-0 (50m):
  - https://naturalearth.s3.amazonaws.com/50m_cultural/ne_50m_admin_0_countries.zip
- Natural Earth Admin-2 Counties 页面（说明主要为美国）:
  - https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-2-counties/
- Natural Earth Admin-2 Counties 数据:
  - https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_2_counties.zip
- geoBoundaries API:
  - US ADM2: https://www.geoboundaries.org/api/current/gbOpen/USA/ADM2/
  - CA ADM2: https://www.geoboundaries.org/api/current/gbOpen/CAN/ADM2/
  - CA ADM3: https://www.geoboundaries.org/api/current/gbOpen/CAN/ADM3/
- Statistics Canada（地理单元定义示例，CSD）:
  - https://www12.statcan.gc.ca/census-recensement/2021/ref/dict/az/Definition-eng.cfm?ID=geo009

