# TNO startup support formal slimming 2026-04-13

## 目标
- 将 startup support 白名单正式接入 builder
- 正式重建 `locales.startup.json / geo_aliases.startup.json`
- 保持默认启动和 scenario contract 不回退

## 实施清单
- [x] 将 whitelist 文件接入 startup support builder
- [x] 将 whitelist 文件纳入 startup_support_assets stage signature
- [x] 正式生成 scenario-scoped whitelist 输入文件
- [x] 重建正式 startup support files
- [x] 跑定向测试与 scenario contract
- [x] 做真实启动 smoke
- [x] 留档归档

## 进度记录
- 2026-04-13：`tools/build_startup_bootstrap_assets.py` 已支持 `--startup-support-whitelist`，并默认指向 `data/scenarios/tno_1962/derived/startup_support_whitelist.json`。
- 2026-04-13：builder 现在会：
  - 对 locales：保留 `静态必需 key ∪ 白名单 locale_keys`
  - 对 aliases：保留 `target 在最终 locale key 集内` 且在白名单 alias_keys 内的项
- 2026-04-13：`tools/patch_tno_1962_bundle.py` 的 `startup_support_assets` stage 已传入 scenario whitelist。
- 2026-04-13：`map_builder/scenario_rebuild_planner.py` 的 `startup_support_assets` stage signature 已纳入 `derived/startup_support_whitelist.json`。
- 2026-04-13：正式生成 `data/scenarios/tno_1962/derived/startup_support_whitelist.json`。
- 2026-04-13：正式重建了：
  - `data/scenarios/tno_1962/locales.startup.json`
  - `data/scenarios/tno_1962/geo_aliases.startup.json`
- 2026-04-13：真实启动 smoke（8015 端口）已通过，TNO 默认 startup 能进入初始与 detail promotion 阶段，没有立即崩。

## 本轮验证
- `python -m py_compile tools/build_startup_bootstrap_assets.py tools/audit_startup_support_family.py tools/patch_tno_1962_bundle.py map_builder/scenario_rebuild_planner.py tests/test_startup_bootstrap_assets.py tests/test_scenario_rebuild_planner.py`
- `python -m unittest tests.test_startup_bootstrap_assets tests.test_scenario_rebuild_planner -q`
- `python -m unittest tests.test_startup_bootstrap_assets tests.test_startup_shell tests.test_dev_server tests.test_scenario_rebuild_planner tests.test_scenario_resources_boundary_contract -q`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`
- 真实启动 smoke：
  - `node tools/capture_startup_support_sample.js --base-url http://127.0.0.1:8015/app/ --scenario-id tno_1962 --language en --sample-label formal-post-slim-en --mode default`

## 结果摘要
- 正式 support 文件现在变成：
  - `locales.startup.json`: `44170 -> 741` keys，约 `3.71 MB -> 147 KB`
  - `geo_aliases.startup.json`: `48351 -> 197` aliases，约 `2.44 MB -> 8.6 KB`
- 正式启动 smoke 的 key-usage 结果：
  - `queryKeyCount = 445`
  - `directLocaleKeyCount = 96`
  - `aliasKeyCount = 10`
  - `aliasTargetKeyCount = 10`
  - `missKeyCount = 339`

## 结论
- 这轮已经完成正式 startup support slimming，并且通过了定向测试、scenario contract 和真实启动 smoke。
- 但从 post-slim 样本看，`missKeyCount` 仍然不低，说明这版白名单仍然是“谨慎但偏激进”的第一版。
- 下一轮如果继续收口，不应再扩大裁剪力度，而应基于 post-slim 真实样本回补缺失 key，再做第二版白名单校正。
