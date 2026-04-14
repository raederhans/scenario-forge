# TNO bundle 瘦身准备文档 2026-04-13

## 目标

- 在不破坏当前运行时契约的前提下，准备下一波 `tno_1962` bundle 瘦身
- 优先处理明显重复、明显不该 shipped、或者名字叫 `coarse` 但体积反而更大的产物
- 第一波范围已经锁定：
  - 只收非运行时产物
  - `audit.json` 先不动
  - 不改 bootstrap topology / chunk 形态

## 已确认的大头

- `chunks/` 约 290 MB
  - 其中 `political.coarse.r0c0.json` 与 `water.coarse.r0c0.json` 特别大
- `marine_regions_named_waters.snapshot.geojson` 两份快照合计约 179 MB
- `runtime_topology.topo.json` 与 `runtime_topology.bootstrap.topo.json` 高度重复

## 下一波拆分顺序

### 1. 先收 shipped / checkpoint 边界
- 审 `marine_regions_named_waters.snapshot.geojson`
- 审 `derived/marine_regions_named_waters.snapshot.geojson`
- 审 `water_regions.provenance.json`
- 审 `audit.json`

目标：
- 让运行时 scenario 目录只保留真正被前端读取的文件
- 把 snapshot / provenance / 审计文件往 checkpoint 或 reports 迁

## 第一波实施结果

- [x] 确认 `marine_regions_named_waters.snapshot.geojson` 当前活跃读取链已经可以统一到 `derived/...`
- [x] 确认 `water_regions.provenance.json` 没有前端运行时直接依赖
- [x] 确认 `audit.json` 仍被运行时审计 lazy-load、scenario contract 和测试链依赖，第一波保持不动
- [x] 停止把 snapshot / provenance 作为 `scenario_data` / `all` publish scope 的正式 scenario bundle 文件
- [x] validator / tests / planner 全部改到 `derived/...` canonical support 路径
- [x] 删除 root 级重复 snapshot
- [x] provenance 逻辑收口到 `derived/...`，同时临时保留 root 级 checked-in mirror 作为过渡兼容，避免干净工作区默认 water/full build 因缺少新 support 文件而失败

## 本轮验证

- `python -m py_compile map_builder/contracts.py map_builder/scenario_rebuild_planner.py tools/patch_tno_1962_bundle.py tools/validate_tno_water_geometries.py tests/test_tno_water_geometries.py tests/test_tno_bundle_builder.py tests/test_scenario_rebuild_planner.py`
- `python -m unittest tests.test_scenario_rebuild_planner tests.test_tno_bundle_builder tests.test_tno_water_geometries -q`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`

## 第一波结论

- 这波已经把最明显的 root/derived 双份 snapshot 边界收干净了，但不触碰任何运行时关键路径。
- `audit.json` 继续保留在正式 scenario 目录；下一波如果要动，必须把 manifest、runtime lazy-load、contract checker、测试一起迁。
- 第二波可以继续评估：
  - `runtime_topology.bootstrap.topo.json`
  - `political.coarse.r0c0.json`
  - `water.coarse.r0c0.json`

### 2. 再收 bootstrap topology
- 审 `runtime_topology.bootstrap.topo.json` 和 `runtime_topology.topo.json` 的真实差异
- 明确它到底是：
  - 仍然必须 shipped 的 fallback 资产
  - 还是已经可以缩成更小的启动壳

目标：
- 如果必须保留，就把它收成真正的 bootstrap 壳
- 如果只是历史 fallback，就准备单独退役方案

### 3. 最后重做 coarse chunk 形态
- 审 `political.coarse.r0c0.json`
- 审 `water.coarse.r0c0.json`
- 审 `mesh_pack.json` / `runtime_meta.json` / `context_lod.manifest.json`

目标：
- 不再让 coarse chunk 重新展开整份超大 GeoJSON
- 尽量改成更轻的索引 / mesh / topo 驱动

## 下一波验收标准

- `data/scenarios/tno_1962` 总体积明显下降
- 不改首批运行时 URL 契约，或者明确给出迁移步骤
- startup / chunk / runtime fallback 都有定向测试保护
- 不允许“为了瘦身”重新把构建边界缠回全量 rebuild
