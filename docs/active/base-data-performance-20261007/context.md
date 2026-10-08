# 整合上下文

工作树：`C:/Users/raede/.codex/worktrees/base-data-perf-integration/mapcreator`。分支：`codex/base-data-performance-20261007`。主目录 `C:/Users/raede/Desktop/dev/mapcreator` 的混合 WIP 保留原状。

源码提取基线：主目录 `.runtime/tmp/base-data-optimization-20261007/baseline/`；第二、三批备份和结果报告用于范围核对。提取使用 upstream / batch-start / performance-batches 三方文本合并，避免覆盖远端更新或搬入旧 WIP。

主代理独占所有 Git 写入、测试、构建及 localhost 服务；数据审计代理只读，不启动共享进程。整合临时输出和命令日志保存在本工作树 `.runtime/tmp/base-data-delivery/`。后续长命令在启动前记录完整命令、资源、日志及终止条件。

远端 required checks：`transport-contract-required`、三个 `strict-scenario-contract-review`、`perf-gate`、`PR Verify Required`，且要求分支跟上 main。最终检查和合并以 GitHub 回执为准。

2026-10-07：已提取 44 个源码/测试/工具文件。发现启动 Worker 的 gzip 资源契约和世界粗层 TopoJSON wire 格式与旧开发基线不同，正定向整合。实际 TNO 资产不得从旧工作区复制，必须保留最新主线地图修复后重新应用。

进程登记：root 在本工作树运行 `npm ci --no-audit --no-fund`；独占本工作树 `node_modules`，日志 `.runtime/tmp/base-data-delivery/npm-ci.log`，无端口。退出码 0 为成功；非零停止并诊断，不启动重复安装。子代理仅获授权各自短隔离 Worker / Python 单元检查，不运行共享构建或浏览器。

npm 安装已成功。root 随后运行 `node .runtime/tmp/base-data-delivery/run-node-targets.cjs`，目标 27 个文件列于同目录 `node-targets.json`；日志 `node-targets.log`，无端口，240 秒上限，退出码 0 且无失败为通过。Worker 专属测试由限定代理单独完成；数据生成与浏览器尚未启动。

启动协议决策：最新主线已有覆盖更广、buffer 更少的 `geo-f64-v2`，保留该协议及 runtime bootstrap 行为，不新增本任务开发时的平行 `startup-f64-v1`。只补有价值的普通克隆回退和取消验证，原主目录开发文件原样保留。

root 数据生成命令：`node tools/run_python.mjs -u .runtime/tmp/base-data-delivery/apply-world-lod.py`，工作目录为本工作树，`PYTHONPYCACHEPREFIX=.runtime/python/pycache`；日志 `world-lod-apply.log`。独占 9 个 TNO 派生资产，原始文件备份在 `data-baseline/`；不启动并行几何构建或浏览器。成功条件为退出码 0、实际组 union/外周及要素身份/属性/部件/孔洞/误差断言通过、212 个其他分块与权威输入摘要不变。无进一步减点则保留主线数据；失败停止并核对已写入阶段，不重复执行脚本。

root 静态验证命令：`node .runtime/tmp/base-data-delivery/run-static.cjs`，逐项执行 architecture、state-write、test-imports、portfolio、route-schema 检查；各项日志在同目录 `<name>.log`，单项上限 120 秒，无端口或数据写入。成功条件为全部退出码 0。

数据应用已通过：67 个真实组 union/外周不变，1,027 个要素优化，12,036 要素与 29,722 部件保持；坐标 1,984,563→1,914,541，wire 50,788,849→49,619,328 字节。其他 212 分块和 13 权威输入不变。完整证据见 `world-lod-applied.json`。

root 数据检查命令：`node .runtime/tmp/base-data-delivery/run-data-checks.cjs`，串行 catalog 重建、实际分块/加拿大/TopoJSON/catalog 契约、TNO strict、data health、Pages source graph。具体参数在脚本中固定；各项日志同目录 `<name>.log`，单项 300 秒上限，无端口；首个非零停止。架构预算两个 owner 超限正做职责提取，不放宽预算；其余四项静态检查已通过。

数据检查全部完成：31 个 Python 数据契约通过，TNO strict / catalog 构建 / Pages source graph 通过，data health 0 错误、13 警告；catalog 内容未变化。架构职责提取完成，相关 Node 121/121、Python 5/5、架构检查通过；全程未放宽预算。有限源码整合审查未发现阻断问题。

root 产物验证命令：`node .runtime/tmp/base-data-delivery/run-pages-checks.cjs`；用 `--output-root .runtime/tmp/base-data-delivery/pages-artifact` 构建全新 Pages artifact，随后同一 `SCENARIO_FORGE_PAGES_ARTIFACT_ROOT` 下运行 startup shell 与两个 renderer inventory 检查。各项日志同目录，300 秒单项上限；禁止并行构建/浏览器。成功为全部退出码 0，否则保留产物和日志诊断。

Pages artifact 构建、startup shell 与 renderer inventory 检查已全部通过。root 现在独占 localhost:8006，运行 `node tools/run_python.mjs -u tools/dev_server.py --port 8006`，设置 `MAPCREATOR_OPEN_BROWSER=0`、`MAPCREATOR_RUNTIME_ROOT=.runtime/tmp/base-data-delivery` 和本工作树 pycache；PID 回执在该 runtime 的 `dev/active_server.json`。浏览器依次运行 `.runtime/tmp/base-data-delivery/interaction.cjs` 与 `benchmark.cjs integrated delivery`，各自最多 120 秒、各一截图，不并行CPU密集任务。成功需真实画布编辑/历史与覆盖断言、当前帧确认、切换完成且无页面/网络/控制台异常。结束后核对 PID/命令/工作目录，仅关闭本次服务。

原生深缩放/选择和画布填色/撤销/重做已通过：完整集合 12,276、交互集合 12,214，全部 51 个视觉 shell 保留且不参与命中。旧 delivery 探针在直接调用非动画 `resetZoomToFit()` 后等待新画面超时；诊断确认相机已复位但没有安排重绘，当前主线源码在同一组数据上复现相同行为。该复位入口本身未被本批改动，产品 toolbar/shortcut 使用 `animate: true`。保留失败证据于 `benchmark-{integrated-diagnostic,upstream-diagnostic}.json`，改用真实键盘 `0` 路由的 `benchmark-ui.cjs integrated-ui delivery` 继续验收，不修改生产行为、超时或帧守卫。

较新主线的数据更大，重复编辑时共享压力仍可能淘汰导航保留项，不能沿用旧工作区“上传量减半”的测量到新主线；本次仅声明生命周期/预算正确及实际功能验证，后续性能收益以匹配当前输入的测量为准。

最终真实快捷键 delivery 流程已完成，含 HOI4 切换到当前完整帧。`benchmark-integrated-ui.json` 无页面异常，记录一次 resetScenarioChunkRequests 取消 outgoing bundle 时的 AbortError 警告；chunk_payload_loader / chunk_runtime / scenario_apply_pipeline 均相对主线未改动，incoming 场景最终 idle/current-frame 确认通过。未新增 console allowlist 或放宽检查。

PR #214 首轮 CI 发现验证清单仍引用整合时已弃用的 `startup_response_transport.test.mjs`；主线已采用 `geo-f64-v2` 和既有 whole-message transfer 测试。移除这一悬空清单项，保留 startup-worker-transfer、geometry-transfer-codec 与新增取消/回退行为覆盖；随后重新检查验证清单、规划中的实际测试路径和相关行为测试，并等待修正提交的远端必需检查。

第二轮 CI 通过该位置后发现新的 world LOD 测试缺少重依赖分组登记；已按其 Shapely 导入加入既有 `geo_stack` 分组。root 在交付工作树独占执行 `node tools/run_adaptive_tests.mjs --history-base origin/main --execute --defer-main-thread`，使用既有 Pages artifact、独立 pycache 和本次 runtime 输出；无本地浏览器/构建并发，成功条件为全部选中的 child-safe 检查完成且退出码 0。最终远端检查仍须绑定后续提交。

该测试同时登记到现有几何契约路由。扩展检查发现水域缓存静态契约仍匹配旧的 `parts` 引用和仅整组可见时取缓存的写法；更新为防御性部件快照及优先复用身份/投影合格的完整路径，保持逐部分/Canvas 回退约束。相关行为与场景契约 125/125 通过；完整受影响检查最终退出 0，共执行 145 条命令，56 条 main-thread 命令依既有策略延后，不将其计作本轮已通过。结果为 `affected-contracts.json`，前次失败日志保留。
