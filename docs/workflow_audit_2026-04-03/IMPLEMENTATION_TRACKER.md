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
