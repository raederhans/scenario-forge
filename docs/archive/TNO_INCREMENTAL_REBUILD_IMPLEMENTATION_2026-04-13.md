# TNO 增量重建实施记录 2026-04-13

## 目标

- 让 `tno_1962` 的海洋/地名相关改动默认走局部重建，不再把 `stage all` 当日常开发入口
- 补一套共享 rebuild planner，让 CLI 和编辑器侧都走同一套“变更域 -> stage 链”规则
- 先收口重建边界，不在这一轮顺手改运行时 shipped 文件格式

## 实施清单

### 1. 现状收口
- [x] 读取 `lessons learned.md`
- [x] 复核现有 stage / checkpoint / publish 结构
- [x] 在 docs 留档本轮计划

### 2. 重建边界
- [x] 新增 `water_state` stage，并从现有 `countries` 重阶段里拆出水域相关产物
- [x] 让 `runtime_topology` 同时依赖 `countries + water_state`
- [x] 保持 `write_bundle` 为 publish-only，`chunk_assets` 为显式下游

### 3. 共享 planner
- [x] 新增共享 rebuild planner
- [x] 支持 `political / water / geo-locale / startup / chunk / full` 变更域
- [x] 记录 stage 级输入签名，命中时跳过不必要 stage

### 4. 入口接入
- [x] `tools/patch_tno_1962_bundle.py` 接入 planner
- [x] `tools/dev_server.py` 的相关保存链接入 planner
- [x] 补对应单测/集成测试

### 5. 收尾
- [x] 串行跑必要验证
- [x] 做一次 review / 查 bug / 第一性原理复核
- [x] 如有必要，更新 `lessons learned.md`
- [ ] 完成后移入 `docs/archive/`

## 进度记录

- 2026-04-13：已完成第一轮只读审计，确认当前仓库已经有 stage/checkpoint/build session 雏形，但团队近期海洋工作流仍在反复执行 `tools/patch_tno_1962_bundle.py --stage all --publish-scope all --refresh-named-water-snapshot`，单次后台日志约 28~29 分钟。
- 2026-04-13：已确认第一波实施范围锁定为“重建边界 + 共享 planner + CLI/编辑器接入”，不把 coarse chunk / bootstrap topology / shipped 体积瘦身混进本轮。
- 2026-04-13：已完成代码落地：`map_builder/contracts.py` 新增 `water_state` stage；`map_builder/scenario_bundle_platform.py` 新增 water stage checkpoint 读写；`tools/patch_tno_1962_bundle.py` 拆出 water stage、接入 changed-domain planner、记录 stage signatures；`tools/dev_server.py` 的 TNO geo-locale 保存改用共享 planner target。
- 2026-04-13：已完成验证：
  - `python -m py_compile map_builder/scenario_build_session.py map_builder/scenario_rebuild_planner.py map_builder/scenario_bundle_platform.py tools/patch_tno_1962_bundle.py tools/dev_server.py tests/test_scenario_build_session.py tests/test_scenario_rebuild_planner.py tests/test_tno_bundle_builder.py tests/test_dev_server.py`
  - `python -m unittest tests.test_scenario_build_session tests.test_scenario_rebuild_planner tests.test_tno_bundle_builder tests.test_dev_server -q`
- 2026-04-13：复核结论：第一波先解决“默认不再走全链”和“海洋 stage 可独立命中复用”，没有顺手改 shipped bundle 形态；`bootstrap topology` / snapshot / coarse chunk 瘦身继续留在下一波。
