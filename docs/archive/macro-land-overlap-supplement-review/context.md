# 上下文
- 2026-04-23：开始只读分析 macro_land_overlap supplement。
- 当前工作树 	ools/patch_tno_1962_bundle.py 中，tno_labrador_sea / tno_gulf_of_alaska / tno_tasman_sea 都已经没有 supplement_bboxes 字段。
- validator probe：Labrador Sea=(-52.7329, 53.9977)，Gulf of Alaska=(-147.3894, 57.3575)，Tasman Sea=(160.0, -31.8)。
- 当前 data/scenarios/tno_1962/water_regions.geojson 与 derived/marine_regions_named_waters.snapshot.geojson 中，这 3 个 feature 都覆盖各自 probe，说明 probe 命中不依赖 supplement。
- .runtime/tmp/scenario-forge-review/tools/patch_tno_1962_bundle.py 记录的旧版 whole-basin supplement 仍覆盖这些 probe，但当前主线已去掉。
- 当前 runtime rebuild 仍报 macro_land_overlap: suspicious=3，说明这 3 个 overlap 现阶段来自主几何本身，不是当前 supplement 配置造成。
