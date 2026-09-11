# verify:core

`verify:core` 默认运行明确归属为 child-safe、无资源锁且非 heavy 的核心检查。它按顺序执行，并在遇到第一个失败项时停止。日常局部修改优先使用已有目标测试或 `verify:edit`；核心计划用于验证框架或相应跨模块改动。

## PR 与合并后验证

- 日常修改运行相关目标检查或 `verify:edit` / `verify:impact`，不把 `verify:core`、`verify:pr` 和完整性能测量逐一叠加为每次推送的固定前置步骤。
- PR 的 `pr-verify-fast` 运行受影响契约；`pr-verify-smoke` 在同一环境中依次运行 smoke 与 Golden Demo。`PR Verify Required` 仅在两条执行通道都成功时通过，失败、取消、跳过或缺失结果均阻断。
- Scenario Contract Matrix 负责各剧本的 strict 检查；`pr-fast` 不再额外固定重跑 TNO strict。修改单个受支持剧本只运行该剧本，公共依赖或无法可靠确定改动范围时检查全部剧本。
- `perf-gate` 继续作为 PR 必需检查。TNO 1962 与 HOI4 1939 在两台独立 Windows runner 上并行；每个剧本仍在同一台 runner 内顺序测量基线和候选版本，各保留 5 次测量、3 次预热以及原始证据校验。最终 `perf-gate` 要求整个双剧本矩阵成功，失败、取消、跳过的 job 或缺失结果均阻断。纯性能 Markdown 说明和符合分类器条件的独立非性能测试脚本修改，仍可由分类器明确决定不执行测量。
- 单剧本执行必须同时声明 `--scenario-shard <id> --scenarios <id>`，并使用自定义输出路径。分片报告显式标记作用域，不能作为默认双剧本门禁的完整通过证据；普通 `npm run perf:gate` 仍检查两个剧本。CI artifact 按剧本命名为 `perf-pr-gate-evidence-<id>` 和 `perf-pr-gate-classifier-audit-<id>`。并行减少墙钟等待，不减少样本总数，且会增加一份 runner 环境准备开销。
- 完整性能任务不再由每次 main push 触发，改为每日定期与手动运行；这些运行强制测量当前提交与其父提交，不是对全天所有提交的累计回归比较。合并后的 Pages 产物检查和线上 smoke 继续由部署工作流执行。
- PR 更新自动取消同一 PR 的过时验证。现有必需检查名称保持不变，无需修改分支保护设置。

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
