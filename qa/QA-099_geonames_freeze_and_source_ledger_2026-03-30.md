# QA-099 GeoNames 冻结与 Source Ledger 落地记录

**日期**：2026-03-30  
**范围**：GeoNames 当前本地冻结、关键原始源 provenance 补档、统一 source ledger  
**边界**：不升级 GeoNames 数据，不改翻译链路，不改更强校验，不改自动化门禁，不碰 scenario 结构拆分相关代码

---

## 1. 本轮做了什么

- 新增 `tools/freeze_geonames_source.py`，把当前本地 `data/cities15000.zip` 与 GeoNames 官方当前包做离线 hash 对照。
- 新增 `tools/build_source_ledger.py`，回填关键原始源的 provenance sidecar，并生成 `data/source_ledger.json`。
- 新增 `tools/check_source_ledger.py`，校验 ledger、local file、provenance sidecar 和 consumer 路径的一致性。
- 新增共享目录 `tools/source_governance_catalog.py`，集中定义这轮纳入治理的基础源。

---

## 2. GeoNames 冻结结果

本地冻结对象：

- `data/cities15000.zip`

官方当前来源：

- `https://download.geonames.org/export/dump/cities15000.zip`

冻结报告：

- `.runtime/reports/generated/geonames_freeze_report.json`

本次对照结果：

- 本地 SHA-256：`de3b169ad0bbc5bbc7c09006561b01ac4d191689d66210c68161fe8903885e63`
- 官方当前 SHA-256：`97e5ffb90290e93be6e9e6ffad279df83f3da7c4c058b458cd13e3705316e9ae`
- 结论：**不一致**

这说明审计里的判断是对的：GeoNames 不能像 geoBoundaries 一样直接做“官方静态锚点且零漂移替换”。这轮正确动作是先冻结现有本地事实，再把升级评估留到下一轮单独处理。

受影响但本轮保持不变的下游产物：

- `data/world_cities.geojson`
- `data/city_aliases.json`

---

## 3. 本轮纳入 ledger 的源

`data/source_ledger.json` 当前共 23 条记录，包括：

- France / Poland 两个社区边界源
- 第二阶段已经冻结的 17 个 geoBoundaries 源
- GeoNames `cities15000.zip`
- Natural Earth `ne_10m_populated_places.zip`
- NOAA ETOPO 2022 栅格
- CGLS PROBAV forest type 栅格

状态约定：

- `frozen_verified`
  适用于 France / Poland / geoBoundaries
- `pending_upgrade_review`
  适用于 GeoNames
- `frozen_local_only`
  适用于 Natural Earth populated places、ETOPO、PROBAV forest type

---

## 4. 本轮补齐的 provenance

新增或补齐的关键 sidecar：

- `data/cities15000.provenance.json`
- `data/ne_10m_populated_places.provenance.json`
- `data/ETOPO_2022_v1_60s_N90W180_surface.provenance.json`
- `data/PROBAV_LC100_global_v3.0.1_2019_forest_type.provenance.json`

说明：

- 这些 sidecar 都是基于当前本地缓存回填的，所以 `capture_mode` 预期为 `cache_backfill`。
- 本轮没有重拉这些大文件，也没有改动它们的字节内容。

---

## 5. 有意不做的内容

- 不升级 `cities15000.zip`
- 不改 `tools/translate_manager.py`
- 不把更强语义校验和 CI 门禁混进这一轮
- 不把缺失本地缓存的 `PROBAV_LC100_global_v3.0.1_2019_discrete.tif` 强行纳入 ledger

最后这一条是有意保守：当前 repo 里没有这份离散 landcover 本地缓存，所以这轮不下载新大文件，不制造新的下游变化面。

---

## 6. 核查结论

本轮预期核查项：

- `python tools/freeze_geonames_source.py`
- `python tools/build_source_ledger.py`
- `python tools/check_source_ledger.py`
- `python tools/smoke_check_source_fetch.py --group phase1_foundation --group geoboundaries_phase2`
- `python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962`

验收标准：

- GeoNames 只产出冻结报告，不替换本地 zip
- `world_cities.geojson`、`city_aliases.json` 不发生内容漂移
- 现有 France / Poland / geoBoundaries 烟雾检查继续通过
- 场景契约继续通过

---

## 7. 下一步建议

下一阶段最合理的顺序仍然是：

1. 单独做 GeoNames 升级差异审计，不直接替换
2. 单独规划翻译链路的正式 API 和追溯方案

不要把这两件事和本轮已经完成的“冻结证据链”混在一起做。  
