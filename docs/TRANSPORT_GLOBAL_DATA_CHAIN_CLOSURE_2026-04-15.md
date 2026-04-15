# TRANSPORT GLOBAL DATA CHAIN CLOSURE 2026-04-15

## Goal
- 修复当前 global transport 数据链里已经确认的坏引用和 stale 产物问题。
- 先收口 global road 数据链，再补齐 global rail 正式 checked-in 产物。
- 保持主地图 runtime / UI 开关继续关闭，不在这一波提前接通 `showRoad` / `showRail`。

## Plan
- [x] 复核并修掉当前 global transport 的坏引用与 eager loader 问题
- [x] 收口 global road catalog / shard 真相 / stale 目录与过时 manifest metadata
- [ ] 补齐 global rail manifest / audit / topo / placeholder sidecar / catalog
- [x] 运行静态与单元验证
- [ ] 做最终 review，更新 lessons learned，并把本文档移入 archive

## Progress
- 2026-04-15 复核完成：当前确认问题包括：
  - `js/core/data_loader.js` 仍硬编码指向不存在的 `global_road` / `global_rail` 顶层 topo/geojson 文件；
  - `global_road/shards` 实际目录数 43，但当前 builder 真正定义的 shard 只有 39；
  - 当前正式 shard 中有 6 个 manifest 的 `build_command` 仍是旧写法；
  - `global_rail` 目录里还只有 `source_recipe.manual.json`，没有正式 checked-in 产物。
- 2026-04-15 已完成：
  - 已把 `global_road` / `global_rail` 从默认 eager context layer 入口中移除，避免启动阶段再请求不存在的顶层 pack；
  - 已删除 4 个 stale road shard 目录：`e000_e002`、`e002_e004`、`e010_e015`、`e100_e110`；
  - 已统一重写当前正式 road shard manifest 的 `build_command` 元数据；
  - 已新增 `tools/build_global_transport_catalogs.py`，并生成 `data/transport_layers/global_road/catalog.json`。
- 2026-04-15 进行中：
  - 已对 `global_rail` 顶层全量 build 做过一次真实试跑：进程在只写出 recipe 后持续高 CPU / 高内存运行，但在观察窗口内没有任何正式输出文件。
  - 基于这次结果，本波先完成“问题修复 + road 数据链收口”；rail 保留为下一波，优先补 phase 日志和是否需要 shard 的真实诊断，再决定是继续单 pack 还是切到 shard / catalog 路径。
- 2026-04-15 追加完成：
  - 已给 `tools/build_global_transport_rail.py` 补上 phase log：开始扫描、扫描 checkpoint、preview assembly、full assembly、phase-B placeholder sidecar 写出。
  - 已给 rail 增加 region-priority 简化策略：`japan / europe / russia / east_asia / north_america` 保持主关注区基线，其它地区改为更高长度阈值、更粗 simplify、并且提前丢掉 unnamed / unknown 的低优先级线段。
  - 已把 rail 扫描 batch 降到 `50_000`，并把 normalized parquet spill 改成按 `TARGET_NORMALIZED_CHUNK_ROWS=4000` 聚合后再 flush，避免继续生成大量极小 chunk 文件。
  - 已完成一次新的 rail 受控后台评估：前 250 个 scan checkpoint 内，日志显示仍然只扫到了 `low_priority` 区域，说明当前数据源的扫描顺序本身就不按我们的关注区排列；新的 region-priority 策略已经显著压低了保留量，但还不能解决“先扫描到非重点地区”这个根问题。
  - 当前观察到的新 rail 评估指标：约 50 秒时 `raw_seen=21870`、`kept=399`、`pending_rows=399`，私有内存约 `4.9 GB`。相比之前 7GB+ 且没有可解释日志，已经更可观测，也更容易继续做下一步诊断。
