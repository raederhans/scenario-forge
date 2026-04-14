# TNO startup core 第四波实施记录 2026-04-13

## 目标
- 拆 `runtime_political_meta / apply_seed / owners-controllers-cores` 的 startup bundle 责任边界
- 不新增 startup 关键路径请求
- 不改变运行时上层消费接口

## 实施清单
- [x] 留档并确认当前消费边界
- [x] 移除 startup bundle 中序列化的 `apply_seed`
- [x] 将 `runtime_political_meta` 改为紧凑 wire shape，并兼容旧 shape 读取
- [x] 将 `owners/controllers/cores` 改为基于 runtime feature 顺序的紧凑编码，并恢复到现有运行时接口
- [x] 升级 startup cache schema / startup bundle report / 审计报告
- [x] 补测试并重建 startup 关键产物

## 进度记录
- 2026-04-13：新增 `js/core/startup_bundle_compaction.js`，集中处理 startup core 压缩/解压：
  - `runtime_political_meta`：`featureIds + canonicalCountryByIndex + neighborGraph`
  - `owners/controllers/cores`：`runtime-feature-index-v1`
- 2026-04-13：`tools/build_startup_bundle.py` 升级到 `STARTUP_BUNDLE_VERSION = 5`，startup bundle 不再携带 `scenario.apply_seed`，并输出紧凑化的 `runtime_political_meta / owners / controllers / cores`。
- 2026-04-13：`js/core/scenario_resources.js` 与 `js/core/scenario_manager.js` 已能恢复新 wire shape；startup bundle/cache 命中后对上层仍暴露原来的 in-memory 结构。
- 2026-04-13：`js/core/startup_cache.js` 已改为持久化紧凑 startup core payload，并把 `BOOT_CACHE_SCHEMA_VERSION` 升到 `3`，避免旧 cache 混读。
- 2026-04-13：`js/workers/startup_boot.worker.js` 已兼容新的紧凑 `runtime_political_meta`。
- 2026-04-13：真实 startup bundle 已重建，report / audit 已更新。

## 本轮验证
- `python -m py_compile tools/build_startup_bundle.py tests/test_startup_bootstrap_assets.py tests/test_startup_shell.py tests/test_scenario_resources_boundary_contract.py`
- `node --check js/core/startup_bundle_compaction.js`
- `node --check js/core/startup_cache.js && node --check js/core/scenario_resources.js && node --check js/core/scenario_manager.js && node --check js/workers/startup_boot.worker.js`
- `python -m unittest tests.test_startup_bootstrap_assets tests.test_startup_shell tests.test_scenario_resources_boundary_contract tests.test_tno_bundle_builder -q`
- `python tools/build_startup_bundle.py --scenario-manifest data/scenarios/tno_1962/manifest.json --data-manifest data/manifest.json --topology-primary data/europe_topology.json --startup-locales data/scenarios/tno_1962/locales.startup.json --geo-aliases data/scenarios/tno_1962/geo_aliases.startup.json --full-runtime-topology data/scenarios/tno_1962/runtime_topology.topo.json --runtime-bootstrap-topology data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json --countries data/scenarios/tno_1962/countries.json --owners data/scenarios/tno_1962/owners.by_feature.json --controllers data/scenarios/tno_1962/controllers.by_feature.json --cores data/scenarios/tno_1962/cores.by_feature.json --geo-locale-patch-en data/scenarios/tno_1962/geo_locale_patch.en.json --geo-locale-patch-zh data/scenarios/tno_1962/geo_locale_patch.zh.json --output-en data/scenarios/tno_1962/startup.bundle.en.json --output-zh data/scenarios/tno_1962/startup.bundle.zh.json --report-path .runtime/reports/generated/startup_bundle_report.json`
- `python tools/audit_startup_bundle_family.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/scenarios/tno_1962_startup_bundle_audit.json`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`

## 结果摘要
- `startup.bundle.en.json`：约 `8.03 MB -> 6.02 MB`
- `startup.bundle.en.json.gz`：约 `1.82 MB -> 1.33 MB`
- `startup.bundle.zh.json`：约 `8.03 MB -> 6.02 MB`
- `startup.bundle.zh.json.gz`：约 `1.82 MB -> 1.33 MB`
- `startup_core_compaction`（en/zh 一致）：
  - `runtime_political_meta`：`1.45 MB -> 0.75 MB`
  - `owners`：`0.38 MB -> 0.078 MB`
  - `controllers`：`0.38 MB -> 0.078 MB`
  - `cores`：`0.42 MB -> 0.116 MB`
  - `apply_seed`：`0.39 MB -> 0`

## 结论
- 这波拿到了比上一波更实在的 startup bundle 收益，而且没有新增启动网络请求。
- `startup.bundle` 现在保留的还是原先上层要用的语义，只是 wire shape 更紧凑。
- 下一轮如果继续压 startup family，优先级应转向 `countries / runtime_political_meta` 是否还能进一步共享或延后，而不是再回头塞大 map 结构。
