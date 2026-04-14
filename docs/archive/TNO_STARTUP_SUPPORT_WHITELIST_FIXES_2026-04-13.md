# TNO startup support whitelist follow-up fixes 2026-04-13

## 目标
- 修复 whitelist 正式接入后暴露的 3 个 review 问题
- 保持 startup support workflow 对 TNO 和非 TNO scenario 都可靠

## 实施清单
- [x] 修复 startup changed-domain 未重跑 support stage
- [x] 去掉 build_startup_bootstrap_assets.py 的 TNO-specific whitelist 默认泄漏
- [x] 让 startup support audit 在未传 whitelist 时保持 scenario-scoped
- [x] 补测试并跑回归
- [x] 归档

## 进度记录
- 2026-04-13：`map_builder/scenario_rebuild_planner.py` 已把 `startup` changed-domain 改为：
  - `startup_support_assets`
  - `startup_bundle_assets`
  并同步 publish targets。
- 2026-04-13：`tools/build_startup_bootstrap_assets.py` 不再硬编码 TNO whitelist 默认值；现在默认会按 `startup_locales_output_path.parent/derived/startup_support_whitelist.json` 做 scenario-scoped 推断，找不到就不用 whitelist。
- 2026-04-13：`tools/audit_startup_support_family.py` 在未显式传 whitelist 时，也改为 scenario-scoped 推断，不再无条件吃 TNO whitelist。
- 2026-04-13：已补：
  - `tests/test_scenario_rebuild_planner.py`
  - `tests/test_startup_bootstrap_assets.py`

## 本轮验证
- `python -m py_compile tools/build_startup_bootstrap_assets.py tools/audit_startup_support_family.py map_builder/scenario_rebuild_planner.py tests/test_startup_bootstrap_assets.py tests/test_scenario_rebuild_planner.py`
- `python -m unittest tests.test_startup_bootstrap_assets tests.test_scenario_rebuild_planner -q`
- `python -m unittest tests.test_startup_bootstrap_assets tests.test_startup_shell tests.test_dev_server tests.test_scenario_rebuild_planner tests.test_scenario_resources_boundary_contract -q`
- `python tools/audit_startup_support_family.py --scenario-dir data/scenarios/tno_1962 --base-topology data/europe_topology.json --full-locales data/locales.json --full-geo-aliases data/geo_aliases.json --full-runtime-topology data/scenarios/tno_1962/runtime_topology.topo.json --report-path .runtime/reports/generated/scenarios/tno_1962_startup_support_audit.json`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`

## 结论
- 这 3 个 review 问题已经修复。
- startup support 正式瘦身链现在不会再把 TNO 的 whitelist 默认泄漏到其他 scenario，也不会再让 whitelist-only 改动静默漏过 startup_support_assets。
