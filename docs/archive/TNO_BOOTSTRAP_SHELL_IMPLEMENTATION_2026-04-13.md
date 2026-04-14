# TNO bootstrap topology 第二波实施记录 2026-04-13

## 目标

- 先推进第二波第一部分：把 `runtime_topology.bootstrap.topo.json` 收成真正的 startup shell
- 保持现有运行时入口、fallback、chunk builder 和 startup bundle 契约不变
- 不在本轮直接处理 `political.coarse.r0c0.json` / `water.coarse.r0c0.json` 的体积问题

## 实施清单

### 1. bootstrap shell
- [x] 让 `build_bootstrap_runtime_topology(...)` 输出最小 shell，而不是接近 full runtime 的大 topology
- [x] 保留 `land_mask` / `context_land_mask` / `scenario_water` / `scenario_special_land` 等 required object names
- [x] 保持 `runtime_political_meta` 继续可用

### 2. startup bundle
- [x] `build_startup_bundle.py` 改为从 full runtime topology 计算 `runtime_political_meta`
- [x] startup bundle 继续写入 runtime shell，不改变对外字段名

### 3. chunk builder 兼容
- [x] `scenario_chunk_assets.py` 在 bootstrap shell 不含 political 几何时，自动回退到 full runtime topology 构建 political coarse chunk

### 4. 验证
- [x] 补 unit tests
- [x] 跑 startup shell / chunk / water 相关定向测试
- [x] 做一次 review / 第一性原理复核

## 进度记录

- 2026-04-13：已把 `runtime_topology.bootstrap.topo.json` 收成真正 shell，当前只保留 `land_mask` / `context_land_mask` / `scenario_water` / `scenario_special_land` 四个 object，`arcs=0`，文件体积约 `0.0003 MB`。
- 2026-04-13：已把 startup bundle 改成从 full runtime topology 计算 `runtime_political_meta`，避免 bootstrap shell 收空后政治 feature meta 丢失。
- 2026-04-13：已让 `tools/scenario_chunk_assets.py` 的 political coarse 在 startup shell 不含 political 几何时自动回退到 full runtime topology，保持现有 coarse chunk 行为不变。
- 2026-04-13：已刷新：
  - `data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json`
  - `data/scenarios/tno_1962/locales.startup.json`
  - `data/scenarios/tno_1962/geo_aliases.startup.json`
  - `data/scenarios/tno_1962/startup.bundle.{en,zh}.json(.gz)`

## 本轮验证

- `python -m py_compile tools/build_startup_bootstrap_assets.py tools/build_startup_bundle.py tools/scenario_chunk_assets.py tools/patch_tno_1962_bundle.py tests/test_startup_bootstrap_assets.py tests/test_scenario_chunk_assets.py tests/test_tno_water_geometries.py tests/test_startup_shell.py tests/test_scenario_resources_boundary_contract.py`
- `python -m unittest tests.test_startup_bootstrap_assets tests.test_scenario_chunk_assets tests.test_startup_shell tests.test_scenario_resources_boundary_contract -q`
- `python -c "...bootstrap shell / startup bundle sha / runtime_political_meta smoke..."`（本地定向断言）

## 结论

- 第二波第一部分已经落地，但只收了 bootstrap shell，没有动 `political.coarse.r0c0.json` 和 `water.coarse.r0c0.json` 的体积形态。
- 下一步可以继续推进：
  1. `political.coarse.r0c0.json`
  2. `water.coarse.r0c0.json`
