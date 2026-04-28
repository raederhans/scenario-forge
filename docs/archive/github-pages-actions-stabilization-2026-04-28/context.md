# Context

2026-04-28
- 已读取 AGENTS 指令、ultrawork skill、docs/shared/agent-tiers.md、lessons learned.md。
- lessons leanrned.md 文件不存在，实际教训文件为 lessons learned.md。
- 当前 build_pages_dist.py 会复制 data/ 整体；本地 data 内有多个大型 GeoTIFF/源压缩包。
- 已将 APP_SHARED_DIRS 从全量 data 改成显式 runtime data allowlist。
- Pages dist manifest 写入 dist/pages-dist-manifest.json，size gate 为 900 MiB。
- pr-verify 已拆成 pr-verify-fast 与 pr-verify-smoke；smoke 独立安装 Playwright。
- perf gate 已加入 concurrency、浅拉取、npm/Chromium cache、失败 artifacts、classifier 补齐和 action SHA pin。
- scenario/transport workflow 改为 always-run wrapper，内部 classifier 决定重活或 fast success。

## Verification
- python -m py_compile tools/build_pages_dist.py tools/check_min_ci_requirements.py 通过。
- python tools/check_min_ci_requirements.py 通过。
- 
pm run verify:test:e2e-layers 通过。
- python -m unittest tests.test_pages_dist_startup_shell tests.test_map_renderer_interaction_border_snapshot_orchestration_contract tests.test_perf_gate_contract -q 通过，21 tests。
- 
pm run verify:pages-dist 通过，dist 总大小 882.85 MiB。
- PyYAML 本地不可用，workflow YAML 只做了人工结构检查。

## Review follow-up 2026-04-28
- 修复 reviewer 指出的 Pages allowlist 漏发：保留 industrial_zones.open.preview.geojson，继续排除 full open 包。
- 加入默认 detail topology data/europe_topology.na_v2.json，避免 full/detail source 默认请求缺席。
- 为保持 Pages 低于 1GB，移除前端无运行时引用的 data/i18n/ 发布；size gate 调整到 950 MiB，验证产物为 945.85 MiB。
