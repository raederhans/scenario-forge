# TNO startup support whitelist v2 校正 2026-04-13

## 目标
- 修正 whitelist generator 只能从当前 slimmed support 取交集、无法回补已裁 key 的问题
- 在 post-slim 状态下重新采集多样本 startup support key-usage
- 生成第二版 whitelist，重建正式 `locales.startup.json / geo_aliases.startup.json`
- 保持 startup contract 和默认启动不回退

## 实施清单
- [x] 修正 whitelist generator 输入边界，支持从 full locales / full geo aliases 回补候选 key
- [x] 补 generator 定向测试
- [x] 运行 post-slim 多样本采集并重跑 whitelist v2
- [x] 重建正式 startup support 文件并跑 audit / contract / smoke
- [x] 复核后归档

## 进度记录
- 2026-04-13：开始接手第二版 whitelist 校正，已确认当前正式 support 为 `741 locales / 197 aliases`，post-slim 默认样本仍有 `missKeyCount = 339`。
- 2026-04-13：`tools/generate_startup_support_whitelist.py` 已新增：
  - `--full-locales`
  - `--full-geo-aliases`
  - `--baseline-whitelist`
  现在第二版生成不再只和当前 slimmed support 取交集，也不会把已有 baseline whitelist 反向裁掉。
- 2026-04-13：`tests/test_startup_bootstrap_assets.py` 已补两类护栏：
  - slimmed support 里没有、但 full locales/full aliases 里存在的 key 可以回补
  - baseline whitelist 会保留，post-slim 样本只负责增量回补，不负责再次裁剪
- 2026-04-13：已在 post-slim 状态下重新采集 5 份样本：
  - `post-slim-v2-en-default`
  - `post-slim-v2-zh-default`
  - `post-slim-v2-en-alias-probe`
  - `post-slim-v2-en-tooltip-probe`
  - `post-slim-v2-en-inspector-probe`
- 2026-04-13：已生成：
  - `.runtime/reports/generated/scenarios/tno_1962_startup_support_whitelist_candidate_post_slim_v2.json`
  - `.runtime/reports/generated/scenarios/tno_1962_startup_support_whitelist_v2.formal.json`
- 2026-04-13：已正式更新 `data/scenarios/tno_1962/derived/startup_support_whitelist.json`，并重建：
  - `data/scenarios/tno_1962/locales.startup.json`
  - `data/scenarios/tno_1962/geo_aliases.startup.json`
- 2026-04-13：v2 正式重建后：
  - `whitelist locale_keys: 342 -> 713`
  - `whitelist alias_keys: 222 -> 222`
  - `locales.startup.json: 741 -> 1028` keys
  - `geo_aliases.startup.json: 197 -> 197` aliases
- 2026-04-13：正式默认 smoke `formal-post-slim-v2-final-en` 已通过，`missKeyCount` 从 `339 -> 250`。

## 本轮验证
- `python -m py_compile tools/generate_startup_support_whitelist.py tools/build_startup_bootstrap_assets.py tools/audit_startup_support_family.py map_builder/scenario_rebuild_planner.py tests/test_startup_bootstrap_assets.py tests/test_scenario_rebuild_planner.py`
- `python -m unittest tests.test_startup_bootstrap_assets tests.test_scenario_rebuild_planner tests.test_startup_shell tests.test_dev_server tests.test_scenario_resources_boundary_contract -q`
- post-slim 多样本采集：
  - `node tools/capture_startup_support_sample.js --base-url http://127.0.0.1:8015/app/ --scenario-id tno_1962 --language en --sample-label post-slim-v2-en-default --mode default`
  - `node tools/capture_startup_support_sample.js --base-url http://127.0.0.1:8015/app/ --scenario-id tno_1962 --language zh --sample-label post-slim-v2-zh-default --mode default`
  - `node tools/capture_startup_support_sample.js --base-url http://127.0.0.1:8015/app/ --scenario-id tno_1962 --language en --sample-label post-slim-v2-en-alias-probe --mode alias-probe`
  - `node tools/capture_startup_support_sample.js --base-url http://127.0.0.1:8015/app/ --scenario-id tno_1962 --language en --sample-label post-slim-v2-en-tooltip-probe --mode tooltip-probe`
  - `node tools/capture_startup_support_sample.js --base-url http://127.0.0.1:8015/app/ --scenario-id tno_1962 --language en --sample-label post-slim-v2-en-inspector-probe --mode inspector-probe`
- whitelist v2 生成：
  - `python tools/generate_startup_support_whitelist.py --scenario-id tno_1962 ... --full-locales data/locales.json --full-geo-aliases data/geo_aliases.json --baseline-whitelist data/scenarios/tno_1962/derived/startup_support_whitelist.json --output-path .runtime/reports/generated/scenarios/tno_1962_startup_support_whitelist_candidate_post_slim_v2.json`
- 正式 support 重建：
  - `python tools/build_startup_bootstrap_assets.py --base-topology data/europe_topology.json --full-locales data/locales.json --full-geo-aliases data/geo_aliases.json --runtime-topology data/scenarios/tno_1962/runtime_topology.topo.json --scenario-geo-patch data/scenarios/tno_1962/geo_locale_patch.json --runtime-bootstrap-output data/scenarios/tno_1962/runtime_topology.bootstrap.topo.json --startup-locales-output data/scenarios/tno_1962/locales.startup.json --startup-geo-aliases-output data/scenarios/tno_1962/geo_aliases.startup.json --startup-support-whitelist data/scenarios/tno_1962/derived/startup_support_whitelist.json --report-path .runtime/reports/generated/scenarios/tno_1962_startup_support_audit.json`
- `python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962`
- 正式 smoke：
  - `node tools/capture_startup_support_sample.js --base-url http://127.0.0.1:8015/app/ --scenario-id tno_1962 --language en --sample-label formal-post-slim-v2-final-en --mode default`

## 结论
- 这轮已经把第二版 whitelist 校正主链补齐了：现在可以基于 post-slim 样本回补已裁 key，而且不会顺手把 baseline whitelist 再裁掉。
- 默认启动 smoke 的 `missKeyCount` 已从 `339` 降到 `250`，说明这轮回补是有效的。
- 但缺口还没清零，下一轮如果继续推进，重点不该再放在 builder，而该放在：
  1. 补更多 post-slim 探针样本
  2. 分析剩余 `250` miss 里哪些应进入 startup support、哪些本来就不该在 startup 阶段承担
