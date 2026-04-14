# TNO startup locale-alias-patch 第三波实施记录 2026-04-13

## 目标
- 拆清 `locales.startup.json`、`geo_aliases.startup.json`、`geo_locale_patch.en/zh.json` 的职责边界
- 让 `startup.bundle` 不再内嵌 locales / aliases / patch
- 让 `geo-locale` 改动不再重建 `startup.bundle.*`

## 实施清单
- [x] 拆 startup 构建阶段：support / bundle / alias
- [x] startup.bundle schema 去掉 locales/aliases/patch
- [x] runtime 侧改为外部补拉 patch
- [x] planner / publish 改按新阶段和新目标走
- [x] 补 builder/runtime/cache/tests

## 进度记录
- 2026-04-13：`tools/build_startup_bundle.py` 已升级到 `STARTUP_BUNDLE_VERSION = 4`，`startup.bundle` 不再内嵌 `base.locales`、`base.geo_aliases`、`scenario.geo_locale_patch`。
- 2026-04-13：`js/main.js::createStartupBootArtifactsOverride()` 现在不会再在 bundle 缺少 locales/aliases 时注入空对象；`js/core/data_loader.js` 会在 override 缺本地化时正常回退到外部 `locales.startup.json` / `geo_aliases.startup.json` 读取。
- 2026-04-13：`js/core/scenario_resources.js::createStartupScenarioBundleFromPayload()` 已保持非阻塞 startup 关键路径，不再在创建 startup bundle 时串行拉 `geo_locale_patch`；patch 继续由外部按需路径补齐。
- 2026-04-13：`tools/build_startup_bootstrap_assets.py` 已拆出 `build_startup_support_assets()` 与 `build_runtime_bootstrap_topology_asset()`；`build_startup_bootstrap_assets()` 继续保留为兼容封装。
- 2026-04-13：`tools/patch_tno_1962_bundle.py` / `map_builder/scenario_rebuild_planner.py` / `map_builder/scenario_publish_service.py` 已加入：
  - `startup_support_assets`
  - `startup_bundle_assets`
  - 旧 `startup_assets` 保留为兼容 alias
- 2026-04-13：`geo-locale` changed domain 现在只跑 `startup_support_assets`，不会再重建 `startup.bundle.*`。
- 2026-04-13：已重建真实 `startup.bundle.en/zh(.gz)`，并更新 `.runtime/reports/generated/startup_bundle_report.json` 与 `.runtime/reports/generated/scenarios/tno_1962_startup_bundle_audit.json`。

## 本轮验证
- `python -m py_compile tools/build_startup_bundle.py tools/build_startup_bootstrap_assets.py tools/audit_startup_bundle_family.py tools/publish_scenario_outputs.py map_builder/scenario_publish_service.py map_builder/scenario_bundle_platform.py map_builder/scenario_rebuild_planner.py tools/patch_tno_1962_bundle.py tests/test_startup_bootstrap_assets.py tests/test_scenario_rebuild_planner.py tests/test_publish_scenario_outputs.py tests/test_tno_bundle_builder.py`
- `python -m unittest tests.test_tno_bundle_builder tests.test_startup_shell tests.test_startup_bootstrap_assets tests.test_scenario_rebuild_planner tests.test_publish_scenario_outputs tests.test_scenario_resources_boundary_contract -q`
- `python tools/build_startup_bundle.py --scenario-manifest data/scenarios/tno_1962/manifest.json --data-manifest data/manifest.json --topology-primary data/europe_topology.json --startup-locales data/scenarios/tno_1962/locales.startup.json --geo-aliases data/scenarios/tno_1962/geo_aliases.startup.json --full-runtime-topology data/scenarios/tno_1962/runtime_topology.topo.json --runtime-bootstrap-topology data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json --countries data/scenarios/tno_1962/countries.json --owners data/scenarios/tno_1962/owners.by_feature.json --controllers data/scenarios/tno_1962/controllers.by_feature.json --cores data/scenarios/tno_1962/cores.by_feature.json --geo-locale-patch-en data/scenarios/tno_1962/geo_locale_patch.en.json --geo-locale-patch-zh data/scenarios/tno_1962/geo_locale_patch.zh.json --output-en data/scenarios/tno_1962/startup.bundle.en.json --output-zh data/scenarios/tno_1962/startup.bundle.zh.json --report-path .runtime/reports/generated/startup_bundle_report.json`
- `python tools/audit_startup_bundle_family.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/scenarios/tno_1962_startup_bundle_audit.json`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`

## 结果摘要
- `startup.bundle.en.json`: 约 `10.55 MB -> 8.03 MB`
- `startup.bundle.en.json.gz`: 约 `2.36 MB -> 1.82 MB`
- `startup.bundle.zh.json`: 约 `10.55 MB -> 8.03 MB`
- `startup.bundle.zh.json.gz`: 约 `2.40 MB -> 1.82 MB`
- 主要移出的内嵌载荷：
  - `base.locales`
  - `base.geo_aliases`
  - `scenario.geo_locale_patch`
- 这些现在都转成了 external support / external patch bytes，在 report 中单独统计。

## 结论
- 这波真正拿到了 startup bundle 的第一轮大收益，而且没有靠删 `.json.gz` 或破坏默认启动去换体积。
- 下一轮如果继续压 startup family，优先级应转向 `runtime_political_meta / apply_seed` 的职责拆账；`locales/aliases/patch` 这条边界已经拆清了。
