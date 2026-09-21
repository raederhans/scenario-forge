# verify:core

`verify:core` 默认运行明确归属为 child-safe、无资源锁且非 heavy 的核心检查。它按顺序执行，并在遇到第一个失败项时停止。日常局部修改优先使用已有目标测试或 `verify:edit`；核心计划用于验证框架或相应跨模块改动。

## PR 与合并后验证

- 日常修改仍优先运行相关目标检查或 `verify:edit` / `verify:impact`。PR 不再默认把所有浏览器、Pages、剧本和完整性能验证叠加到同一条阻塞路径。
- `pr-verify` 先运行轻量 `PR Plan`。Planner 只读取 PR changed-files 和 CI intent labels，然后决定是否需要 smoke、Golden Demo、Pages mirror、剧本合同、Transport 与性能测量。Planner 本身不下载完整仓库数据。
- `pr-verify-fast` 始终保留，负责 affected child-safe contracts 和 verification control-plane guardrails。Pages mirror rebuild 仅在 planner 判定 delivery surface 相关时运行。
- `pr-verify-smoke` 只在 runtime/UI/E2E 相关改动或 `ci:full` 时启动。Golden Demo 进一步只在 public-sample 相关改动或 `ci:full` 时运行。计划性跳过 smoke 是成功状态，不再被 `PR Verify Required` 当作失败。
- Scenario Contract Matrix 继续保留三个既有 required check 名称。每个 matrix job 先读取 planner 结果，只有被选中的剧本才 checkout 完整仓库、安装依赖并运行 strict contract。未受影响的剧本在 checkout 前快速成功，从而兼容现有 branch protection。
- Transport required check 同样保留原检查名。Transport 无关 PR 在完整 checkout 前快速成功；相关 PR 才进入 manifest 和 unit contract。
- Adaptive selector 仍对 verification/workflow 等控制平面保持 fail-closed。普通未注册文档与非 runtime reference assets 作为 advisory；新增 renderer、UI、map-builder、scenario-data 和 CI planner 文件可先由目录 ownership 映射到已有 domain routes。自动 ownership 如果无法解析出任何真实 route，仍保持 unmatched 并阻断，不会静默放行。
- PR 性能验证分为 `skip`、`sample`、`strict` 三档。无性能相关改动为 `skip`；普通 runtime/data PR 默认 `sample`，只对 HOI4 1939 candidate 生成独立 measurement-only evidence，不做 regression verdict，也不再生成同-runner base；`ci:perf-strict`、`ci:full`、定时和手动性能运行使用 `strict`，继续测 TNO 1962 与 HOI4 1939，并保留 same-runner base/candidate 对照与 enforced regressions。
- `ci:perf-expected` 表示本次改动预期改变性能特征。普通 PR 仍保留 sampled evidence，但不因性能 delta 阻断。若同时显式添加 `ci:perf-strict`，strict 优先。
- 当前标准性能 role contract 仍固定为每个被测剧本 3 次预热、5 次 measured runs。因此 `sample` 的主要降本来自只运行一个代表剧本和移除同-runner base measurement，而不是降低样本协议。Nightly/manual strict 保持完整可比较性。
- PR 更新继续自动取消同一 PR 的过时验证。现有 required check 名称保持稳定，P1-P3 本身不要求放松 branch protection。

### CI intent labels

- `ci:full`：强制 smoke、Golden Demo、Pages、所有受支持剧本、Transport 与 strict performance。
- `ci:perf-strict`：强制完整双剧本 same-runner 性能门禁。
- `ci:perf-expected`：记录预期性能变化，普通 PR 使用 sampled diagnostic evidence。

## 命令

- `npm run verify:core:list`：只生成 JSON 和 Markdown 报告，不实际执行命令。
- `npm run verify:core`：运行默认的 child-safe 核心验证计划。
- `npm run verify:core -- --include-reserved`：恢复完整非浏览器计划，包含有资源锁或主线程归属的保留命令。
- `npm run verify:core:main-thread`：运行完整保留计划，并追加显式的 main-thread E2E 组。
- `npm run verify:core -- --resume`：从默认 JSON checkpoint 恢复同计划的连续已通过前缀。
- `npm run verify:core -- --resume-from <path>`：从指定 checkpoint 恢复。
- `npm run test:node:verify-core-runner`：验证 runner 自身行为。
- `npm run test:node:verification-metadata`：验证 metadata、route registry、selector 和 verify:core plan 一致。

默认报告路径：

- `.runtime/reports/generated/verify-core.json`
- `.runtime/reports/generated/verify-core.md`

## 默认范围

计划从以下候选分组生成；默认只保留其中满足 child-safe、无资源锁且非 heavy 条件的命令，空分组不进入执行计划：

- `infra`
- `python-quick`
- `startup-node`
- `renderer-owner`
- `scenario-project-chunk`
- `pages`

这些分组由 canonical metadata 投影生成，`tools/run_core_verification.mjs` 负责入口范围筛选、执行、报告和失败即停。修改命令归属时按[编辑导航](verification-metadata.md)更新对应 records 文件，并运行相关目标检查。

Core plan 在保留 metadata 顺序和分组归属的前提下应用 `tools/verification/command_supersession.mjs`，折叠被已选 suite 完整覆盖的命令。具体命令数以当前 `verify:core:list` 报告为准；检查保留计划时使用 `npm run verify:core:list -- --include-reserved`。Nightly Linux core 分片与 `verify:nightly` 使用保留计划。

当前 Core command-closure 映射：

- `test:node:p4:p4-2a` 覆盖 scenario apply、lifecycle 和 runtime-state 三个 standalone 命令。
- `test:node:p4:p4-2b` 覆盖 standalone scenario chunk contracts。
- `test:node:p4:p4-3` 覆盖 renderer render-phase lifecycle 与 zoom lifecycle standalone 命令。
- `test:node:hit-canvas-scheduling-owner-suite` 覆盖 renderer hit-canvas inventory standalone 命令。

SF-ATS adaptive/supervisor 计划同时使用 supervisor aggregate 映射：`verify:supervisor-contracts` 覆盖 supervisor contracts 与 routing，`verify:supervisor-plan` 覆盖 supervisor plan unit command。单独选中 constituent 时该命令继续保留。JSON 和 Markdown 报告通过 `supersededCommands` 记录每个被折叠命令及其 retained aggregate。

Command supersession 在生成任何折叠结果前检查 selected command graph。Self-cycle 或 multi-node cycle 会以稳定的 `command-supersession-cycle` code 和排序节点列表终止计划；每条 provenance 必须解析到 retained root，无法解析时以 `command-supersession-unresolved:<command>` 终止计划。Core、adaptive runner 和 supervisor plan 共用这一 fail-closed 合同。

默认范围不会启动 browser、dev server 或 Playwright，也不选择带 dist / runtime-output 锁的 Pages 构建。显式保留计划包含 `pages` 分组：

- `verify:pages-dist-and-drift`

`verify:pages-dist` 保留 Pages mirror 生成、startup shell、landing assets 和 landing view contracts。Sample runtime/import contracts 由独立 `test:node:sample-project-contracts` route 与 P4.1 承接，避免 Pages 与 P4.1 用不同资源锁重复认领同一 leaf。`verify:pages-dist-and-drift` 只构建一次，随后运行同一组 Pages contracts 和 dist drift 检查。`verify:dist-drift` 保留为独立诊断命令；adaptive/supervisor 同时选中这些命令时，command supersession 会保留覆盖完整 admission 合同的 `verify:pages-dist-and-drift`。

`pages` 分组会写入或检查 Pages mirror、dist manifest 和 `.runtime` 报告。执行包含该分组的保留计划或 main-thread 计划时，由 integration owner 协调 dist lane；普通默认计划不因此要求占用 dist lane。

## Main-thread 通道

`verify:core:main-thread` 在完整保留计划上追加这些显式 E2E 命令：

- `test:e2e:smoke`
- `test:e2e:scenario-apply-concurrency`
- `test:e2e:project-save-load`
- `test:e2e:interaction-funnel`

下面这些可选 E2E 命令会继续保留在“已跳过的 main-thread 检查”列表里，方便 integration owner 按需安排：

- `test:e2e:tno-contracts`
- `test:e2e:water-rendering`
- `test:e2e:city-rendering`

## 路由覆盖

SF-ATS route registry 会把 runner、runner 测试、package scripts 和这份文档都映射到 `test-routing`。如果改动涉及 `package.json`、`package-lock.json`、`tools/run_core_verification.mjs` 或 `docs/testing/verify-core.md`，selector 应该命中同一个 domain。

验证 metadata 自身的 route 信息也来自同一份 metadata。改动 `tools/verification/**` 或 `docs/testing/verification-metadata.md` 时，selector 应该命中 `test-routing`，并推荐 `test:node:verification-metadata`。

## 失败排查

`verify:core:list` 只产出 plan 和报告文件，不执行任何验证命令。`verify:core` 或 `verify:core:main-thread` 失败后，先查看：

- `.runtime/reports/generated/verify-core.json`
- `.runtime/reports/generated/verify-core.md`
- 第一个失败的 `failing commandRef`
- `verify:dist-drift` 的 dist drift 输出
- selector 或 supervisor 报告里的 route gaps

## Checkpoint 与恢复

runner 会在每条命令开始前和结束后原子写入 JSON checkpoint，并记录 `startedAt`、`finishedAt`、`durationMs`、exit code 与 evidence disposition。恢复只接受相同 command plan、来源 clean workspace 和当前 clean workspace。

- 相同 commit/tree：复用连续已通过前缀，从第一条 failed/running/pending 命令继续。
- clean tree 变化：由 SF-ATS 计算最早受影响命令，从该位置与第一条未通过命令中的较早位置重跑整个 suffix。路由与当前计划缺少交集时从第 0 条保守重跑；当前 P4 renderer 路径会进入这一分支。
- dirty workspace、unmatched changed file、plan drift、损坏 checkpoint：在首条命令启动前以 exit `2` 阻塞。
- 同 tree 不同 commit、控制面变更、changed file 与当前计划没有 command 交集：从第 0 条重跑。

恢复接口不提供任意 skip；每条复用证据都绑定来源 revision 和 exact command plan。默认执行仍建立 fresh checkpoint。

## P4 policy 快速入口

- `npm run test:node:p4:state-writer-policy:quick`：运行 7 个快速 policy/scanner/route 合同，跳过承担仓库级 closed-world 快照的 manifest 文件；TAP 写入独立的 `state-writer-policy-tests.quick.tap`。
- `npm run test:node:p4:state-writer-policy -- --test-name-pattern="<pattern>" tests/state_writer_policy_manifest_behavior.test.mjs`：只运行指定 manifest 子测试；TAP 写入 `state-writer-policy-tests.focused.tap`。
- `npm run test:node:p4:state-writer-policy`：完整 admission suite；manifest 内共享一次显式 repository scan，同时保留全部断言。

quick/focused 入口服务开发回归，完整 suite 继续承担 frozen candidate admission。三种模式使用不同 TAP 文件，避免快速检查覆盖完整 admission evidence。

历史 P0.1.1 验收中的 full core 指完整非浏览器集合；当前等价入口为 `npm run verify:core -- --include-reserved`。只有执行该历史验收时才按其要求记录通过结果或失败分类，不把它作为普通局部修改的前置检查。

## 有意跳过的项

`verify:core` 会过滤自递归命令，例如 `verify:core` 和 `node tools/run_core_verification.mjs`。缺失的 package script 会在报告里记为 omitted commands。重复的具体命令会只在 `duplicateCommands` 中记录一次；完整 command closure 覆盖的命令记录在 `supersededCommands`。
