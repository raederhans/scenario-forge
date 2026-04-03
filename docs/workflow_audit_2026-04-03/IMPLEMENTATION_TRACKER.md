# workflow audit 2026-04-03 实施追踪

日期：2026-04-03

## 当前波次

第一波只收主线边界，不做长期兼容桥：

1. 场景上下文与写事务入口下沉到 `map_builder`
2. scenario lock 改成 owner-aware，并补事务继承语义
3. `start_dev` 默认只起服务，完整 rebuild 改成显式 `full`
4. 删除 `init_map_data.py` 中未再使用的旧总控 `_legacy_main_impl()`

## 工作包状态

| 工作包 | 状态 | 说明 |
| --- | --- | --- |
| 场景上下文入口下沉 | 已完成 | 新增 `map_builder/scenario_context.py`，并且 `tools/dev_server.py` 已切到共享 scenario context 实现 |
| scenario owner lock 收口 | 已完成 | `map_builder/scenario_locks.py` 已引入 `thread_id`、`transaction_id` 和同线程事务继承语义，并补了定向单测 |
| publish/materialize 服务接线 | 部分完成 | `scenario_publish_service.py` 已拔净对 `tools/dev_server.py` 的直接依赖；`scenario_materialization_service.py` 仅剩 district/political 相关业务 helper 仍依赖 `dev_server` |
| `start_dev` 默认行为收口 | 已完成 | 默认不再先跑 `build_data.bat`，只有 `full` 显式重建 |
| 删除 `init_map_data.py` 死分支 | 已完成 | `_legacy_main_impl()` 已整体删除，保留 `main()` orchestrator 入口 |

## 已完成验证

- `python -m py_compile map_builder/scenario_context.py map_builder/scenario_locks.py map_builder/scenario_materialization_service.py map_builder/scenario_publish_service.py init_map_data.py`
- `python -m py_compile tools/dev_server.py`
- `python -m unittest tests.test_publish_scenario_build -q`
- `python -m unittest tests.test_publish_scenario_outputs -q`
- `python -m unittest tests.test_scenario_materialization_service -q`
- `python -m unittest tests.test_dev_server.DevServerTest.test_load_scenario_context_allows_shared_releasable_catalog_under_data_dir tests.test_dev_server.DevServerTest.test_load_scenario_context_allows_geo_locale_builder_under_tools_dir tests.test_dev_server.DevServerTest.test_load_scenario_context_rejects_releasable_catalog_outside_allowed_roots tests.test_dev_server.DevServerTest.test_load_scenario_context_rejects_geo_locale_builder_outside_allowed_roots tests.test_dev_server.DevServerTest.test_apply_shared_district_template_payload_reloads_context_after_acquiring_transaction_lock -q`

## 本轮结论

- 第一波已经把最容易产生重复边界的入口先收住：默认启动链、旧总控、共享 scenario context、service 对 `dev_server` 的反向依赖、scenario lock 语义。
- `tools/dev_server.py` 和 `scenario_publish_service.py` 现在都已经接到共享 context 边界，不再维持双份锁/路径校验实现。
- `scenario_materialization_service.py` 还没有彻底脱离 `dev_server`，但剩下的是业务语义，不再是路径、快照、时间戳、事务写入这类通用 helper。

## 剩余风险

- `scenario_materialization_service.py` 中 district / political materialization 的业务 helper 仍挂在 `dev_server`，下一步要决定是下沉到 `map_builder`，还是暂时接受这层依赖继续存在。
- `tools/patch_tno_1962_bundle.py` 里的 checkpoint build lock 还没有同步升级到 owner-aware 语义，锁边界尚未完全统一。
- 这一波没有进入 publish `plan + commit`，也还没有开始 startup 单链路收口，所以 checkpoint / publish / startup 三段边界仍旧是下一波主任务。

## 下一步

1. 决定 `scenario_materialization_service.py` 剩余业务 helper 的归属，再继续拔净对 `dev_server` 的依赖。
2. 收 `tools/patch_tno_1962_bundle.py` 的 checkpoint build lock，使锁语义和 scenario lock 完全统一。
3. 第二波在 `publish plan + commit` 和 `startup 单链路` 之间二选一，优先收真正还会继续制造重复边界的那条主链。
