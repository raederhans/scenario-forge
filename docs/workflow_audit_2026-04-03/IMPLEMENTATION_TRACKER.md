# workflow audit 2026-04-03 实施追踪

日期：2026-04-03

## 当前波次

第五波已完成，主线是 `political deps` 内收：

1. 把 political materialization 的 loaders、normalizers、catalog helpers 收进 `map_builder` support 模块
2. 让 `scenario_political_materialization_service` 不再反向 import `tools/dev_server.py`
3. 保留 `dev_server` 现有 save 接口和 wrapper，不扩大战线到 geo-locale、startup、chunk

## 工作包状态

| 工作包 | 状态 | 说明 |
| --- | --- | --- |
| checkpoint build lock 收口 | 已完成 | [`tools/patch_tno_1962_bundle.py`](/C:/Users/raede/Desktop/dev/mapcreator/tools/patch_tno_1962_bundle.py) 已支持 `thread_id`、`holder`、`transaction_id`，并加入同线程 transaction 继承 |
| publish `plan -> commit -> record` | 已完成 | [`map_builder/scenario_bundle_publish_service.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_bundle_publish_service.py) 已拆成内部 plan/commit 两段，`record_published_target(...)` 只在 commit 成功后执行 |
| `chunk-assets` publish 去重建 | 已完成 | [`map_builder/scenario_publish_service.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_publish_service.py) 已不再调用 `build_chunk_assets_stage(...)`，只校验并复用现成产物 |
| startup stage checkpoint 闭环 | 已完成 | [`tools/patch_tno_1962_bundle.py`](/C:/Users/raede/Desktop/dev/mapcreator/tools/patch_tno_1962_bundle.py) 已改为在 checkpoint 内生成并消费 `locales.startup.json` / `geo_aliases.startup.json` |
| startup stage artifact 契约补齐 | 已完成 | [`map_builder/contracts.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/contracts.py) 已把 startup locales/aliases 纳入 startup stage artifacts 和 scenario data publish filenames |
| `startup-assets` publish 正式化 | 已完成 | [`map_builder/scenario_publish_service.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_publish_service.py) 现在会把 startup locales/aliases 和 startup bundles 一起从 checkpoint 发布，`supportingPaths` 保留但固定为空 |
| startup fallback 路径收口 | 已完成 | [`js/main.js`](/C:/Users/raede/Desktop/dev/mapcreator/js/main.js)、[`js/core/data_loader.js`](/C:/Users/raede/Desktop/dev/mapcreator/js/core/data_loader.js)、[`js/core/startup_cache.js`](/C:/Users/raede/Desktop/dev/mapcreator/js/core/startup_cache.js) 已切到 scenario-scoped startup support files |
| root 级 startup preload 清理 | 已完成 | [`index.html`](/C:/Users/raede/Desktop/dev/mapcreator/index.html) 已移除 `data/locales.startup.json` / `data/geo_aliases.startup.json` preload |
| materialization 下一波拆分清单 | 已完成 | Galileo 已完成静态梳理：先拆共享错误类型，再拆 political transaction factory，再拆 district-groups helper，最后才动 geo-locale registry |
| 共享 service error 抽离 | 已完成 | [`map_builder/scenario_service_errors.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_service_errors.py) 现在是 `ScenarioServiceError` 定义源；[`tools/dev_server.py`](/C:/Users/raede/Desktop/dev/mapcreator/tools/dev_server.py) 的 `DevServerError` 退化为兼容别名 |
| political transaction factory 下沉 | 已完成 | [`map_builder/scenario_political_materialization_service.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_political_materialization_service.py) 已承接 deps 组装和 transaction 构建；[`map_builder/scenario_materialization_service.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_materialization_service.py) / [`tools/dev_server.py`](/C:/Users/raede/Desktop/dev/mapcreator/tools/dev_server.py) 已复用该入口 |
| district-groups helper 下沉 | 已完成 | [`map_builder/scenario_district_groups_service.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_district_groups_service.py) 已承接 tag 校验、feature scope 校验和 payload 归一化；保存链和 materialize 链现在共用同一套逻辑 |
| `scenario_materialization_service` 去 `dev_server` 主依赖 | 已完成 | [`map_builder/scenario_materialization_service.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_materialization_service.py) 已不再直接 import `dev_server`；geo-locale registry fallback 被收回 [`map_builder/scenario_geo_locale_materializer.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_geo_locale_materializer.py) 内部惰性解析 |
| political support module 内收 | 已完成 | [`map_builder/scenario_political_materialization_support.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_political_materialization_support.py) 已承接 political loaders、catalog helpers、country/capital builders 和 assignment validators |
| political service 去反向 adapter 依赖 | 已完成 | [`map_builder/scenario_political_materialization_service.py`](/C:/Users/raede/Desktop/dev/mapcreator/map_builder/scenario_political_materialization_service.py) 现在直接从 support 模块组装 `PoliticalMaterializerDeps`，不再回头抓 [`tools/dev_server.py`](/C:/Users/raede/Desktop/dev/mapcreator/tools/dev_server.py) |

## 已完成验证

- `python -m py_compile map_builder/contracts.py map_builder/scenario_publish_service.py tools/patch_tno_1962_bundle.py tests/test_publish_scenario_outputs.py tests/test_tno_bundle_builder.py tests/test_startup_shell.py`
- `python -m unittest tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_build_startup_assets_stage_builds_startup_outputs_independently tests.test_publish_scenario_outputs.PublishScenarioOutputsTest.test_publish_startup_assets_target_for_tno_copies_checkpoint_bundles tests.test_startup_shell -q`
- `python -m unittest tests.test_publish_scenario_outputs -q`
- `python -m unittest tests.test_scenario_materialization_service -q`
- `python -m py_compile tools/build_startup_bootstrap_assets.py tools/build_startup_bundle.py map_builder/scenario_bundle_publish_service.py`
- `python -m unittest tests.test_scenario_bundle_publish_service -q`
- `python -m py_compile map_builder/scenario_service_errors.py map_builder/scenario_political_materialization_service.py map_builder/scenario_district_groups_service.py map_builder/scenario_materialization_service.py map_builder/scenario_geo_locale_materializer.py tools/dev_server.py tests/test_scenario_materialization_service.py tests/test_dev_server.py`
- `python -m unittest tests.test_scenario_materialization_service.ScenarioMaterializationServiceTest.test_apply_mutation_and_materialize_in_locked_context_materializes_political_patch tests.test_scenario_materialization_service.ScenarioMaterializationServiceTest.test_apply_mutation_and_materialize_in_locked_context_preserves_local_only_manual_catalog_entries tests.test_scenario_materialization_service.ScenarioMaterializationServiceTest.test_materialize_in_locked_context_materializes_geo_locale_patch tests.test_scenario_materialization_service.ScenarioMaterializationServiceTest.test_build_district_groups_payload_in_context_normalizes_mutation_payload tests.test_dev_server.DevServerTest.test_dev_server_error_aliases_shared_service_error tests.test_dev_server.DevServerTest.test_political_materialization_service_builds_transaction_from_context tests.test_dev_server.DevServerTest.test_load_scenario_tag_feature_ids_uses_owners_only_path tests.test_dev_server.DevServerTest.test_save_scenario_district_groups_payload_writes_country_payload_and_updates_manifest tests.test_dev_server.DevServerTest.test_save_scenario_district_groups_payload_rolls_back_when_manifest_write_fails tests.test_dev_server.DevServerTest.test_save_scenario_district_groups_payload_rejects_duplicate_feature_ids tests.test_dev_server.DevServerTest.test_save_scenario_district_groups_payload_rejects_features_outside_target_tag tests.test_dev_server.DevServerTest.test_apply_shared_district_template_payload_reloads_context_after_acquiring_transaction_lock -q`
- `python -m unittest tests.test_scenario_materialization_service -q`
- `python -m unittest tests.test_dev_server.DevServerTest.test_save_shared_district_template_and_apply_to_scenario_tag tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_prefers_manifest_builder_override tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_rolls_back_manual_overrides_on_builder_failure tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_rejects_when_no_builder_is_registered -q`
- `python -m py_compile map_builder/scenario_political_materialization_support.py map_builder/scenario_political_materialization_service.py`
- `python -m unittest tests.test_scenario_materialization_service -q`
- `python -m unittest tests.test_dev_server.DevServerTest.test_political_materializer_builds_transaction_from_mutations_payload tests.test_dev_server.DevServerTest.test_political_materialization_service_builds_transaction_from_context tests.test_dev_server.DevServerTest.test_political_materializer_derives_manual_payload_without_reading_existing_manual_file tests.test_dev_server.DevServerTest.test_save_scenario_ownership_payload_legacy_owner_updates_preserve_controller_and_core_and_write_manual_overrides tests.test_dev_server.DevServerTest.test_save_scenario_ownership_payload_accepts_assignments_by_feature_id tests.test_dev_server.DevServerTest.test_save_scenario_ownership_payload_owner_only_update_succeeds_without_controllers_or_cores tests.test_dev_server.DevServerTest.test_save_scenario_ownership_payload_rejects_controller_assignment_when_controllers_file_missing tests.test_dev_server.DevServerTest.test_save_scenario_ownership_payload_rejects_core_assignment_when_cores_file_missing tests.test_dev_server.DevServerTest.test_save_scenario_ownership_payload_rejects_unknown_owner_tag tests.test_dev_server.DevServerTest.test_save_scenario_country_payload_updates_manual_overrides_and_country_metadata tests.test_dev_server.DevServerTest.test_save_scenario_country_payload_preserves_untouched_local_manual_catalog_entries tests.test_dev_server.DevServerTest.test_save_scenario_capital_payload_materializes_capital_from_mutations tests.test_dev_server.DevServerTest.test_save_scenario_capital_payload_seeds_previous_hint_from_defaults_partial tests.test_dev_server.DevServerTest.test_save_scenario_capital_payload_ignores_stale_city_override_capital_sections tests.test_dev_server.DevServerTest.test_save_scenario_capital_payload_prefers_city_assets_partial_over_stale_city_overrides tests.test_dev_server.DevServerTest.test_save_scenario_capital_payload_requires_city_assets_partial tests.test_dev_server.DevServerTest.test_save_scenario_capital_payload_requires_capital_defaults_partial tests.test_dev_server.DevServerTest.test_save_scenario_capital_payload_ignores_stale_capital_hints_when_defaults_partial_exists -q`

## 本轮结论

- political materialization 这条链现在已经不需要 `scenario_political_materialization_service -> tools/dev_server.py` 的反向抓取了，真正的 deps 组装已经回到 `map_builder`。
- `dev_server` 这轮没有再承担新的实现职责，仍然只保留旧 save 接口和 wrapper，所以 donor 测试面没有被迫扩散。
- geo-locale registry/resolver、startup、chunk 这轮都没有被连带修改，政治链和其他高风险边界继续隔离。

## 剩余风险

- `tools/dev_server.py` 里 political 相关 helper 仍然有一份旧实现，还没有进一步薄化成全部转发；这会留下短期双实现维护成本。
- `geo-locale materialize -> startup stage -> publish ("geo-locale", "startup-assets")` 这一串还在同一事务链上，后面如果要继续降复杂度，需要单独拆。
- `chunk-assets` 仍然是写回 scenario 目录的 publish-first 产物，不是 checkpoint-only，这条边界还没收。

## 下一步

1. 继续评估是否要把 [`tools/dev_server.py`](/C:/Users/raede/Desktop/dev/mapcreator/tools/dev_server.py) 里的 political 旧 helper 薄化成全部转发，还是保留到 geo-locale 波次一起收。
2. 单独规划 geo-locale builder registry/resolver 拆分，避免现在这种“political 已解耦，但 registry 仍在 adapter 层”的中间态长期存在。
3. 等 materialization 边界更干净后，再决定是否继续收 `chunk-assets` 的 checkpoint-only 边界。

## 第六波补记（2026-04-03）
- 已完成：新增 `map_builder/scenario_geo_locale_registry.py` 作为唯一 geo-locale builder registry；`scenario_geo_locale_materializer.resolve_geo_locale_builder_path(...)` 现在按 `fallback_builder_path -> context.geoLocaleBuilderPath -> shared registry` 解析，不再反向 import `tools/dev_server.py`。
- 已完成：`tools/dev_server.py` 删除自持的 `GEO_LOCALE_BUILDER_BY_SCENARIO`；geo-locale donor tests 改为 patch 共享 registry，并新增静态守卫，确保 materializer 不再回头抓 adapter 层。
- 已验证：`python -m py_compile map_builder/scenario_geo_locale_registry.py map_builder/scenario_geo_locale_materializer.py tools/dev_server.py tests/test_dev_server.py tests/test_scenario_materialization_service.py`；`python -m unittest tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_uses_in_process_materializer_for_tno tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_updates_manual_overrides_and_rebuilds_patch tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_prefers_manifest_builder_override tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_rolls_back_manual_overrides_on_builder_failure tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_rejects_when_no_builder_is_registered tests.test_dev_server.DevServerTest.test_save_scenario_geo_locale_entry_blocks_overlapping_builder_and_preserves_committed_manual_override tests.test_scenario_materialization_service.ScenarioMaterializationServiceTest.test_geo_locale_materializer_no_longer_imports_dev_server_registry -q`。
- 剩余风险不变：TNO geo-locale 保存仍会连带 `startup-assets` publish；这一波没有进入 startup 或 chunk。
## 第七波补记（2026-04-03）
- 已完成：`index.html` 去掉默认场景 `data/scenarios/tno_1962/manifest.json` 硬编码 preload，startup shell 只保留 `modulepreload js/main.js`、`data/europe_topology.json`、`data/scenarios/index.json` 和现有 startup bundle 动态 preload。
- 已完成：`js/core/scenario_resources.js` 新增 `chunkPayloadPromisesById`，`loadScenarioChunkPayload(...)` 改为 `cache -> promise -> fetch` 去重；`preloadScenarioCoarseChunks(...)` 现在复用同一套 chunk loader，并把 coarse prewarm 接进 runtime state，不再把 merged payload 回写 bundle cache。
- 已完成：`js/core/scenario_manager.js` / `js/core/scenario_post_apply_effects.js` 改为从 `state.activeScenarioChunks.mergedLayerPayloads` 读取 chunk merged state，并在 scenario apply 后先做 coarse prewarm 再排队 viewport refresh；同时修正了 chunk refresh 不应清空 fallback water/special/relief/cities 的边界。
- 已验证：`node --check js/core/scenario_resources.js`、`node --check js/core/scenario_manager.js`、`node --check js/core/scenario_post_apply_effects.js`、`python -m unittest tests.test_startup_shell tests.test_scenario_resources_boundary_contract -q`。
- 剩余风险：`applyScenarioPoliticalChunkPayload(...)` 仍然沿用 feature id 列表级相等判定，若后续发现 political chunk 在 id 不变时也会改 geometry/properties，需要单独收这条判定，不和本波混做。
## 第八波补记（2026-04-03）
- 已完成：`tools/check_hoi4_scenario_bundle.py` 改成 shared/domain 分层；generic manifest/url 校验回到 `tools/check_scenario_contracts.py`，HOI4 脚本只保留 expectation、owner/controller set、controller_only country 和 `coverage_report.md` 对账。
- 已完成：新增 `map_builder/transport_workbench_contracts.py` 和 `tools/check_transport_workbench_manifests.py`，Japan transport families 与 `japan_corridor` carrier 现在都有 shared manifest contract；checked-in transport manifest 已补齐 `default_variant` / `variants`，carrier 新增正式 `manifest.json`。
- 已完成：新增 `.github/workflows/peripheral-contract-review.yml`，把 HOI4 shared strict、HOI4 domain、transport manifest review 拆成独立 non-blocking review workflow，不接现有 deploy blocking gate。
- 已验证：`python -m py_compile map_builder/transport_workbench_contracts.py tools/check_transport_workbench_manifests.py tools/check_hoi4_scenario_bundle.py tools/build_hoi4_scenario.py tools/build_transport_workbench_japan_airports.py tools/build_transport_workbench_japan_carrier.py tools/build_transport_workbench_japan_energy_facilities.py tools/build_transport_workbench_japan_industrial_zones.py tools/build_transport_workbench_japan_logistics_hubs.py tools/build_transport_workbench_japan_mineral_resources.py tools/build_transport_workbench_japan_ports.py tools/build_transport_workbench_japan_rail.py tools/build_transport_workbench_japan_roads.py tests/test_check_hoi4_scenario_bundle.py tests/test_transport_manifest_contracts.py`。
- 已验证：`python -m unittest tests.test_check_hoi4_scenario_bundle tests.test_transport_manifest_contracts -q`、`python tools/check_transport_workbench_manifests.py --root data/transport_layers --report-path .runtime/reports/generated/transport_workbench_manifest_report.json`、`python tools/check_hoi4_scenario_bundle.py --scenario-dir data/scenarios/hoi4_1936 --report-dir .runtime/reports/generated/scenarios/hoi4_1936`、`python -m unittest tests.test_scenario_contracts -q`。
- 明确暴露：`python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/hoi4_1936 --report-path .runtime/reports/generated/hoi4_1936.strict_contract_report.json` 目前仍失败，原因是 checked-in `hoi4_1936` 缺 `runtime_topology.topo.json`。这波没有用降级或豁免掩盖它，而是把它留给下一波 HOI4 pack 边界收口。

## 第九波补记（2026-04-03）
- 已完成：`tools/build_hoi4_scenario.py` 现在会为 HOI4 场景正式写出 `runtime_topology.topo.json`、`runtime_topology.bootstrap.topo.json`，并把 `runtime_topology_url`、`runtime_bootstrap_topology_url`、`startup_topology_url`、`city_overrides_url`、`capital_hints_url` 一次性补进 manifest；builder 默认值也按 `scenario_id` 解析，不再把 `hoi4_1939` 写成 `HOI4 1936`。
- 已完成：重新生成并 check-in `data/scenarios/hoi4_1936` 与 `data/scenarios/hoi4_1939`；其中 `hoi4_1939` 额外重跑了 `tools/build_scenario_chunk_assets.py --scenario-dir data/scenarios/hoi4_1939`，`runtime_meta.json`、`mesh_pack.json` 和 chunk sidecar 已切到 scenario-local runtime topology。
- 已完成：补齐 `data/scenario-rules/hoi4_1939.manual.json` 里缺失的中国 warlord owner-layer 规则，并把 `data/scenarios/expectations/hoi4_1939.expectation.json` 的 `CHI.feature_count` 更新到当前真实值 `1783`；现在 `hoi4_1936` / `hoi4_1939` 的 shared strict 和 HOI4 domain checker 都能通过。
- 已完成：`.github/workflows/peripheral-contract-review.yml` 已按双场景 matrix 覆盖 `hoi4_1936` / `hoi4_1939` 的 shared/domain review，仍保持 non-blocking。
- 已验证：
  - `python -m py_compile tools/build_hoi4_scenario.py tests/test_scenario_contracts.py tests/test_check_hoi4_scenario_bundle.py`
  - `python tools/build_hoi4_scenario.py --scenario-id hoi4_1936 --skip-atlas`
  - `python tools/build_hoi4_scenario.py --scenario-id hoi4_1939 --skip-atlas`
  - `python tools/build_scenario_chunk_assets.py --scenario-dir data/scenarios/hoi4_1939`
  - `python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/hoi4_1936 --report-path .runtime/reports/generated/hoi4_1936.strict_contract_report.json`
  - `python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/hoi4_1939 --report-path .runtime/reports/generated/hoi4_1939.strict_contract_report.json`
  - `python tools/check_hoi4_scenario_bundle.py --scenario-dir data/scenarios/hoi4_1936 --report-dir .runtime/reports/generated/scenarios/hoi4_1936`
  - `python tools/check_hoi4_scenario_bundle.py --scenario-dir data/scenarios/hoi4_1939 --report-dir .runtime/reports/generated/scenarios/hoi4_1939`
  - `python -m unittest tests.test_check_hoi4_scenario_bundle tests.test_scenario_contracts -q`
- 剩余风险：这一波只把 HOI4 pack completeness 收平，没有顺手推进 transport 前端迁移，也没有把 `peripheral-contract-review.yml` 接进 blocking deploy gate；这两件事仍应留在后续外围 contract 波次。
## 第十波补记（2026-04-03）
- 已完成：新增 `js/ui/transport_workbench_manifest_variants.js`，把 transport workbench 的 shared variant 解析统一成 `default_variant` / `variants` 唯一运行时契约；`port`、`industrial_zones` 和 `toolbar` 已全部改为复用这一个 helper，不再读取 `coverage_variants`、`distribution_variants`、`default_coverage_tier`、`default_distribution_variant`。
- 已完成：`js/ui/transport_workbench_port_preview.js`、`js/ui/transport_workbench_industrial_zone_preview.js`、`js/ui/toolbar.js` 已收口到 shared manifest v1；`config.coverageTier` 和 `config.variant` 两个现有 UI 配置名保持不变，变的只是 manifest 读取源。
- 已完成：补了 `tests/test_transport_workbench_manifest_runtime_contract.py` 静态 contract 测试和 `tests/e2e/transport_workbench_industrial_variants.spec.js` focused industrial e2e；现有 `tests/e2e/transport_workbench_port_coverage_tiers.spec.js` 回归继续通过。
- 已验证：
  - `node --check js/ui/transport_workbench_manifest_variants.js`
  - `node --check js/ui/transport_workbench_port_preview.js`
  - `node --check js/ui/transport_workbench_industrial_zone_preview.js`
  - `node --check js/ui/toolbar.js`
  - `node --check tests/e2e/transport_workbench_industrial_variants.spec.js`
  - `node --check tests/e2e/transport_workbench_port_coverage_tiers.spec.js`
  - `python -m unittest tests.test_transport_workbench_manifest_runtime_contract -q`
  - `python -m unittest tests.test_startup_shell -q`
  - `python -m unittest tests.test_transport_manifest_contracts -q`
  - `node node_modules/@playwright/test/cli.js test tests/e2e/transport_workbench_port_coverage_tiers.spec.js tests/e2e/transport_workbench_industrial_variants.spec.js --reporter=list --workers=1`
- 剩余风险：transport 前端这波已经切到 shared-only 读取，但 manifest 里的 legacy variant 字段还保留着；下一波如果继续收外围 contract，可以单独决定是否删除 legacy 字段，并把 `transport-manifest-review` 往 blocking gate 推进一步。

## 第十一波补记（2026-04-03）
- 已完成：`tools/build_transport_workbench_japan_ports.py` 和 `tools/build_transport_workbench_japan_industrial_zones.py` 已停止产出 `default_coverage_tier` / `coverage_variants` / `default_distribution_variant` / `distribution_variants`，shared `default_variant` / `variants` 现在是 transport builder 的唯一 variant 输出契约。
- 已完成：`data/transport_layers/japan_port/manifest.json` 与 `data/transport_layers/japan_industrial_zones/manifest.json` 已去掉 legacy variant 字段；`map_builder/transport_workbench_contracts.py` 也从 shared/legacy 对照校验改成了 shared-only 校验，manifest 里只要再出现 legacy variant 字段就会直接报错。
- 已完成：新增 `.github/workflows/transport-contract-required.yml`，以轻量 required gate 形式运行 transport manifest validator 与 `tests.test_transport_manifest_contracts`、`tests.test_transport_workbench_manifest_runtime_contract`；没有把 Playwright 或 deploy workflow 一起绑进来。
- 已验证：`python -m py_compile map_builder/transport_workbench_contracts.py tools/check_transport_workbench_manifests.py tools/build_transport_workbench_japan_ports.py tools/build_transport_workbench_japan_industrial_zones.py tests/test_transport_manifest_contracts.py`
- 已验证：`python -m unittest tests.test_transport_manifest_contracts tests.test_transport_workbench_manifest_runtime_contract -q`
- 已验证：`python tools/check_transport_workbench_manifests.py --root data/transport_layers --report-path .runtime/reports/generated/transport_workbench_manifest_report.json`
- 剩余风险：`peripheral-contract-review.yml` 里仍保留 transport review job，所以短期内会和新的 required gate 有一层重复；这一波刻意没有顺手做 workflow 去重。下一波更自然的是单独收 HOI4 gate，或者再回头把外围 review workflow 做语义瘦身。
