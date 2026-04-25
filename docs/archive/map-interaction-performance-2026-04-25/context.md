# Context

2026-04-25 执行完成。

处理结果：
- `js/main.js`：post-ready task 增加 idle quiet window、单任务串行门、重任务分批启动；full interaction infra、context warmup、city warmup、visual warmup 避开刚缩放/拖动后的直接交互窗口。
- `js/core/map_renderer.js`：deferred secondary spatial / heavy border / chunk promotion infra 等路径增加交互 quiet gate；secondary spatial 完成后主动排 hit canvas rebuild；transformed frame 先 preflight 再清主 canvas；fallback frame 不再回写 last-good。
- `js/bootstrap/startup_bootstrap_support.js`：long-animation-frame 指标增加 boot/render/post-ready task 诊断字段。
- `ops/browser-mcp/editor-performance-benchmark.py`：benchmark 增加 runtime readiness gate、scenario readiness diagnostics、wheel anchor trace、post-idle drift 字段；修复 default_scenario/none 路径的 readiness 误判。

验证结果：
- `node --check js/main.js js/core/map_renderer.js js/bootstrap/startup_bootstrap_support.js` 通过。
- `python -m py_compile ops/browser-mcp/editor-performance-benchmark.py` 通过。
- `npm run test:node:scenario-chunk-contracts` 通过。
- `npm run test:node:perf-probe-snapshot-behavior` 通过。
- `npm run test:e2e:dev:scenario-chunk-runtime` 通过，3 passed。
- `npm run perf:gate` 通过，baseline `docs\perf\baseline_2026-04-20.json`。
- TNO quick benchmark 产物：`.runtime/output/perf/editor-performance-tno-quick-after-map-interaction.json`；wheel `blackFrameDelta=0`，`maxStableAnchorDriftPx=6.551`，`maxLongTaskMs=2819ms`。比探索期 42.5s long task 明显下降，但 wheel 后 final idle 仍受 exact/context render 影响，后续还能继续针对 contextBase/physical contours 拆片。

复核：
- 子代理 review 发现 6 个静态问题，已修复 post-ready 串行、idle timeout 保底、secondary spatial 后 hit canvas rebuild、fallback frame 回写、benchmark readiness、wheel post-idle drift。
- 第一性原理复核：本轮没有关闭图层或降低视觉质量，主要通过“把重任务放到用户交互 quiet window 后”和“避免清屏后才发现缓存不可用”提升直接交互稳定性。

2026-04-25 review follow-up：
- 修复 `post-ready-full-interaction-infra` callback 未返回 infra promise 的问题，active task 现在覆盖完整 chunked build 生命周期。
- 修复 `runPostReadyTaskCallback()` 对同步抛错和 async rejection 的处理，失败会集中 warn，并释放 active task 诊断槽。
- 已还原 `.omx` runtime state 修改，避免提交本机 session/metrics 噪音。
- 复验：`node --check js/main.js`、`npm run test:node:scenario-chunk-contracts`、`npm run test:node:perf-probe-snapshot-behavior`、`npm run test:e2e:dev:scenario-chunk-runtime` 均通过。
