# Worktree Registry

## 2026-10-05 PR 验证分流与双端上线

`C:/Users/raede/.codex/worktrees/pr-delivery-lanes/mapcreator` 使用 `codex/pr-delivery-lanes`，基于 `475bbbd8` 完成交付计划、局部 UI 分流、Pages 源码检查和性能观察通道。用户已授权第四步及本地/GitHub 上线，root 为唯一 Git 整合负责人；主工作区仍有其他任务 WIP，本次仅同步交付体系涉及的文件。required 检查、合并与部署以 PR/run 回执为准；工作树保留用于回归验证和上线核对。记录见 [pr-delivery-lanes/task.md](pr-delivery-lanes/task.md)。

## 2026-10-03 启动包预算与 Pages 交付修复

复用 `C:/Users/raede/.codex/worktrees/ocean-batch-refinement/mapcreator`，当前分支 `codex/pages-sample-startup-20261003`（后续分支，基于已合并 PR #204 的 `3470fdfc`）。修复提交 `e8609467` 将六个启动 gzip 无损压到原有 5,000,000byte 预算以内，同时修复旧性能基线对新版 wire 的读取和 Pages 陈旧断言；整合主线 `068f0b33` 的渲染性能更新，无产品代码冲突。55个 child-safe 检查组及本次相关数据、Pages、浏览器检查通过。主目录WIP保持原样，本工作树及 `.runtime/reports/generated/startup-budget/` 保留供复核。用户已授权合并推送，root为唯一Git交付负责人；最终必需检查、合并和部署结果以PR/run回执为准，六个线上包均低于5MB，最小余量37,000bytes；上一部署实际已发布，但在线示例导入smoke失败，后续修复标签轮廓分组CPU热点。详见[任务记录](ocean-batch-20261002/task.md)。

## 2026-10-02 七批海域细化、体积与性能整合

`C:/Users/raede/.codex/worktrees/ocean-batch-refinement/mapcreator` 使用分支 `codex/ocean-batch-refinement-20261002`，七批海域检查点`fc878761`已通过`61ab07bc`整合`faabcf81`主线。119个新增海域保留，启动gzip减少16.5%–17.0%，启动几何传输局部基准减少61.1%–67.6%；六场景strict、五项浏览器case和65项Pages测试通过，保留两项既有5MB预算失败。用户已授权优化后合并推送，root唯一负责Git交付；优化提交`f8334221`已推送，最终required checks与合并以[PR #202](https://github.com/raederhans/scenario-forge/pull/202)回执为准。主目录及其他工作树未归属改动保留，本工作树及`.runtime`实验/验证证据为后续复核保留。范围和验收见[任务记录](ocean-batch-20261002/task.md)。

## 2026-10-02 沿河重叠地块与内部接缝修复

`C:/Users/raede/.codex/worktrees/river-paint-integration/mapcreator` 使用 `codex/river-overlap-visibility`，基于 `bd6365ef` 修复七个重叠父地块的填色、命中及内部接缝可见性。前一轮 Wave6 经 PR #198 发布，覆盖 382 父 / 1,199 分区；Wave7 本地验收扩展至 389 父 / 1,276 分区，旧记录保持原样。覆盖顺序、轮廓遮挡和验收见 [重叠修复记录](river-overlap-repair/integration.md)。主工作区及其他工作树保持原所有权；本工作树及旧区域工作树为保存忽略的图集与几何审计而保留。最终提交、PR 检查、合并、发布和同步以 Git / GitHub 及 `.runtime/rv7/` 回执为准。

## 2026-10-01 第二批沿河地点准入

`codex/river-wave2-admission` 接入 12 地、43 分区的新包，保留旧包认证及旧项目范围。新增奥波莱、弗罗茨瓦夫、泸州、宜昌、兰州、乌海；不改变原行政 ID。39 项专项测试、19 项数据目录检查、真实页面全部分区填色及 43 次撤销/重做、像素和项目导入导出验证通过。Pages 构建和新资产发布检查通过，产物保留在独立工作树 `.runtime/reports/generated/river-next/pages-wave2/`。最终提交、PR 检查及合并状态以 Git / GitHub 回执为准。主目录及其他工作树继续保持原所有权。

## 2026-10-01 沿河试点定位与小分区操作

PR [#192](https://github.com/raederhans/scenario-forge/pull/192) 全部检查通过，于 2026-10-01 合并为 `81532208`；独立工作树已快进同步。后续分支为 `codex/river-wave2-admission`，已生成奥德河、长江、黄河六个新增地点的候选包：合计 12 地、43 分区，原六地记录保持一致，尚未启用新包。范围、复现命令、兼容边界与验收要求见 [下一批准入记录](river-paint-partitions-20260929/wave2-admission.md)。工作树继续保留候选审计及图像证据。

`C:/Users/raede/.codex/worktrees/river-paint-integration/mapcreator` 在 `codex/river-pilot-navigation` 上交付六地定位、分区列表及放大预览，提交 `1cec53b7`、`9bb07a53`。用户已授权推送和合并，然后开始下一批河段；本轮整合 `origin/main@e25b89ca` 的国家标签与地理修复，保留主目录及其他工作树改动。31 个分区的真实界面填色、连续撤销和重做证据保留在 `.runtime/browser/river-pilot-qa/`。该工作树继续用于合并后同步和下一批数据准入；最终远端状态以 PR 回执为准。

## 2026-09-30 沿河填色试点整合

`C:/Users/raede/.codex/worktrees/river-paint-integration/mapcreator` 接手云端分支 `codex/river-paint-partitions-p0-p2` 和 [PR #189](https://github.com/raederhans/scenario-forge/pull/189)，基于 `origin/main@bfedc6b8`。本地整合提交 `eab92f54` 修复 Pages 资源打包、浏览器清单、依赖图和验证路由，并完成沿河功能、几何、Pages 及浏览器验证。主目录 `main@28310add` 的既有未归属改动保留；本工作树作为同步后的独立入口及 `.runtime/reports/generated/river-integration/` 验证证据载体继续保留。最终检查、合并提交和主线状态以 PR 回执及 Git 为准，不能用旧开发运行结果替代最终提交的 required checks。


## 2026-09-28 全球测深整合

`C:/Users/raede/.codex/worktrees/bathymetry-merge/mapcreator` 使用分支 `codex/bathymetry-global-20260928`，基于 `origin/main@560d5007` 定向整合全球测深数据、后台解码、概览细节分级、海域覆盖绘制和测深界面状态。用户已授权合并推送；主工作区 `main@28310add` 的其他未归属改动保留。本工作树保留 `.runtime/reports/generated/bathymetry-integration/` 中的验证输出供复核和复用。最终提交、推送和受保护 main 的合并状态以此分支 GitHub PR 回执为准。

## 2026-09-28 交互连续性与首次窗口交付

`C:/Users/raede/.codex/worktrees/pan-zoom-integration/mapcreator` 当前分支为 `codex/interaction-continuity-20260928`，基于 `origin/main@291b5aa2`。用户已接受当前优化结果并授权合并推送，通过受保护 main 的 PR 检查交付。范围包括导航完整底图、相机呈现一致性、冷路径缓存和传输复用、首次窗口 Worker 准备，以及不启用候选资产的水体 LOD 诊断工具。主工作区及其他工作树的未归属改动保留。

目标测试与浏览器证据见 [任务记录](interaction-continuity-20260928/task.md) 和 [首次窗口记录](interaction-continuity-20260928/first-window.md)。首次窗口仍有等待的限制已明确，不将本次交付描述为完全消除卡顿。此工作树保留，以保存 `.runtime/browser/` 中的对照证据并供后续工作复用。提交、检查和合并状态以当前分支 GitHub PR 回执为准；原分支的旧条目仅作历史记录。

## 2026-09-28 缩放与平移性能整合

`C:/Users/raede/.codex/worktrees/pan-zoom-integration/mapcreator` 使用分支 `codex/pan-zoom-performance-20260928`，基于 `origin/main@5ee7712f` 定向整合本对话的缩放、平移覆盖修复及政治条目、概览帧、水域整理和空间索引复用。用户已授权合并推送；主工作区 `main@28310add` 的其他未归属改动保留。隔离工作树保留 `.runtime/tmp/pan-zoom-integration/` 中的验证输出，合并后继续保留供复核和复用。最终推送与受保护 main 的合并状态以本分支 GitHub PR 回执为准。

## 2026-09-27 现代剧本重建与剧本译名隔离

`C:/Users/raede/.codex/worktrees/scenario-names-merge/mapcreator` 使用分支 `codex/scenario-names-and-modern-rebuild`，基于 `origin/main@4a160b37` 定向整合现代国家地块、烈焰升腾配色、首都及 1936/1939/TNO 地名隔离修复。用户已授权合并推送；原主工作区 `main@28310add` 的其他未归属改动完整保留。本工作树的 `.runtime/reports/generated/scenario-delivery/` 保存重建、严格契约、首都行为及 Pages 构建结果，因此合并后保留供复核。最终提交、检查和合并状态以此分支的 GitHub PR 回执为准。

## 2026-09-27 运行时代码简化整合

`C:/Users/raede/.codex/worktrees/runtime-simplification/mapcreator` 使用分支 `codex/runtime-simplification-20260927`，基于 `origin/main@1afa55b7` 实施四批运行时简化。用户已授权解决剩余状态证明缺口并合并推送；通过受保护 main 的正常 PR 检查交付。原主工作区及其他工作树的未归属改动不在本次整合范围。验证、提交和远端回执见 [任务记录](runtime-simplification-20260927/task.md)。工作树保留以保存忽略的构建、浏览器及状态证明排查证据，不在本轮清理。

## 2026-09-27 性能优化整合

`C:/Users/raede/.codex/worktrees/performance-integration/mapcreator` 从远端 `main` 的 `b4f9089c` 建立，分支 `codex/performance-closeout-20260927`。本对话四轮性能改动从脏主工作区定向提取，保留远端海洋、UI 和昼夜更新。主工作区 `main` 及未归属 WIP 不变；精度扩展与旧 pr164 工作树不在本次清理范围。

验证及交付状态见 [性能整合任务](performance-closeout-20260927/task.md)。本工作树仍承担 PR 验证与运行证据，不在合并前清理；最终合并和推送以 GitHub 回执为准。

## 2026-09-26 外海细化整合

`C:/Users/raede/.codex/worktrees/ocean-refinement/mapcreator` 当前使用 `codex/ocean-refinement-next`，从已合并 PR #176 的主线 ea450a0c 开始第二轮外海细化：6 个海区、连接检查、层级定位及分级标签。主工作区既有 WIP 保留；新增标签、覆盖率和侧栏性能优化，本地验证完成，用户已授权经 PR 合并推送。工作树保留用于性能前后对比及几何证据复核，远端交付入口为 [PR #177](https://github.com/raederhans/scenario-forge/pull/177)，检查及合并状态以 GitHub 为准。记录见 [ocean-refinement-next-20260927](ocean-refinement-next-20260927/task.md)；上一轮回执保留在 [ocean-refinement-20260926](ocean-refinement-20260926/task.md)。


## 2026-09-26 地图清晰度与政治边界修复

`C:/Users/raede/.codex/worktrees/map-clarity/mapcreator` 使用 `codex/map-clarity-20260926`，基于 `2f4cb130` 实施显示密度、独立政治国界、线条层级与 TNO 阿尔及利亚源覆盖修复。主工作区的未归属 UI、昼夜与其他改动保留原样。本任务通过 [PR #174](https://github.com/raederhans/scenario-forge/pull/174) 的受保护 main 检查整合；最终推送和合并以该回执为准。工作树继续承担 localhost:8001 预览并保存 `.runtime` 中的修复前数据、候选及浏览器证据，因此合并后保留。记录见 [map-clarity-20260926](map-clarity-20260926/task.md)。

## 2026-09-26 编辑工作区 UI 整合

`C:/Users/raede/.codex/worktrees/editor-ui-merge-20260926/mapcreator` 使用分支 `codex/editor-ui-renewal-20260926`，基于 `origin/main@2e127eb4` 提取 UI 四阶段增量。主工作区的昼夜、渲染指标、启动管线等并行修改保留，不混入提交。隔离工作树用于构建、浏览器与合并验证，保留其 `.runtime` 运行证据供复核。任务记录见 [editor-ui-renewal-20260926](editor-ui-renewal-20260926/task.md)，最终推送、合并及部署状态以 Git/GitHub 回执为准。

## 2026-09-26 湖泊交互与显示整合

`C:/Users/raede/.codex/worktrees/lake-interaction-merge/mapcreator` 使用分支 `codex/lake-interaction-opt-in`，从主工作区提取湖泊交互开关、河湖样式协调与填色预览遮罩改动。主工作区仍有城市灯光并行修改，保持其分支、索引与工作文件不变。本工作树保留供合并后的差异复核，最终检查与合并状态以 Git/GitHub 回执为准。

## 2026-09-26 昼夜与现代夜光优化

`C:/Users/raede/.codex/worktrees/day-night-tiles/mapcreator` 使用 `codex/day-night-tiles` 隔离本次昼夜、夜光与性能改动。主工作区含其他 UI、水体和交通 WIP，保留原样，不在其中执行重置或整合。此工作树在合并后保留，用于复核 `.runtime/browser/day-night-tiles/` 的 Canvas 像素负对照和性能记录；远端提交及合并状态以该分支的 PR 回执为准。其他工作树不属于本次清理范围。

## 2026-09-25 所有权编辑退役整合

接手 [PR #162](https://github.com/raederhans/scenario-forge/pull/162)，在主工作区检出 `codex/visual-editing-boundary-p1-p2-20260924`，核对第一、二阶段实现并补齐 E2E 清单、依赖图与调色板边界测试。合并后主工作区回到 `main` 并快进同步；最终合并状态以 PR 回执及 Git 为准。其他两个工作树与未跟踪 `.playwright-mcp/` 保留，本轮不清理。

## 当前拓扑（2026-09-24）

这里只维护当前工作树与分支事实。任务、进程和验收状态的历史快照统一见任务记录或下方归档，不能把其中的“current”“clean”或“HEAD 相等”解释为今天的事实。

本轮接手“优化架构与数据性能”的两批交付，整合 PR #155、#156、#157、#158、#159、#161，并保留已合并 #160 的湖泊与河流改动。对应记录为 `precision-engineering-20260924.md`、`precision-raster-p1-20260924.md`、`precision-build-graph-p3-20260924.md`、`precision-resources-p3-20260924.md`、`precision-artifact-p4-20260924.md`、`precision-transport-lifecycle-p5-20260924.md`。主代理统一运行本地测试并负责合并；其他工作树、候选数据及 `.playwright-mcp/` 保留。最终主分支与部署状态以 Git/GitHub 回执为准；下表旧批次描述仅为入口历史。

| 当前入口 | 用途与边界 |
| --- | --- |
| `C:/Users/raede/Desktop/dev/mapcreator` | 主工作区；湖泊修复已通过 PR #151 进入主线。本轮收尾交付为 [PR #152](https://github.com/raederhans/scenario-forge/pull/152)，分支 `codex/precision-foundation-p0-p4-20260923`，见 [实现与收尾记录](precision-foundation-p0-p4-20260924.md)。合并后主工作区回到 `main`；当前 SHA、CI、合并与自动部署状态以 Git / GitHub 回执为准。保留既有未跟踪 `.playwright-mcp/`。 |
| `C:/Users/raede/.codex/worktrees/precision-expansion-20260922/mapcreator` | 保留工作树与分支 `codex/global-precision-scaling-20260922`，保存忽略的精度/县级候选和历史边界验收证据；这些 `.runtime` 产物未进入正式数据，后续适配仍需要它们，因此合并后不清理。代码交付基线 `382ce56744d3942a9097e1352c312a23bab0dbf9`，任务记录见 [global-precision-scaling-20260922](global-precision-scaling-20260922/task.md)。 |
| `C:/Users/raede/.codex/worktrees/showcase-map-quality/mapcreator` | 分支 `codex/showcase-release-contracts`；展示与导出交付已经通过 PR #147/#148 进入主线。本轮仅核对状态并通过 `origin/main` 整合，保留该工作树，不接管或清理其他任务的文件。 |
| `.playwright-mcp/` | 主工作区中的未跟踪、未归属内容；本轮按 WIP 保护规则保留，不把它当作可清理缓存。 |
| `.runtime/tmp/worktree-cleanup-20260917/recovery.md` | 本轮删除前的精确 branch/tip 恢复清单；属于忽略的本地运行证据，不参与产品提交。 |
| `.runtime/worktree-archives/russia-full-replacement-20260920/` | 俄罗斯工作树的文件保全清单、与主目录不同的 942 个文件副本及完整 `.runtime` 证据。 |

## 2026-09-20 精度与性能整合

俄罗斯工作树原 tip 为 `39098f4b7218e5d16085808564072224c72e287f`，没有独立提交。其全部交付改动已按文件与继承基线核对并迁入主目录；删除前核对 16,456 个文件，主目录不相同或缺失者保存至上述恢复归档，完整运行证据也已迁入归档。原任务停止 localhost:8000 服务并确认构建及 CLI 均结束后，已删除该工作树并核实目标目录不存在。未归属 `.playwright-mcp/` 在主目录保留。

交付范围与验收记录见 [整合任务](precision-integration-20260920/task.md)。本条工作树覆盖证明不替代受保护分支的远端检查及合并回执。

## 2026-09-17 分支与工作树清理回执

清理前，12 个非 `main` 本地分支均经 `git merge-base --is-ancestor <branch> main` 证明为主线祖先，且 `git cherry main <branch>` 没有 `+` 提交，因此无需再次合并。对应的 9 个远端分支均有已合并 PR（#128–#136 中的相关交付）；本轮已删除这些本地和远端分支。

额外工作树 `C:/Users/raede/Desktop/dev/mapcreator-contours` 在 tip `5d656c9ce61085170b28427dde19e7295e897250` 上无已跟踪或未跟踪改动，也无占用进程；该 tip 已通过 PR #131 进入 `main`。本轮删除此工作树及其中可再生成的 dist 数据、运行证据、Python 缓存和 `node_modules` junction。主工作区的 `.playwright-mcp/` 未动。

另有手工 remote-tracking ref `recovery/auditfix` 指向不在 `main` 祖先链上的提交 `872e4a50bb1d03a5850e37545ef7e999f19f1215`，但仓库并无名为 `recovery` 的远端。为避免把唯一恢复点误删，本轮将它改存为已推送标签 `archive/worktree-cleanup-20260917/auditfix`，再删除旧的伪远端引用。

## 近期已合并交付索引

2026-09-24 湖泊与河流交付：主工作区使用 `codex/shared-lakes-river-detail-20260924`，基线为 `2b2f1fec`。范围为共享普通湖泊、TNO 刚果湖隔离、河流缩放细节及对应构建产物；沿用现有工作区，保留其他工作树和 `.playwright-mcp/`。最终提交、PR 合并与主分支同步状态以 Git / GitHub 回执为准。

下列入口仅用于查阅交付历史，不表示仍有活跃工作树或分支。

| 任务记录 | 已合并回执 |
| --- | --- |
| [区域数据、渲染与分块整合](data-performance-integration-20260913/task.md) | [PR #136](https://github.com/raederhans/scenario-forge/pull/136) |
| [架构与城市点位整合](global-state-boundaries-20260912/task.md) | [PR #135](https://github.com/raederhans/scenario-forge/pull/135) |
| [9 月 11 日整批改动整合](daily-integration-20260911/task.md) | [PR #132](https://github.com/raederhans/scenario-forge/pull/132) |
| [近期地图改动整合](cartography-integration-20260910/task.md) | [PR #131](https://github.com/raederhans/scenario-forge/pull/131) |
| [编辑器改进与远端整合清理](editor-kernel-renewal-20260909/task.md) | [PR #127](https://github.com/raederhans/scenario-forge/pull/127) |
| [恢复后续 R0 / T1 / U1 / P1](recovery-followup-20260908/task.md) / [M4 完成记录](development-recovery-m4-20260908/task.md) | [PR #123](https://github.com/raederhans/scenario-forge/pull/123)–[PR #126](https://github.com/raederhans/scenario-forge/pull/126) |
| [快速治理任务](development-loop-simplification-20260905/task.md) / [P4 当前状态](state-action-ownership-p4-20260719/task.md#current-status) | 长期治理与 admission 参考，不声明分支或发布状态。 |
| [历史 registry 正文](../archive/worktree-registry-history-through-20260831.md) | 完整保留原登记、提交、验收、恢复与清理证据。 |

2026-09-06 收尾核对：功能整合提交 `a2adc4b627b0f0b6ad88c5ed04d68eae3f1ad15c`，包含此前治理、scenario 和 renderer 工作。本地 core74、官方策略生成与标准 checker（零违规）、Pages 构建和相关目标测试已通过；主分支接收以该分支 PR 的远端必需检查及合并回执为准，不代表正式 P4 B admission。个人 `.codex/config.toml` 修改保留在主工作区。

工作树清理覆盖证据以整合父提交 `348a952eecf08aa6d720b13721da927afd19efb8` 为基准：以下五个工作树的独立提交在 `git cherry` 中全部为 `-`，没有未覆盖 merge commit；`da5f` 为主分支祖先。删除前已确认工作区干净、无匹配运行进程，并保存旧运行记录。合并后的实际删除/保留回执保存于主工作区 `.runtime/tmp/optimization-closeout-20260906/cleanup-receipt.json`；原始 tip 与回收输出分别保存在 `worktrees-before.txt` 和 `worktree-artifact-recovery/`。

| 清理覆盖范围 | 可恢复 tip | 依据 |
| --- | --- | --- |
| `6e0c` | `5d6fd733bc8b14873328d3b887895bcc7b012bb1` | 两个独立提交已 patch-equivalent |
| `7a32` | `a45c6824538e7fe8d1529eae8cc9c0750e3f25ee` | 三个独立提交已 patch-equivalent |
| `8c4c` | `b5ed98f7ea2b913a25b67205a80707aa3cecfeab` | 四个独立提交已 patch-equivalent |
| `8c6f` | `9803aa1c0a51462edbaf4d4c520b1f63b7f295c8` | 两个独立提交已 patch-equivalent；旧锁对应进程不存在 |
| `da5f` | `4406c842747fc74ee5e3eb69ce0085a296c627f5` | origin/main 祖先，无独立提交 |
| `gate4-startup-graph-audit-20260901` | `a1f0885c6617622d260bc633c257b3f67b941686` | 一个独立提交已 patch-equivalent |

继续保留 `b52a`（`611c21400661085161e46c1daf0a9318f467b94b`，A-admitted-source）和 `d081`（`c41a17d2d9668243988929399108fb28e4707eac`）：仍有 `git cherry +` 的提交，未证明被整合结果完整覆盖。清理分支范围仅为本次 integration、已合并 baseline，以及已等价覆盖的 gate4；不扩大到这些保留工作树。

## 2026-09-09 工作树清理回执

本轮已整合功能提交 `ece5d2c0`，保留此前 `9d4b715a` 的优化。已逐一清理15个额外工作树、17个旧本地分支及6个已在远端主线历史内的远端分支；当前仅保留主工作区、`main` 和 PR #127 集成分支。远端必需检查及最终合并状态以 [PR #127](https://github.com/raederhans/scenario-forge/pull/127) 为准；此回执不提前声明合并成功。

清理前已归档359个运行证据文件（179,225,200字节），两个脏工作树的改动仅为已被新产物覆盖的3个旧 dist 文件，各自保留原文件和二进制补丁。原 tip、逐项覆盖分析、删除回执及验证过的增量 Git bundle 位于主工作区 `.runtime/tmp/editor-kernel-renewal/worktree-recovery/`。8个 `archive/worktree-cleanup-20260909/*` 标签保留补丁等价或语义已覆盖提交的原始身份，并随集成分支推送。

上方2026-09-06的保留决定是历史快照。本轮重新核对后，`b52a` 的有效变更已覆盖，剩余差异为后来明确移除的旧 transport wrapper；`d081` 的旧证明已被当前更严格的操作感知契约覆盖。两者原始提交均由归档标签及 bundle 保留，工作树现已清理。完整 P4 admission 仍为 FAIL，未更新冻结基线或放宽检查。

## 历史记录索引

以下原标题仅为兼容已有锚点。历史正文已移至一个归档文件；新增当前工作记录写入上面的任务入口，不再追加到旧阶段标题下。

## Runtime Architecture Reset v1 Stage B integration — 2026-08-31

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-001)

## Runtime Architecture Reset v1 Stage A integration — 2026-08-31

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-002)

## Remaining branches and protected-WIP closeout — 2026-08-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-003)

## Main convergence and completed-line cleanup — 2026-08-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-004)

## P4 authority and Nightly topology execution — 2026-08-28

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-005)

## M7-M12 controlled continuation — 2026-08-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-006)

## Worktree convergence snapshot — 2026-08-27

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-007)

## Landing home revamp integration snapshot — 2026-08-25

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-008)

## SC P3 serial execution snapshot — 2026-08-24

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-009)

## SC P0-P3 integration snapshot — 2026-08-24

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-010)

## Integration Owner

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-011)

## Recommended Order

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-012)

## Current Worktrees

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-013)

## P3.1 Visual-Effects Pass Delivery Package 2026-07-14

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-014)

## P3.2 Context-Pass Orchestration Delivery Package 2026-07-14

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-015)

## P3.3a Political-Pass Preflight Delivery Package 2026-07-14

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-016)

## P3.3b Political-Pass Orchestrator Delivery Package 2026-07-14 / 2026-07-15 closeout

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-017)

## P3.0 Render-Pass Family Delivery Package 2026-07-13 (historical; superseded by the 2026-07-14 audit addendum)

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-018)

## P3.0 audit delivery addendum 2026-07-14

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-019)

## Recent P2 audit delivery package 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-020)

## P2 final integration decision 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-021)

## Williams Rerun08 Harness-Recovery Frozen Contract 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-022)

## Williams Rerun08 Terminal Invalid-Experiment Package 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-023)

## Williams Rerun07 Terminal Harness-Fault Package 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-024)

## P2 Final Recovery-Branch Verification Package 2026-07-13

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-025)

## Williams Rerun06 Terminal Package and Rerun07 Final Governance 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-026)

## Williams Rerun05 Terminal Package and Role-v2 Repair 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-027)

## Williams Rerun04 Terminal Package 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-028)

## Williams Rerun03 Terminal and Telemetry-v3 Repair Package 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-029)

## P2.2a Williams Rerun02 Terminal Record 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-030)

## Williams Telemetry-v2 Repair Delivery Package 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-031)

## P2.2a Cached-Pass Compositor Delivery Package 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-032)

## P2.2a Williams Crossover Governance Delivery Package 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-033)

## P2.2a Williams Rerun01 and Analyzer TDD Follow-up 2026-07-11/12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-034)

## P2.2a Windows Job Object Containment TDD Package 2026-07-12

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-035)

## P2.1 Legacy-Metric Acceptance Closeout 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-036)

## P2.1 Governed Render-Sample Reanalysis 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-037)

## P2 Upstream Integration 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-038)

## P2.1 Post-Acceptance Code-Review Fix 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-039)

## P2.1 Focused Repair Closeout 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-040)

## P2 Pre-baseline Repair 2026-07-10

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-041)

## P2 Perf Readiness Cleanup Classification 2026-07-10

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-042)

## P2 Contemporary A/B Admission Run 2026-07-10

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-043)

## Audit Release Packaging Guardrails 2026-07-11

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-044)

## Scenario Forge P1 Remaining Renderer Context 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-045)

## Scenario Forge P1.8 Pure Click-Selection Decision Owner 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-046)

## Scenario Forge P1.7 Click-Selection Transaction Preflight 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-047)

## Scenario Forge P1.6 Hit/Hover Runtime Context Migration 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-048)

## Scenario Forge P1.5 Interaction Read Model Migration 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-049)

## Scenario Forge P1.4 Viewport Mutation Chain Context Migration 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-050)

## Scenario Forge P1.3 RendererRuntimeContext Projection + Viewport Read Model 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-051)

## Scenario Forge P1.2 RendererRuntimeContext Render Cache Read Model 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-052)

## Scenario Forge P1.1 RendererRuntimeContext First Receiver 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-053)

## Scenario Forge P1.0 Renderer Runtime Context Foundation 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-054)

## Local/Cloud Sync Cleanup 2026-07-08

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-055)

## Scenario Forge P0.1 Core Verification 2026-07-08

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-056)

## Scenario Forge P0.1.1 verify:core Post-acceptance Hardening 2026-07-08

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-057)

## Scenario Forge P0.2 Verification Metadata Single Source 2026-07-09

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-058)

## Comment Automation 2026-07-08

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-059)

## Audit Follow-up 2026-07-07

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-060)

## Audit Follow-up 2026-07-05

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-061)

## Audit Integration Closeout 2026-07-04

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-062)

## Integrated Worktree Cleanup 2026-07-03

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-063)

### Recent Renderer Audit Dist Sync 2026-07-03

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-064)

## Branch Sync and Cleanup 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-065)

## Integrated Worktree Closeout 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-066)

## Ready Delivery Packages

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-067)

### Renderer Draw Canvas Orchestration Preflight P53 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-068)

### Renderer Click Selection Transaction Preflight P54 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-069)

### Recent Platform Audit Selector Fix 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-070)

### P7 And Phase 6E Worktree Cleanup 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-071)

### P7 v0.1 Public Demo Release Packaging 2026-07-02

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-072)

### Renderer Integration Sweep After P47-P50 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-073)

### Renderer Render Pass Cache Host Preflight P50 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-074)

### Renderer Transaction Reset Owner P49 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-075)

### Renderer Map Hover Interaction Owner P48 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-076)

### Renderer Hit Canvas Scheduling Owner P47 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-077)

### Phase6E Public Demo QA Readiness 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-078)

### Audit Automation 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-079)

### Comment Annotation Automation 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-080)

### Phase6C Sample Switcher 2026-07-01

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-081)

### Renderer Hit Canvas Scheduling Preflight 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-082)

### Phase6B Sample Guide Export 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-083)

### Renderer Render Phase Lifecycle Owner P43 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-084)

### Renderer Visible Frame Diagnostics Owner P42 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-085)

### Phase6A Public Sample Experience Polish 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-086)

### Renderer Render Request Boundary Owner P41 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-087)

### Renderer Render Lifecycle Preflight P40 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-088)

### Phase5B Sample Deep Links 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-089)

### Renderer Transaction Reset Hardening P39 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-090)

### Renderer setMapData Transaction Owner P38 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-091)

### Phase4B Output Gallery

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-092)

### Phase5A Sample Projects

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-093)

## Local/Remote Sync Closeout 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-094)

## Ready Delivery Packages

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-095)

### Renderer Startup Transaction Owner P36 2026-06-30

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-096)

### Renderer Startup Transaction Preflight P35 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-097)

### Phase 4A Landing Product Story 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-098)

### Renderer Viewport Update Owner P34 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-099)

### Phase 3A Public Product Narrative 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-100)

### Audit Final CI Gate Closeout 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-101)

### Renderer Surface Runtime Bridge P33 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-102)

### Pages Release Gate Audit 2026-06-29

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-103)

### Phase 2A Pages Payload Slimming

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-104)

## Recent Integrated Branches

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-105)

## Current Overlap Matrix

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-106)

## Recovery Records

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-107)

## Active Notes

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-108)

## Renderer frame orchestration P2 current admission note

[查看原始记录](../archive/worktree-registry-history-through-20260831.md#registry-section-109)

## Atlantropa southern expansion integration 2026-09-28

- Branch: `codex/atlantropa-southern-expansion-20260928`; base: `4506f4fe`.
- Managed checkout: `C:/Users/raede/.codex/worktrees/atlantropa-southern-merge/mapcreator`. Root is sole integration/process owner.
- Scope: source-backed Bodrum/Milas/Soke, Aegean island registration, Samos/Ikaria (TUR), Malta and source-coast completion; latest-main scenario rebuild and matching landing TNO assets.
- Preserve primary checkout and unrelated WIP. See `atlantropa-expansion-20260926/context.md` for checks and integration receipts.

## Water display integration 2026-09-28

- Branch: `codex/water-outline-20260928`; base: `953d17c8`.
- Managed checkout: `C:/Users/raede/.codex/worktrees/water-outline-merge/mapcreator`. Root owns integration and shared test processes.
- Scope: major-lake outlines, sea-name visibility default, and marine highlight display simplification; preserve source geometry and latest-main rendering caches.
- Primary checkout and unrelated work remain untouched. Keep this checkout available for water-display follow-up verification.

## 2026-09-29 地貌图层交付

整合工作树：`C:/Users/raede/.codex/worktrees/physical-layer-merge/mapcreator`；分支：`codex/physical-layer-improvements-20260929`。地貌面板、阿尔卑斯细节、局部强度、双语名称和 DEM 阴影由本分支统一交付。当前主工作区的混合 WIP 原样保留，不进行 reset、stash 或强制同步。验证及合并状态见 `docs/active/physical-layer-improvements-20260928/task.md`，运行证据保留在整合工作树 `.runtime/reports/generated/physical-integration/`。

## Polar data repair integration 2026-09-29

- Branch: `codex/polar-data-repair`; repair commit: `2b64c655`; integrated base: `origin/main@a756b139`.
- Managed checkout: `C:/Users/raede/.codex/worktrees/polar-data-repair/mapcreator`; root owns commit, build, push and merge.
- Scope: Russian Arctic truncation, Norwegian island retention, blank-map polar coverage and interaction, derived scenario assets and precision-water repair.
- User authorized push/merge and a fast merge path. Primary checkout WIP remains untouched. Keep this worktree for reuse and ignored browser/build evidence; remote PR receipt is authoritative for final merge status.
- Polar delivery PR: https://github.com/raederhans/scenario-forge/pull/187 . Local integration validation completed; retain checkout and ignored evidence. Final merge receipt is available on the PR.

## Polar sample baseline deployment follow-up 2026-09-29

The same managed polar checkout now uses `codex/fix-polar-sample-baselines`, based on `main@490583b6`. Root owns the scoped sample baseline and early CI gate fix, local publication test server, push/merge and deployment verification. Original polar repair is already merged as PR #187; its first deployment failed. Preserve primary checkout WIP and retain this checkout for evidence/reuse.

## Scenario geography repair 2026-10-01

- Branch: codex/scenario-geometry-repair; base bfedc6b8. Managed checkout C:/Users/raede/.codex/worktrees/scenario-geometry-repair/mapcreator.
- Root owns canonical builds, browser server, commits, push and PR integration. Scope: Guiana/Somalia coverage, Kashmir duplicate placeholder, Canada 60N coarse/detail nodes.
- Primary country-label/UI WIP preserved. Acceptance and final merge receipt: docs/active/scenario-geography-repair-20261001/.

## Palette country color integration 2026-10-01

- Branch: `codex/palette-country-color`; integrated base: `origin/main@81532208`.
- Managed checkout: `C:/Users/raede/.codex/worktrees/palette-country-integration/mapcreator`; root owns commit, build, push and merge.
- Scope: explicit country-tag recoloring, undo/redo and save coverage, palette-source request ordering, variant keyboard application, and matching Pages assets.
- Primary checkout and unrelated registry WIP are preserved. Local validation: 70 palette and river UI tests; publication checks and merge receipt are recorded in PR #193 (https://github.com/raederhans/scenario-forge/pull/193). Retain this checkout for build evidence under `.runtime/reports/generated/palette-integration/`.

## River wave3 offline integration 2026-10-01

- Branch: `codex/river-wave3-integration`; base `2da4db61`. Integration checkout: `C:/Users/raede/.codex/worktrees/river-paint-integration/mapcreator`.
- Root owns integration, Git operations and adaptive checks; outputs `.runtime/rv3/`, no browser server for this offline acceptance.
- Integrated deliveries: Europe `cdfedb34` (6f5a), China `9a664cbe` (edea), east `ec275ef5` (f7ce), tooling `2e44f94e` (b5dc). Retain all four clean worktrees for ignored atlas/audit evidence.
- Scope: offline tool and selections; 307 initial parents reduced to 302 after full-map contour verification. No runtime admission. Details and remaining gates: `river-wave3/integration.md`.
- Preserve primary checkout WIP. Final push and merge receipt is the PR for this branch; do not infer merged status from this registry.

## River wave4 runtime integration 2026-10-02

- Branch: `codex/river-wave4-integration`; base `b416e257`; checkout `C:/Users/raede/.codex/worktrees/river-paint-integration/mapcreator`.
- Root owns integration, localhost port 8009 browser checks, Pages builds under `.runtime/pw4b`, Git operations and final admission.
- Deliveries: `0840` runtime cde83659, `f3b2` navigation42a61eeb, `909f` verification f0c58b9d. Retain original worktrees for ignored evidence; preserve primary WIP.
- Scope: 302-parent authenticated default, searchable navigation, old-pack retention and full-map contour gates. Integration fixes/evidence: `river-wave4/integration.md`.
- Final merge/push status is the PR receipt for this branch; this entry alone is not merge proof.

## River wave5 coverage and transport 2026-10-02

- Branch: `codex/river-wave5-expansion`; base `bb510a54`; same retained river integration checkout.
- Root owns integration, port 8009 browser checks, Pages builds `.runtime/pw5`, Git and publication. Three scoped Sol lanes supplied coverage review, held-seam diagnosis and lossless transport; children did not commit.
- Final reviewed candidate: 376 parents / 1,164 cells, with all previous 302 parent records unchanged. Source admission and remaining exclusions: `river-wave5/integration.md`.
- Primary WIP and older regional atlas worktrees remain preserved. Final merge/push receipt is the branch PR, not this registry entry.

## UI interaction polish integration 2026-10-02

- Branch: `codex/ui-detail-polish-20261002`; base: `origin/main@d418eefa`.
- Managed checkout: `C:/Users/raede/.codex/worktrees/ui-detail-integration/mapcreator`. Root owns integration, local server and verification processes.
- Scope: editor navigation, focus/scroll retention, refresh/motion, bilingual guidance and related regression routing. Primary checkout mixed WIP is preserved; unrelated data, palette and physical renderer changes are excluded.
- Local validation: 32 behavior tests, 22 translation-audit tests, 9 routing tests and 15 focused browser cases passed. The heading-language case explicitly waits for lazy locale hydration before exercising the toggle. Test-list coverage and route schema checks passed.
- Retain this worktree for delivery verification and ignored evidence under `.runtime/tmp/ui-delivery/` and `.runtime/tests/playwright/ui-delivery*`. The associated PR is authoritative for remote checks and merge status.

## 2026-10-03 三轮性能优化交付

`C:/Users/raede/.codex/worktrees/performance-round-20261002/mapcreator` 使用 `codex/performance-round-20261002`，整合主线 `14234669` 的整消息启动传输后交付三轮性能优化。用户已授权审核、合并、推送。主工作区及其他工作树 WIP 保留；本树保存 `.runtime/browser/`、CPU profiles 和对照报告，合并后继续保留供复核。实现与验证见 [任务记录](performance-round3-20261002/task.md)，最终提交和合并以 [PR #203](https://github.com/raederhans/scenario-forge/pull/203) 回执为准。
