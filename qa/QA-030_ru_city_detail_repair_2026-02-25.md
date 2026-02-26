# QA-030: RU City Detail Coverage Repair (2026-02-25)

## Scope
修复俄罗斯 4 个城市级区域在 detail 层的长期缺失/不稳定问题：
- Moscow
- Saint Petersburg
- Volgograd
- Arkhangelsk

目标：在不引入区县级拆分的前提下，确保“整市级”几何可渲染、可命中、可分组、可检索。

## Root Cause
1. `data/europe_topology.json.bak` 中缺失 Moscow / Saint Petersburg 的城市级几何。  
2. Volgograd / Arkhangelsk 虽存在，但 ID/命名不稳定，不利于层级与本地化链路。  
3. 旧默认 detail source 依赖 `.bak`，无法承载稳定 city-level override。

## Implemented Changes
1. 新增 RU 城市覆盖提取器：`map_builder/processors/ru_city_overrides.py`
- 统一生成 4 个稳定 ID：
  - `RU_CITY_MOSCOW`
  - `RU_CITY_SAINT_PETERSBURG`
  - `RU_CITY_VOLGOGRAD`
  - `RU_CITY_ARKHANGELSK`
- Moscow/Saint Petersburg 优先来自 Admin1 整市面；Volgograd/Arkhangelsk 优先来自 RU ADM2 城市面。

2. 新增 detail 修补脚本：`tools/patch_ru_city_detail.py`
- 输入：`data/europe_topology.json.bak`
- 输出：`data/europe_topology.highres.json`
- 将 4 个城市覆盖写入 detail topology，并提升几何 ID 为稳定字符串。

3. 新增验收脚本：`tools/validate_ru_city_coverage.py`
- 校验 topology、hierarchy、locales 三条链路完整性。

4. hierarchy 注入：`tools/generate_hierarchy.py`
- 新增 RU 城市组映射：
  - `RU_Moscow`
  - `RU_Saint_Petersburg`
  - `RU_Volgograd`
  - `RU_Arkhangelsk`
- 每组含对应 `RU_CITY_*` child。

5. 默认 detail source 切换与回退：`js/core/data_loader.js`
- 默认 `detail_source=highres`
- 回退链：`highres -> legacy_bak`

6. 构建管线挂接：`init_map_data.py`
- 新增 `build_ru_city_detail_topology(...)`
- 在主 topology 构建后自动尝试生成 `europe_topology.highres.json`

7. 工具默认拓扑优先 highres
- `tools/geo_key_normalizer.py`
- `tools/translate_manager.py`

## Validation Results
1. detail 拓扑完整性
- `data/europe_topology.highres.json` political feature count: **8308**
- 4 城市 ID 均存在且名称正确：
  - `RU_CITY_MOSCOW` -> `Moscow`
  - `RU_CITY_SAINT_PETERSBURG` -> `Saint Petersburg`
  - `RU_CITY_VOLGOGRAD` -> `Volgograd`
  - `RU_CITY_ARKHANGELSK` -> `Arkhangelsk`

2. hierarchy 完整性
- `RU_Saint_Petersburg` 新增成功
- 4 组均包含对应 `RU_CITY_*` child
- groups count: **198**

3. locale / alias 完整性
- `geo_aliases.json` 包含：
  - `id::RU_CITY_MOSCOW`
  - `id::RU_CITY_SAINT_PETERSBURG`
  - `id::RU_CITY_VOLGOGRAD`
  - `id::RU_CITY_ARKHANGELSK`
- `locales.json` 含 4 城市英文条目。

4. 自动验收脚本结果
- `python tools/validate_ru_city_coverage.py`
- Result: **PASS**

## Notes
1. `python tools/generate_hierarchy.py` 在直接脚本模式会触发 `sjoin_nearest` 的 CRS 警告（历史行为）；当前不影响本次 RU 城市注入结果。  
2. 验收建议在前端进一步做一次交互回归（Subdivision 填色/擦除/hover）以覆盖 UI 侧可见性。

