# 010 Russia & Borderlands Hybrid Refinement Plan — Feasibility Review

Date: 2026-01-28

## 1) 现状检查（代码与数据）

### 数据现状
- ✅ `data/europe_topology.json` 已包含 RU/UA Admin‑1 级别面。
  - RU 数量：86；UA 数量：25。
  - 样例 ID：`RUS-2364`, `RUS-2279`, `UKR-284`（与 `js/app.js` 里的 RU 分组一致）。
- ✅ `data/ne_10m_admin_1_states_provinces.*` 已存在，可作为 RU/UA 的 Admin‑1 基础层。
- ❌ **缺少 RU/UA 的 ADM2 数据集**（`data/` 中没有 `geoBoundaries-RUS-ADM2` / `geoBoundaries-UKR-ADM2` 或等价来源）。

### 代码现状
- `init_map_data.py` 已有 **Admin‑1 扩展构建**：`build_extension_admin1()` 基于 Natural Earth admin1。
- 已有 **China / France / Poland 的替换流程**，但 **没有** `apply_russia_replacement` 或 RU/UA 的 ADM2 混合逻辑。
- 当前拓扑仅有单一 `political` 层，绘制时按数据顺序渲染，没有显式“覆盖层”机制。

## 2) 计划要点可行性评估

### Zone A（西俄核心区 Admin‑2 全替换）
- **可行性：可行，但数据缺失**。
- 需要：RU ADM2 + UA ADM2（Donetsk/Luhansk）数据集。
- 关键前置：确认 ADM2 字段中 **可稳定映射**到省级/Oblast（ADM1）或至少有 `shapeName` + `shapeID` + `ADM1 name/code`。
  - 若使用 geoBoundaries：字段通常只有 `shapeID/shapeName/shapeType`，**可能没有 ADM1 字段**，需要空间 Join。

### Zone B（西伯利亚“城市多边形”叠加）
- **风险点：城市类型字段可能不存在**。
- 计划依赖 ADM2 数据中可识别 “Urban District / City” 的字段；但 geoBoundaries ADM2 通常 **不区分市辖区**。
- 备选方案：
  - 用 Natural Earth `urban areas` 作为“城市面”，但这不是行政区边界；
  - 或使用 OSM/官方行政区数据（需要额外清洗）。
- **叠加显示需要渲染顺序支持**：当前替换逻辑是“先删后加”，而“城市叠加”需要**同时保留 Admin‑1 面并叠加城市多边形**。

### Donetsk / Luhansk（UA）
- **可行但需确保来源包含** Donetsk/Luhansk 且编码稳定。
- 需要 UA ADM2 数据集质量确认（边界争议可能影响结果）。

## 3) 数据缺口与新增依赖

| 需求 | 当前是否具备 | 备注 |
|---|---|---|
| RU ADM2（rayons） | ❌ | 需新增数据源（geoBoundaries / GADM / OSM） |
| UA ADM2（rayons） | ❌ | 同上 |
| ADM2 → ADM1 映射 | ❌ | 多数数据集需要空间 join 解决 |
| “城市类型”字段 | ❓ | 依赖具体数据源（geoBoundaries 很可能没有） |

## 4) 结论与执行门槛

- **当前数据无法直接执行该计划**，主要缺口是 RU/UA ADM2 数据与“城市类型字段”。
- 若确认数据源后，可沿用 China/Poland/France 的替换架构，新增 `apply_russia_replacement`：
  - 读取 RU/UA ADM2 → 过滤 Hotlist → 生成 `RU_RAY_xxx` / `UA_RAY_xxx`。
  - Zone B 城市多边形需要**叠加层**或**排序保证**（Admin‑1 先绘制，城市后绘制）。
- **层级系统**：现有 `tools/generate_hierarchy.py` 未覆盖 RU/UA，需要扩展（空间 Join ADM2 → ADM1）。

---

建议下一步：确定 RU/UA ADM2 数据源及字段结构（是否可识别“城市区”），再锁定可实现的 Zone B 方案。
