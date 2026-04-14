# TNO startup topology 第二波实施记录 2026-04-13

## 目标
- 只处理 `startup.bundle` 里的 `base.topology_primary`
- 不碰 locale/alias/patch、worker/gzip 协议、apply-seed/runtime meta
- 在不降低默认首屏可见效果和 fallback 行为的前提下，做第一刀精准裁剪

## 实施清单
- [x] 补 startup primary 精准裁剪 helper
- [x] 把 slim topology 接进 startup bundle payload
- [x] 扩 report，记录 slimming metrics
- [x] 补单元测试和最小 e2e 护栏
- [x] 重建真实 startup bundles
- [x] 复核 audit 报告与 checked-in 产物

## 进度记录
- 2026-04-13：在 `tools/build_startup_bundle.py` 增加了 startup primary 精准裁剪 helper，当前保留 `political / water_regions / special_zones / ocean / land / urban / physical / rivers`，并对保留对象做属性白名单裁剪与 arc 重映射。
- 2026-04-13：`build_startup_bundle_payload()` 已改为把 slim 后的 `base.topology_primary` 写进 startup bundle，但 `collect_required_geo_keys()` 仍然继续基于原始 `topology_primary` 计算，不顺手改 locale/alias 边界。
- 2026-04-13：`build_startup_bundle_report()` 与 `audit_startup_bundle_family.py` 已新增 `startup_primary_slimming` 指标，包含裁剪前后 bytes、arc 数、object 名和 removed objects。
- 2026-04-13：根据 review 修正后，`special_zones` 仍保留在 startup topology 里，继续承担外部 `special_zones.geojson` 缺失时的 fallback 数据职责。
- 2026-04-13：已直接重建 `data/scenarios/tno_1962/startup.bundle.en/zh(.gz)`，并更新 `.runtime/reports/generated/startup_bundle_report.json` 与 `.runtime/reports/generated/scenarios/tno_1962_startup_bundle_audit.json`。

## 本轮验证
- `python -m py_compile tools/build_startup_bundle.py tools/audit_startup_bundle_family.py tests/test_startup_bootstrap_assets.py`
- `python -m unittest tests.test_startup_bootstrap_assets tests.test_startup_shell tests.test_scenario_resources_boundary_contract -q`
- `python tools/build_startup_bundle.py --scenario-manifest data/scenarios/tno_1962/manifest.json --data-manifest data/manifest.json --topology-primary data/europe_topology.json --startup-locales data/scenarios/tno_1962/locales.startup.json --geo-aliases data/scenarios/tno_1962/geo_aliases.startup.json --full-runtime-topology data/scenarios/tno_1962/runtime_topology.topo.json --runtime-bootstrap-topology data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json --countries data/scenarios/tno_1962/countries.json --owners data/scenarios/tno_1962/owners.by_feature.json --controllers data/scenarios/tno_1962/controllers.by_feature.json --cores data/scenarios/tno_1962/cores.by_feature.json --geo-locale-patch-en data/scenarios/tno_1962/geo_locale_patch.en.json --geo-locale-patch-zh data/scenarios/tno_1962/geo_locale_patch.zh.json --output-en data/scenarios/tno_1962/startup.bundle.en.json --output-zh data/scenarios/tno_1962/startup.bundle.zh.json --report-path .runtime/reports/generated/startup_bundle_report.json`
- `python tools/audit_startup_bundle_family.py --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/scenarios/tno_1962_startup_bundle_audit.json`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`

## 结果摘要
- `startup_primary_slimming.bytes_saved`: `59299`
- `startup_primary_slimming.removed_objects`: `[]`
- `startup_primary_slimming.before_arc_count`: `67765`
- `startup_primary_slimming.after_arc_count`: `67765`
- `startup.bundle.en.json`: 约 `10.61 MB -> 10.55 MB`
- `startup.bundle.en.json.gz`: 约 `2.39 MB -> 2.36 MB`

## 结论
- 第二波第一刀已经收口，但收益非常小，说明 `base.topology_primary` 继续做小对象级裁剪的空间有限。
- 下一轮如果还要继续压 startup family，主战场应该转向 `base.locales + base.geo_aliases + scenario.geo_locale_patch` 或 `runtime_political_meta/apply_seed` 的职责拆账，而不是继续在 startup topology 上做边角裁剪。
