# QA-100 GeoNames 升级审计记录

**日期**：2026-03-30  
**范围**：GeoNames 升级审计阶段，只读比对，不替换 tracked 数据  
**边界**：不执行 GeoNames promotion，不修改 `data/cities15000.zip`、`data/world_cities.geojson`、`data/city_aliases.json`，不改任何 scenario 结构相关代码

---

## 1. 本轮做了什么
- 在 [map_builder/cities.py](C:/Users/raede/Desktop/dev/mapcreator/map_builder/cities.py) 增加了最小注入入口，让 GeoNames 审计可以读取指定 zip，而不改变现有默认构建行为。
- 新增 [audit_geonames_upgrade.py](C:/Users/raede/Desktop/dev/mapcreator/tools/audit_geonames_upgrade.py)，用当前本地冻结版和 GeoNames 官方当前版做只读审计。
- 审计产物只写到 `.runtime/`：
  - `.runtime/reports/generated/geonames_upgrade_audit.json`
  - `.runtime/tmp/geonames_upgrade/local/`
  - `.runtime/tmp/geonames_upgrade/remote/`
  - `.runtime/tmp/geonames_upgrade/*_candidate_root/`

---

## 2. 审计结论

这次不能进入 GeoNames promotion。

不是因为官方当前版没有变化，而是因为更早的一层问题已经暴露出来：  
**按当前代码路径重算出来的本地候选产物，和 repo 里现有 tracked 产物并不一致。**

审计报告里已经把这个结论结构化写入：
- `promotion_assessment.can_promote = false`
- `blocking_reasons`:
  - `local_candidate_world_cities_do_not_match_tracked_output`
  - `local_candidate_city_aliases_do_not_match_tracked_output`
  - `local_candidate_scenario_city_assets_do_not_match_tracked_outputs`

这意味着现在如果直接把 GeoNames 官方当前版升上去，会把两个问题混在一起：
- GeoNames 上游版本变化
- 当前 tracked 基线与现有生成路径不一致

这两件事必须拆开处理。否则即使替换成功，也无法判断差异到底来自 GeoNames，还是来自现有基线已经漂移。

---

## 3. GeoNames 当前版相对本地冻结版的差异

来源 hash：
- 本地 `data/cities15000.zip` SHA-256：`de3b169ad0bbc5bbc7c09006561b01ac4d191689d66210c68161fe8903885e63`
- 官方当前包 SHA-256：`97e5ffb90290e93be6e9e6ffad279df83f3da7c4c058b458cd13e3705316e9ae`

原始数据规模：
- 本地 raw rows：`33407`
- 官方当前 raw rows：`33459`
- 本地按 15000 人口阈值保留：`33363`
- 官方当前按 15000 人口阈值保留：`33415`

保留集主键变化：
- 新增 `55` 个 `geonameid`
- 移除 `3` 个 `geonameid`

字段变化统计：
- `name` 变化：`29`
- `asciiname` 变化：`29`
- `population` 变化：`8`
- `alternatenames` 变化：`67`
- `feature_code`、`country_code`、`admin1_code`、`timezone`：`0`

国家层面的主要增量：
- `UA`：`+20`
- `LK`：`+4`
- `UZ`：`+4`
- `CN`：`+3`
- `PK`：`+3`

这些差异说明 GeoNames 当前版确实值得单独评估，但还不能直接替换。

---

## 4. 本地候选与 tracked 基线的不一致

这是本轮最重要的发现。

### 4.1 `world_cities`
- 本地候选相对 tracked：
  - `row_count_delta = +10827`
  - `added_ids = 10827`
  - `removed_ids = 0`
  - `country_capital_delta = 0`
  - `admin_capital_delta = 0`

### 4.2 `city_aliases`
- 本地候选相对 tracked：
  - `entry_count_delta = +10827`
  - `alias_count_delta = +64496`
  - `ambiguous_alias_count_delta = +2622`
  - `signature_changed = true`

### 4.3 scenario 城市资产
- 本地候选相对 tracked：
  - `changed_scenario_count = 5`
  - 受影响场景：
    - `blank_base`
    - `hoi4_1936`
    - `hoi4_1939`
    - `modern_world`
    - `tno_1962`

典型表现不是 `city_overrides` 大改，而是 `capital_hints` 明显减少，同时 `missing_tag_count` 和 `unresolved_capital_count` 明显增加。

这说明当前 repo 里的 tracked 城市资产，并不能被这条现行代码路径直接稳定复现。

---

## 5. 如果忽略这个问题直接 promotion，会有什么风险

- 你会拿到一组大 diff，但无法区分哪些是 GeoNames 官方更新造成的，哪些是现有基线与生成逻辑脱节造成的。
- `world_cities` 和 `city_aliases` 会出现大面积变化，影响面远大于 GeoNames 本身的 `55` 增 / `3` 减。
- scenario 的 `capital_hints.json` 会一起变化，而你现在又在做 scenario 结构拆分，这两条线叠在一起会让风险放大。

所以现在最稳的做法不是“继续往前推”，而是先停在审计阶段。

---

## 6. 本轮能确认的正面信息

虽然 promotion 被阻断，但 GeoNames 当前版相对“本地候选基线”的升级影响其实是可控的：

- `remote_vs_local_world_cities`
  - `row_count_delta = +46`
  - `added_ids = 49`
  - `removed_ids = 3`
  - `admin_capital_delta = +11`
  - `country_capital_delta = 0`

- `remote_vs_local_city_aliases`
  - `entry_count_delta = +46`
  - `alias_count_delta = +447`
  - `ambiguous_alias_count_delta = +36`

- `remote_vs_local_scenario_assets`
  - `changed_scenario_count = 0`

这说明真正难的不是“GeoNames 当前版变化太大”，而是“当前 tracked 基线与现行生成链不一致”。

---

## 7. 核查结果

执行过的核查：
- `python -m py_compile map_builder\cities.py tools\audit_geonames_upgrade.py`
- `python tools\audit_geonames_upgrade.py`
- `python tools\check_scenario_contracts.py --strict --scenario-dir data\scenarios\tno_1962`

本轮确认未漂移的 tracked 文件 hash：
- `data/cities15000.zip`
  - `de3b169ad0bbc5bbc7c09006561b01ac4d191689d66210c68161fe8903885e63`
- `data/world_cities.geojson`
  - `6fc6393dea4177b231ef6d8e5d2a7687c8f3c90e5094102a2df452889279d53a`
- `data/city_aliases.json`
  - `1e76a5adee7a52901c3a1aa8b10d95f8fc29a86f03c8fa32035bb2ba99b806e6`
- `data/europe_topology.json`
  - `f2d1c49bacc9b2eb9fa21c54fdc1dd6aaa8751fc1b37ab49b5bbc1da29da39c0`

场景契约检查：
- `tno_1962` 通过

---

## 8. 下一步建议

下一步不要做 GeoNames promotion。

先做一件更基础的事：
- 单独审计为什么当前 tracked 的 `world_cities`、`city_aliases`、`capital_hints` 不能被现行生成路径复现。

把这层基线问题理顺之后，再回头看 GeoNames promotion，才有意义。
